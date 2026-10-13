// Internet access control: manual pauses, weekly schedules, per-device data caps and
// "only these devices" mode. HomeNet decides who is blocked; the router plugin enforces it
// with nftables. Every block carries its end time to the router, so blocks expire there
// even when HomeNet is down; a router reboot clears everything (HomeNet re-applies it).
import type { RouterCollector } from './collectors/router.js';
import { db, kvGet, kvSet, localDay } from './db.js';
import { displayName, type DeviceRow } from './devices.js';
import { addEvent, addEventOnce, fmtBytes } from './events.js';
import { log } from './log.js';
import { getSettings } from './settings.js';
import { collectorDisabled, collectorError, collectorOk, state } from './state.js';

export type CapPeriod = 'day' | 'week' | 'cycle';
export type BlockReason = 'manual' | 'schedule' | 'cap' | 'lockdown';
/** Weekly window; `days` are JS weekdays (0 = Sunday) on which the window starts. "22:00"–"07:00" crosses midnight. */
export interface Schedule { enabled: boolean; days: number[]; from: string; to: string }
export interface Lockdown { until: number; allow: number[]; started: number }

/** Plugin version that has the "access" method. */
export const ACCESS_PLUGIN = 2;
/** Upper bound for a lockdown: it must always end on its own. */
export const MAX_LOCKDOWN_SECS = 24 * 3600;

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

/** Start/end (unix seconds) of the current day, week (from Monday) or billing cycle. */
export function periodBounds(period: CapPeriod, now = new Date(), cycleDay = getSettings().dataPlan.cycleDay) {
  let start: Date, end: Date;
  if (period === 'day') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  } else if (period === 'week') {
    const back = (now.getDay() + 6) % 7;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back + 7);
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), cycleDay);
    if (now.getDate() < cycleDay) start.setMonth(start.getMonth() - 1);
    end = new Date(start);
    end.setMonth(end.getMonth() + 1);
  }
  return { start: sec(start), end: sec(end) };
}

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The schedule window containing `now`, if any (also the one that started yesterday evening). */
export function scheduleWindow(s: Schedule | null, now = new Date()) {
  if (!s?.enabled || !s.days?.length) return null;
  const f = minutes(s.from), t = minutes(s.to);
  if (f === null || t === null || f === t) return null;
  for (const back of [0, 1]) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    if (!s.days.includes(day.getDay())) continue;
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, f);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t + (t < f ? 1440 : 0));
    if (now >= start && now < end) return { start: sec(start), end: sec(end) };
  }
  return null;
}

export function parseSchedule(v: string | null): Schedule | null {
  if (!v) return null;
  try { return JSON.parse(v) as Schedule; } catch { return null; }
}

export function validSchedule(v: unknown): Schedule | null {
  const s = v as Partial<Schedule> | null;
  if (!s || typeof s !== 'object') return null;
  const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (minutes(String(s.from)) === null || minutes(String(s.to)) === null) throw new Error('orario non valido (HH:MM)');
  return { enabled: !!s.enabled, days, from: String(s.from), to: String(s.to) };
}

export function getLockdown(now = sec(new Date())): Lockdown | null {
  const l = kvGet<Lockdown | null>('lockdown', null);
  return l && l.until > now ? l : null;
}

export function setLockdown(l: Lockdown | null) {
  kvSet('lockdown', l);
}

const capUsed = (id: number, start: number, end: number) =>
  (db.prepare('SELECT COALESCE(SUM(up + down), 0) AS b FROM device_daily WHERE device_id = ? AND day >= ? AND day < ?')
    .get(id, localDay(start), localDay(end)) as { b: number }).b;

export interface AccessInfo {
  blocked: boolean;
  reasons: BlockReason[];
  /** when the block ends; null = until resumed by hand */
  until: number | null;
  pauseUntil: number | null;
  overrideUntil: number | null;
  essential: boolean;
  /** devices without a MAC cannot be blocked */
  controllable: boolean;
  cap: { bytes: number; period: CapPeriod; used: number; start: number; end: number } | null;
  schedule: Schedule | null;
  scheduleActive: boolean;
}

