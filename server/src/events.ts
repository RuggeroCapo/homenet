import { db, kvGet, kvSet } from './db.js';
import { notifyEvent } from './notify.js';

export type Severity = 'info' | 'success' | 'warning' | 'error';

const ins = db.prepare('INSERT INTO events (ts, type, severity, title, detail, device_id) VALUES (?, ?, ?, ?, ?, ?)');

export function addEvent(type: string, severity: Severity, title: string, detail?: string | null, deviceId?: number | null, ts = Math.floor(Date.now() / 1000)) {
  ins.run(ts, type, severity, title, detail ?? null, deviceId ?? null);
  notifyEvent(type, { title, body: detail ?? '', severity, ts });
}

/** Emits an event only once per dedupe key (stored in kv, pruned with the retention window). */
export function addEventOnce(key: string, ...args: Parameters<typeof addEvent>) {
  if (kvGet<number | null>(`seen:${key}`, null) !== null) return false;
  kvSet(`seen:${key}`, Date.now());
  addEvent(...args);
  return true;
}

const regionNames = new Intl.DisplayNames(['it'], { type: 'region' });
export function countryName(cc: string | null | undefined) {
  if (!cc) return 'Sconosciuto';
  try { return regionNames.of(cc) ?? cc; } catch { return cc; }
}

export function fmtBytes(n: number) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n.toLocaleString('it-IT', { maximumFractionDigits: n >= 100 || i === 0 ? 0 : 1 })} ${u[i]}`;
}
