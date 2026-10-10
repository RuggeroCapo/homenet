import { db } from './db.js';

export interface Settings {
  router: { url: string; username: string; password: string };
  adguard: { url: string; username: string; password: string };
  retentionDays: number;
  homeCountry: string;
  probeTargets: string[];
  watchdog: {
    enabled: boolean;
    /** minutes offline before the first recovery action */
    downMinutes: number;
    firstAction: 'restart_wan' | 'modem_reset' | 'none';
    /** minutes after the first action before rebooting the router */
    escalateMinutes: number;
    maxRebootsPer6h: number;
    /** optional last resort: power-cycle the router through a Home Assistant switch */
    ha: { enabled: boolean; url: string; token: string; entityId: string };
  };
  watchlist: { countries: string[]; asnKeywords: string[]; minBytes: number };
}

const env = process.env;

export const DEMO = env.DEMO === '1' || env.DEMO === 'true';

function defaults(): Settings {
  return {
    router: { url: env.ROUTER_URL ?? 'http://192.168.1.1', username: env.ROUTER_USER ?? 'homenet', password: env.ROUTER_PASS ?? '' },
    adguard: { url: env.ADGUARD_URL ?? 'http://host.docker.internal:8095', username: env.ADGUARD_USER ?? '', password: env.ADGUARD_PASS ?? '' },
    retentionDays: Number(env.RETENTION_DAYS ?? 15),
    homeCountry: env.HOME_COUNTRY ?? 'IT',
    probeTargets: ['1.1.1.1:443', '8.8.8.8:443', '9.9.9.9:443'],
    watchdog: {
      enabled: false,
      downMinutes: 5,
      firstAction: 'restart_wan',
      escalateMinutes: 5,
      maxRebootsPer6h: 2,
      ha: { enabled: false, url: 'http://homeassistant.local:8123', token: '', entityId: 'switch.router' },
    },
    watchlist: {
      countries: ['CN', 'RU', 'KP', 'IR', 'HK'],
      asnKeywords: ['alibaba', 'aliyun', 'tencent', 'huawei', 'baidu', 'chinanet', 'china telecom', 'china unicom', 'china mobile', 'bytedance'],
      minBytes: 100_000,
    },
  };
}

function merge<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over) || base === null || typeof base !== 'object' || Array.isArray(base)) {
    return (over === undefined ? base : over) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (k in out) out[k] = merge(out[k], v);
  }
  return out as T;
}

let current: Settings = load();
const listeners: Array<(s: Settings) => void> = [];

function load(): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined;
  return merge(defaults(), row ? JSON.parse(row.value) : {});
}

export function getSettings(): Settings {
  return current;
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.push(fn);
}

export function routerConfigured(s = current) {
  return DEMO || (!!s.router.url && !!s.router.password);
}

export function adguardConfigured(s = current) {
  return DEMO || !!s.adguard.url;
}

const SECRET_PATHS: Array<[keyof Settings, string]> = [['router', 'password'], ['adguard', 'password']];

/** Settings as sent to the browser: secrets replaced by a flag. */
export function publicSettings() {
  const s = structuredClone(current) as Settings & Record<string, unknown>;
  for (const [section, key] of SECRET_PATHS) {
    const sec = s[section] as Record<string, unknown>;
    sec[`has_${key}`] = !!sec[key];
    sec[key] = '';
  }
  s.watchdog.ha = { ...s.watchdog.ha, token: '', has_token: !!current.watchdog.ha.token } as typeof s.watchdog.ha;
  return s;
}

/** Applies a partial update; empty secret fields keep the stored value. */
export function updateSettings(patch: Partial<Settings>) {
  const next = merge(current, patch);
  for (const [section, key] of SECRET_PATHS) {
    const p = (patch as Record<string, Record<string, unknown> | undefined>)[section];
    if (p && p[key] === '') (next[section] as Record<string, unknown>)[key] = (current[section] as Record<string, unknown>)[key];
  }
  if (patch.watchdog?.ha && patch.watchdog.ha.token === '') next.watchdog.ha.token = current.watchdog.ha.token;
  next.retentionDays = Math.min(60, Math.max(1, Math.round(next.retentionDays)));
  next.watchlist.countries = next.watchlist.countries.map((c) => c.trim().toUpperCase()).filter(Boolean);
  next.watchlist.asnKeywords = next.watchlist.asnKeywords.map((c) => c.trim().toLowerCase()).filter(Boolean);
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(next));
  current = next;
  for (const fn of listeners) fn(current);
  return current;
}
