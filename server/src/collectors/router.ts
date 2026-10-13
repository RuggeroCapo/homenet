// Polls the OpenWrt plugin: status/throughput, hosts, Wi-Fi, conntrack deltas, modem and SMS.
import { db, kvGet, kvSet, localDay } from '../db.js';
import { isLan, markActive, setLanSubnets, setWifi, upsertHost } from '../devices.js';
import { addEvent } from '../events.js';
import { parseInfo, parseModem, parseSms, parseWifi, type AccessArgs, type RouterApi, type WanStatus } from '../router.js';
import { collectorError, collectorOk, state } from '../state.js';
import { ingestFlows } from './flows.js';

const ACTIVE_NEIGH = new Set(['REACHABLE', 'DELAY', 'PROBE', 'PERMANENT']);
const WAN_LABEL: Record<WanStatus['kind'], string> = { lte: 'LTE', wifi: 'Wi-Fi', ethernet: 'Ethernet' };

export class RouterCollector {
  private timers: NodeJS.Timeout[] = [];
  private busy = new Set<string>();
  private prev: { rx: number; tx: number; t: number } | null = null;
  private minute = { rxBits: 0, txBits: 0, secs: 0 };
  private wanUp = new Map<string, boolean>();
  private wanPrev = new Map<string, [number, number]>();
  private wanAcc = new Map<string, { day: string; iface: string; kind: string; rx: number; tx: number }>();
  private lastConntrack = 0;

  constructor(private api: RouterApi) {}

