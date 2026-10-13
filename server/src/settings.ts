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
    ha: { enabled: boolean; entityId: string };
  };
  homeassistant: { url: string; token: string };
  /** mobile data plan: billing cycle start day and optional monthly allowance */
  dataPlan: { cycleDay: number; quotaGb: number };
  notify: {
    ntfy: { enabled: boolean; url: string; token: string };
    telegram: { enabled: boolean; botToken: string; chatId: string };
    ha: { enabled: boolean; service: string };
    /** which event groups are pushed */
    types: { internet: boolean; geo: boolean; newDevice: boolean; deviceOffline: boolean; watchdog: boolean; access: boolean };
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
      ha: { enabled: false, entityId: 'switch.router' },
    },
    dataPlan: { cycleDay: 1, quotaGb: 0 },
    homeassistant: { url: env.HA_URL ?? 'http://homeassistant.local:8123', token: env.HA_TOKEN ?? '' },
    notify: {
      ntfy: { enabled: false, url: 'https://ntfy.sh/homenet-change-me', token: '' },
      telegram: { enabled: false, botToken: '', chatId: '' },
      ha: { enabled: false, service: 'mobile_app_iphone' },
      types: { internet: true, geo: true, newDevice: true, deviceOffline: true, watchdog: true, access: true },
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

/** Secret fields: never sent to the browser; an empty value in an update keeps the stored one. */
const SECRET_PATHS = ['router.password', 'adguard.password', 'homeassistant.token', 'notify.ntfy.token', 'notify.telegram.botToken'];

function getPath(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o);
}
function setPath(o: unknown, path: string, v: unknown) {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<unknown>((a, k) => (a as Record<string, unknown>)[k], o) as Record<string, unknown>;
  parent[last] = v;
}

/** Settings as sent to the browser: secrets replaced by a has_<field> flag. */
export function publicSettings() {
  const s = structuredClone(current);
  for (const path of SECRET_PATHS) {
    const keys = path.split('.');
    const field = keys[keys.length - 1];
    setPath(s, [...keys.slice(0, -1), `has_${field}`].join('.'), !!getPath(current, path));
    setPath(s, path, '');
  }
  return s;
}

/** Applies a partial update; empty secret fields keep the stored value. */
export function updateSettings(patch: Partial<Settings>) {
  const next = merge(current, patch);
  for (const path of SECRET_PATHS) {
    if (getPath(patch, path) === '') setPath(next, path, getPath(current, path));
  }
  next.retentionDays = Math.min(60, Math.max(1, Math.round(next.retentionDays)));
  next.dataPlan.cycleDay = Math.min(28, Math.max(1, Math.round(next.dataPlan.cycleDay)));
  next.dataPlan.quotaGb = Math.max(0, Number(next.dataPlan.quotaGb) || 0);
  next.watchlist.countries = next.watchlist.countries.map((c) => c.trim().toUpperCase()).filter(Boolean);
  next.watchlist.asnKeywords = next.watchlist.asnKeywords.map((c) => c.trim().toLowerCase()).filter(Boolean);
  db.prepare("INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(next));
  current = next;
  for (const fn of listeners) fn(current);
  return current;
}
