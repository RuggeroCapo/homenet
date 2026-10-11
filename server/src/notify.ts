// Push notifications (ntfy, Telegram, Home Assistant notify) for selected events.
// Messages raised while internet is down are queued and retried, so "internet down"
// still reaches the phone once the connection is back.
import { log } from './log.js';
import { getSettings, type Settings } from './settings.js';

export interface Notice { title: string; body: string; severity: 'info' | 'success' | 'warning' | 'error'; ts: number }

type Group = keyof Settings['notify']['types'];

const GROUP: Record<string, Group> = {
  internet_down: 'internet', internet_up: 'internet', wan_down: 'internet', wan_up: 'internet',
  geo_alert: 'geo',
  new_device: 'newDevice',
  device_offline: 'deviceOffline', device_online: 'deviceOffline',
  action: 'watchdog', watchdog: 'watchdog', router_boot: 'watchdog',
};

const queue: Array<Notice & { tries: number }> = [];
const sentAt: number[] = [];
const MAX_PER_HOUR = 30;
let timer: NodeJS.Timeout | undefined;

function channelsEnabled(s = getSettings().notify) {
  return s.ntfy.enabled || s.telegram.enabled || s.ha.enabled;
}

/** Called for every new event; decides whether it should be pushed. */
export function notifyEvent(type: string, n: Notice) {
  const s = getSettings().notify;
  const group = GROUP[type];
  if (!group || !s.types[group] || !channelsEnabled(s)) return;
  if (Date.now() / 1000 - n.ts > 600) return; // historical/back-filled events
  queue.push({ ...n, tries: 0 });
  if (queue.length > 50) queue.shift();
  void drain();
}

function fmtTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || undefined });
}

async function post(url: string, init: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
}

export async function send(n: Notice, s: Settings = getSettings()) {
  const late = Date.now() / 1000 - n.ts > 120;
  const body = `${n.body}${late ? ` (alle ${fmtTime(n.ts)})` : ''}`;
  const errors: string[] = [];
  const jobs: Array<Promise<void>> = [];
  const { ntfy, telegram, ha } = s.notify;
  if (ntfy.enabled && ntfy.url) {
    jobs.push(post(ntfy.url, {
      method: 'POST',
      body,
      headers: {
        // HTTP headers must be latin-1: strip characters ntfy would reject
        Title: n.title.normalize('NFD').replace(/[^\x20-\x7e]/g, ''),
        Priority: n.severity === 'error' ? 'high' : n.severity === 'warning' ? 'default' : 'low',
        Tags: n.severity === 'error' ? 'rotating_light' : n.severity === 'warning' ? 'warning' : n.severity === 'success' ? 'white_check_mark' : 'information_source',
        ...(ntfy.token ? { Authorization: `Bearer ${ntfy.token}` } : {}),
      },
    }).catch((e) => { errors.push(`ntfy: ${e.message}`); }));
  }
  if (telegram.enabled && telegram.botToken && telegram.chatId) {
    jobs.push(post(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram.chatId, text: `${n.title}\n${body}` }),
    }).catch((e) => { errors.push(`telegram: ${e.message}`); }));
  }
  if (ha.enabled && ha.service && s.homeassistant.url && s.homeassistant.token) {
    const service = ha.service.replace(/^notify\./, '');
    jobs.push(post(`${s.homeassistant.url.replace(/\/+$/, '')}/api/services/notify/${service}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${s.homeassistant.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: `HomeNet: ${n.title}`, message: body }),
    }).catch((e) => { errors.push(`home assistant: ${e.message}`); }));
  }
  await Promise.all(jobs);
  if (errors.length) throw new Error(errors.join(' · '));
}

async function drain() {
  if (timer) return; // a retry is scheduled; it will drain everything
  while (queue.length) {
    const now = Date.now();
    while (sentAt.length && sentAt[0] < now - 3600_000) sentAt.shift();
    if (sentAt.length >= MAX_PER_HOUR) { queue.length = 0; log.warn('notify: hourly limit reached, dropping'); return; }
    const n = queue[0];
    try {
      await send(n);
      sentAt.push(now);
      queue.shift();
    } catch (e) {
      n.tries++;
      if (n.tries >= 60) { queue.shift(); log.warn(`notify: giving up on "${n.title}": ${String(e)}`); continue; }
      timer = setTimeout(() => { timer = undefined; void drain(); }, 60_000);
      return;
    }
  }
}