  start() {
    const every = (name: string, ms: number, fn: () => Promise<void>) => {
      const run = async () => {
        if (this.busy.has(name)) return;
        this.busy.add(name);
        try { await fn(); collectorOk(`router.${name}`); } catch (e) { collectorError(`router.${name}`, e); if (name === 'info') state.routerOk = false; } finally { this.busy.delete(name); }
      };
      void run();
      this.timers.push(setInterval(run, ms));
    };
    every('info', 10_000, () => this.info());
    every('hosts', 60_000, () => this.hosts());
    every('wifi', 60_000, () => this.wifi());
    every('conntrack', 15_000, () => this.conntrack());
    every('modem', 60_000, () => this.modem());
    every('sms', 600_000, () => this.sms());
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Average WAN throughput over the last minute (bps), then resets the accumulator. */
  takeMinute() {
    this.flushWanUsage();
    const m = this.minute;
    this.minute = { rxBits: 0, txBits: 0, secs: 0 };
    return m.secs ? { rx: m.rxBits / m.secs, tx: m.txBits / m.secs } : { rx: null, tx: null };
  }

  private lastRaw: Awaited<ReturnType<RouterApi['info']>> | null = null;

  private flushWanUsage() {
    if (!this.wanAcc.size) return;
    const up = db.prepare(`INSERT INTO wan_daily (day, iface, kind, rx, tx) VALUES (@day, @iface, @kind, @rx, @tx)
      ON CONFLICT(day, iface) DO UPDATE SET rx = rx + excluded.rx, tx = tx + excluded.tx, kind = excluded.kind`);
    const rows = [...this.wanAcc.values()];
    this.wanAcc.clear();
    db.transaction(() => { for (const r of rows) up.run(r); })();
  }

  private async info() {
    this.lastRaw = await this.api.info();
    const info = parseInfo(this.lastRaw);
    state.router = info;
    state.routerOk = true;
    setLanSubnets(info.lan4, info.lan6);

    const now = Date.now() / 1000;
    const { rx, tx } = info.wanCounters;
    if (this.prev && rx >= this.prev.rx && tx >= this.prev.tx) {
      const dt = now - this.prev.t;
      if (dt > 0 && dt < 120) {
        const rxBps = ((rx - this.prev.rx) * 8) / dt;
        const txBps = ((tx - this.prev.tx) * 8) / dt;
        state.live.push([Math.floor(now), rxBps, txBps]);
        while (state.live.length && state.live[0][0] < now - 3600) state.live.shift();
        this.minute.rxBits += rxBps * dt;
        this.minute.txBits += txBps * dt;
        this.minute.secs += dt;
      }
    }
    this.prev = { rx, tx, t: now };

    if (info.uptime !== undefined) {
      const boot = Math.floor(now - info.uptime);
      const prevBoot = kvGet<number | null>('router_boot', null);
      if (prevBoot !== null && Math.abs(boot - prevBoot) > 120) addEvent('router_boot', 'info', 'Router riavviato', info.model ?? null, null, boot);
      if (prevBoot === null || Math.abs(boot - prevBoot) > 120) kvSet('router_boot', boot);
    }

    const raw = this.lastRaw;
    for (const w of info.wan) {
      const c = w.up && w.device ? raw?.netdev?.[w.device] : undefined;
      if (c) {
        const prev = this.wanPrev.get(w.iface);
        if (prev && c[0] >= prev[0] && c[1] >= prev[1]) {
          const key = `${localDay(now)}|${w.iface}`;
          const a = this.wanAcc.get(key) ?? { day: localDay(now), iface: w.iface, kind: w.kind, rx: 0, tx: 0 };
          a.rx += c[0] - prev[0]; a.tx += c[1] - prev[1];
          this.wanAcc.set(key, a);
        }
        this.wanPrev.set(w.iface, [c[0], c[1]]);
      } else this.wanPrev.delete(w.iface);
      const before = this.wanUp.get(w.iface);
      if (before !== undefined && before !== w.up) {
        addEvent(w.up ? 'wan_up' : 'wan_down', w.up ? 'success' : 'error',
          w.up ? `Connessione ${WAN_LABEL[w.kind]} attiva` : `Connessione ${WAN_LABEL[w.kind]} persa`, `Interfaccia ${w.iface}`);
      }
      this.wanUp.set(w.iface, w.up);
    }
  }

  private async hosts() {
    const raw = await this.api.hosts();
    for (const [mac, ip, name] of raw.leases ?? []) if (mac && ip) upsertHost(mac, ip, name);
    for (const [ip, mac, st] of raw.neigh ?? []) {
      if (!isLan(ip) || !mac || mac === '00:00:00:00:00:00') continue;
      const id = upsertHost(mac, ip, null);
      if (ACTIVE_NEIGH.has(st)) markActive(id);
    }
  }

  private async wifi() {
    state.wifi = parseWifi(await this.api.wifi());
    const map = new Map<string, { signal?: number; iface: string }>();
    for (const r of state.wifi) {
      for (const c of r.clients) if ((c.inactive ?? 0) < 60_000) map.set(c.mac, { signal: c.signal, iface: r.device });
    }
    setWifi(map);
  }

  private async conntrack() {
    const raw = await this.api.conntrack();
    if (raw.error) throw new Error(raw.error);
    state.conntrackTruncated = raw.truncated ?? 0;
    const now = Date.now() / 1000;
    const windowSecs = this.lastConntrack ? now - this.lastConntrack : 0;
    this.lastConntrack = now;
    if (!raw.seed) ingestFlows(raw.flows ?? [], Math.floor(now), windowSecs > 0 && windowSecs < 120 ? windowSecs : 0);
  }

  private async modem() {
    state.modem = parseModem(await this.api.modem());
  }

  private async sms() {
    state.sms = parseSms(await this.api.sms()).slice(-30).reverse();
  }

  access(args: AccessArgs) {
    return this.api.access(args);
  }

  async action(name: 'reboot' | 'restart_wan' | 'modem_reset') {
    const wan = state.router?.wan ?? [];
    const ifaces = name === 'modem_reset' ? wan.filter((w) => w.kind === 'lte').map((w) => w.iface) : wan.map((w) => w.iface);
    await this.api.action(name, ifaces.length ? ifaces : ['wan']);
  }
}