/** Access state of one device right now. */
export function evaluate(d: DeviceRow, now = sec(new Date()), lockdown = getLockdown(now)): AccessInfo {
  const controllable = !d.mac.startsWith('ip:');
  const reasons: BlockReason[] = [];
  const ends: Array<number | null> = [];
  const overridden = (d.override_until ?? 0) > now;
  if (d.pause_until === 0 || (d.pause_until ?? 0) > now) { reasons.push('manual'); ends.push(d.pause_until || null); }
  const schedule = parseSchedule(d.schedule);
  const win = scheduleWindow(schedule, new Date(now * 1000));
  if (win && !overridden) { reasons.push('schedule'); ends.push(win.end); }
  let cap: AccessInfo['cap'] = null;
  if (d.cap_bytes && d.cap_period) {
    const period = d.cap_period as CapPeriod;
    const b = periodBounds(period, new Date(now * 1000));
    cap = { bytes: d.cap_bytes, period, used: capUsed(d.id, b.start, b.end), ...b };
    if (cap.used >= cap.bytes && !overridden) { reasons.push('cap'); ends.push(b.end); }
  }
  if (lockdown && !d.essential && !lockdown.allow.includes(d.id)) { reasons.push('lockdown'); ends.push(lockdown.until); }
  const blocked = controllable && reasons.length > 0;
  return {
    blocked,
    reasons: controllable ? reasons : [],
    until: !blocked || ends.includes(null) ? null : Math.max(...(ends as number[])),
    pauseUntil: d.pause_until, overrideUntil: overridden ? d.override_until : null,
    essential: !!d.essential, controllable, cap, schedule, scheduleActive: !!win,
  };
}

const REASON_LABEL: Record<BlockReason, string> = {
  manual: 'In pausa', schedule: 'Fascia oraria', cap: 'Limite dati raggiunto', lockdown: 'Modalità «solo alcuni dispositivi»',
};

const hhmm = (ts: number) => new Date(ts * 1000).toLocaleString('it-IT', {
  weekday: ts - Date.now() / 1000 > 20 * 3600 ? 'short' : undefined, hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || undefined,
});

/**
 * Re-evaluates every device each tick, emits events on changes and pushes the desired state
 * to the router when it changed (and every few minutes, in case the router rebooted).
 */
export class AccessController {
  private timer: NodeJS.Timeout | undefined;
  private lastSig: string | null = null;
  private lastApply = 0;
  private lastBoot: number | null = null;
  private pendingKill = new Set<string>();
  private busy = false;
  /** device id → blocked last tick (persisted so restarts do not repeat events) */
  private prev = new Map<number, boolean>(Object.entries(kvGet<Record<string, boolean>>('access_prev', {})).map(([k, v]) => [Number(k), v]));
  private prevLockdown = kvGet<number | null>('access_prev_lockdown', null);

