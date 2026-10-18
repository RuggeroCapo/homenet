import { useCallback, useEffect, useRef, useState } from 'react';

export type Range = '1h' | '24h' | '7d' | '15d';
export const RANGE_LABEL: Record<Range, string> = { '1h': 'Ultima ora', '24h': 'Ultime 24 ore', '7d': 'Ultimi 7 giorni', '15d': 'Ultimi 15 giorni' };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Fastify rejects an empty body declared as JSON with 400, so only send the header with a body
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Fetches `path` and refreshes it every `intervalMs` while the tab is visible. */
export function usePoll<T>(path: string | null, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    try {
      const d = await api<T>(p);
      if (pathRef.current === p) { setData(d); setError(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, intervalMs);
    return () => clearInterval(t);
  }, [path, intervalMs, load]);

  return { data, error, reload: load };
}

export function useHashRoute() {
  const get = () => window.location.hash.replace(/^#/, '') || '/';
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => { setRoute(get()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function useStoredState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(v)); }, [key, v]);
  return [v, setV] as const;
}

// ---------- formatting ----------

export function fmtBytes(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (Math.abs(n) >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n.toLocaleString('it-IT', { maximumFractionDigits: i === 0 || n >= 100 ? 0 : digits })} ${u[i]}`;
}

export function fmtBps(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const u = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${n.toLocaleString('it-IT', { maximumFractionDigits: n >= 100 ? 0 : 1 })} ${u[i]}`;
}

export function splitUnit(s: string) {
  const i = s.lastIndexOf(' ');
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : [s, ''];
}

export const fmtNum = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n >= 10_000 ? `${(n / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} K` : n.toLocaleString('it-IT');

export const fmtPct = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${(n * 100).toLocaleString('it-IT', { maximumFractionDigits: digits })}%`;

export function fmtDuration(secs: number | null | undefined) {
  if (secs === null || secs === undefined) return '—';
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}g ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function fmtWhen(ts: number) {
  const d = new Date(ts * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return fmtTime(ts);
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `ieri ${fmtTime(ts)}`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}
export function fmtAgo(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 90) return 'ora';
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400) return `${Math.round(s / 3600)} h fa`;
  return `${Math.round(s / 86400)} g fa`;
}

const regions = new Intl.DisplayNames(['it'], { type: 'region' });
export function countryName(cc: string | null | undefined) {
  if (!cc) return 'Sconosciuto';
  try { return regions.of(cc) ?? cc; } catch { return cc; }
}
export function flag(cc: string | null | undefined) {
  if (!cc || cc.length !== 2) return '🌐';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** Categorical color follows the entity (device id), never its rank. */
export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
export const seriesColor = (id: number) => SERIES[(id - 1 + SERIES.length) % SERIES.length];

export function hashColor(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SERIES[h % SERIES.length];
}