  constructor(private getRouter: () => RouterCollector | null) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 30_000);
    setTimeout(() => void this.tick(), 15_000);
  }

  stop() { clearInterval(this.timer); }

  /** Runs a tick now (after a change from the UI); `kill` = MACs whose open connections must be cut. */
  async kick(kill: string[] = []) {
    for (const m of kill) this.pendingKill.add(m);
    this.lastSig = null;
    await this.tick();
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try { await this.run(); } catch (e) { log.error('access', e); } finally { this.busy = false; }
  }

  private async run() {
    const now = sec(new Date());
    // expired manual pauses / overrides: clean up so the UI shows the real state
    db.prepare('UPDATE devices SET pause_until = NULL WHERE pause_until > 0 AND pause_until <= ?').run(now);
    db.prepare('UPDATE devices SET override_until = NULL WHERE override_until <= ?').run(now);
    const devices = db.prepare("SELECT * FROM devices WHERE mac NOT LIKE 'ip:%'").all() as DeviceRow[];

    const lockdown = getLockdown(now);
    if (!lockdown && this.prevLockdown !== null) {
      addEvent('access', 'success', 'Internet di nuovo per tutti', 'Modalità «solo alcuni dispositivi» terminata');
      setLockdown(null);
    }
    const allow = lockdown ? devices.filter((d) => d.essential || lockdown.allow.includes(d.id)).map((d) => d.mac) : [];
    if (lockdown && this.prevLockdown !== lockdown.started) {
      // a lockdown just started: cut the open connections of everyone outside the allow list
      for (const d of devices) if (!allow.includes(d.mac)) this.pendingKill.add(d.mac);
    }
    this.prevLockdown = lockdown?.started ?? null;
    kvSet('access_prev_lockdown', this.prevLockdown);

    // per-device blocks (manual / schedule / cap); the lockdown is enforced by the allow list
    const block: Array<[string, number | null]> = [];
    for (const d of devices) {
      const a = evaluate(d, now, null);
      this.capWarning(d, a);
      if (a.blocked) block.push([d.mac, a.until]);
      const was = this.prev.get(d.id) ?? false;
      if (a.blocked === was) continue;
      this.prev.set(d.id, a.blocked);
      // cap events are pushed; manual and scheduled changes are only logged
      const type = a.reasons.includes('cap') ? 'access' : 'access_info';
      if (a.blocked) {
        this.pendingKill.add(d.mac);
        addEvent(type, a.reasons.includes('cap') ? 'warning' : 'info', `Internet sospeso: ${displayName(d)}`,
          `${a.reasons.map((r) => REASON_LABEL[r]).join(' · ')} · ${a.until ? `fino a ${hhmm(a.until)}` : 'fino alla riattivazione'}`, d.id);
      } else {
        addEvent('access_info', 'success', `Internet riattivato: ${displayName(d)}`, null, d.id);
      }
    }
    kvSet('access_prev', Object.fromEntries(this.prev));

    await this.apply(block, allow, lockdown, now);
  }

  private capWarning(d: DeviceRow, a: AccessInfo) {
    if (!a.cap || a.cap.used < a.cap.bytes * 0.8 || a.cap.used >= a.cap.bytes) return;
    addEventOnce(`cap80:${d.id}:${a.cap.start}`, 'access', 'warning', `Limite dati quasi raggiunto: ${displayName(d)}`,
      `${fmtBytes(a.cap.used)} di ${fmtBytes(a.cap.bytes)}`, d.id);
  }

  private async apply(block: Array<[string, number | null]>, allow: string[], lockdown: Lockdown | null, now: number) {
    const router = this.getRouter();
    const active = block.length > 0 || !!lockdown;
    const sig = JSON.stringify([block, allow, lockdown?.until ?? 0]);
    const boot = kvGet<number | null>('router_boot', null);
    const due = sig !== this.lastSig || this.pendingKill.size > 0 || boot !== this.lastBoot || (active && now - this.lastApply > 300);
    if (!due) return;
    if (!router || !state.router) {
      if (active) collectorError('router.access', new Error('router non raggiungibile: blocchi non applicati'));
      return;
    }
    if (state.router.plugin < ACCESS_PLUGIN) {
      if (active) collectorError('router.access', new Error('aggiorna il plugin del router (install.sh) per usare pause e limiti'));
      else collectorDisabled('router.access');
      this.lastSig = sig;
      return;
    }
    const kill = [...this.pendingKill];
    try {
      const res = await router.access({
        block: block.map(([mac, until]) => (until ? `${mac}=${Math.max(1, until - now)}` : mac)).join(' '),
        allow: allow.join(' '),
        lock: String(lockdown ? Math.max(1, lockdown.until - now) : 0),
        wan: [...new Set((state.router.wan ?? []).map((w) => w.device).filter(Boolean))].join(' '),
        kill: kill.join(' '),
      });
      for (const m of kill) this.pendingKill.delete(m);
      this.lastSig = sig;
      this.lastApply = now;
      this.lastBoot = boot;
      state.access = { appliedAt: now, conntrack: res.conntrack ?? null };
      if (active || state.collectors['router.access']) collectorOk('router.access');
    } catch (e) {
      collectorError('router.access', e);
    }
  }
}
