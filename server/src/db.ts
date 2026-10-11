import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'homenet.db');
export const db = new Database(DB_PATH);

// auto_vacuum must be set before the first table is created.
db.pragma('auto_vacuum = INCREMENTAL');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -8000'); // ~8 MB page cache, keeps RSS small
db.pragma('foreign_keys = OFF');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  mac TEXT UNIQUE NOT NULL,          -- real MAC or "ip:<addr>" for clients without a known MAC
  hostname TEXT,
  alias TEXT,
  kind TEXT,
  ip TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  notify_offline INTEGER NOT NULL DEFAULT 0,
  wifi_signal INTEGER,
  wifi_iface TEXT
);

CREATE TABLE IF NOT EXISTS domains (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, base TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS domains_base ON domains(base);
CREATE TABLE IF NOT EXISTS asns (asn INTEGER PRIMARY KEY, org TEXT);
CREATE TABLE IF NOT EXISTS ip_domain (ip TEXT PRIMARY KEY, domain_id INTEGER NOT NULL, ts INTEGER NOT NULL);

-- per-device byte counters, 5-minute buckets (sparklines, totals)
CREATE TABLE IF NOT EXISTS traffic_5m (
  ts INTEGER NOT NULL, device_id INTEGER NOT NULL, up INTEGER NOT NULL, down INTEGER NOT NULL,
  PRIMARY KEY (ts, device_id)
) WITHOUT ROWID;

-- per-device per-destination flows, hourly buckets
CREATE TABLE IF NOT EXISTS flows_1h (
  ts INTEGER NOT NULL, device_id INTEGER NOT NULL, ip TEXT NOT NULL, proto INTEGER NOT NULL, port INTEGER NOT NULL,
  up INTEGER NOT NULL, down INTEGER NOT NULL, conns INTEGER NOT NULL,
  cc TEXT, asn INTEGER, domain_id INTEGER,
  PRIMARY KEY (ts, device_id, ip, proto, port)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS flows_dev ON flows_1h(device_id, ts);

-- DNS queries per device per domain, hourly buckets (from AdGuard)
CREATE TABLE IF NOT EXISTS dns_1h (
  ts INTEGER NOT NULL, device_id INTEGER NOT NULL, domain_id INTEGER NOT NULL,
  queries INTEGER NOT NULL, blocked INTEGER NOT NULL,
  PRIMARY KEY (ts, device_id, domain_id)
) WITHOUT ROWID;

-- one row per minute: connectivity, throughput and radio signal
CREATE TABLE IF NOT EXISTS samples (
  ts INTEGER PRIMARY KEY,
  online INTEGER, latency REAL, loss REAL,
  rx_bps REAL, tx_bps REAL, router_ok INTEGER,
  signal TEXT
);

-- bytes per WAN interface per local day (kept 400 days, used for monthly LTE usage)
CREATE TABLE IF NOT EXISTS wan_daily (
  day TEXT NOT NULL, iface TEXT NOT NULL, kind TEXT NOT NULL, rx INTEGER NOT NULL, tx INTEGER NOT NULL,
  PRIMARY KEY (day, iface)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  device_id INTEGER
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
`);

export function kvGet<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function kvSet(key: string, value: unknown) {
  db.prepare('INSERT INTO kv (key, value, ts) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, ts = excluded.ts')
    .run(key, JSON.stringify(value), Math.floor(Date.now() / 1000));
}

const domainCache = new Map<string, number>();
const insDomain = db.prepare('INSERT OR IGNORE INTO domains (name, base) VALUES (?, ?)');
const getDomain = db.prepare('SELECT id FROM domains WHERE name = ?');

export function domainId(name: string, base: string): number {
  let id = domainCache.get(name);
  if (id !== undefined) return id;
  insDomain.run(name, base);
  id = (getDomain.get(name) as { id: number }).id;
  if (domainCache.size > 50_000) domainCache.clear();
  domainCache.set(name, id);
  return id;
}

/** Deletes everything older than the retention window and gives the space back to the OS. */
export function prune(retentionDays: number) {
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM traffic_5m WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM flows_1h WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM dns_1h WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM samples WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM ip_domain WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM wan_daily WHERE day < ?').run(localDay(Date.now() / 1000 - 400 * 86400));
    db.prepare('DELETE FROM kv WHERE key LIKE \'seen:%\' AND ts < ?').run(cutoff);
    // pseudo devices (no MAC) that have not been seen for the whole window
    db.prepare("DELETE FROM devices WHERE mac LIKE 'ip:%' AND last_seen < ?").run(cutoff);
    // domains no longer referenced anywhere (random CDN sub-domains pile up otherwise)
    db.prepare(`DELETE FROM domains WHERE id NOT IN (SELECT domain_id FROM dns_1h)
      AND id NOT IN (SELECT domain_id FROM flows_1h WHERE domain_id IS NOT NULL)
      AND id NOT IN (SELECT domain_id FROM ip_domain)`).run();
  });
  tx();
  domainCache.clear();
  db.pragma('incremental_vacuum');
  db.pragma('wal_checkpoint(TRUNCATE)');
}

/** YYYY-MM-DD in the container's local time zone (set TZ to get your local days). */
export function localDay(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dbSizeBytes(): number {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try { total += fs.statSync(DB_PATH + suffix).size; } catch { /* missing */ }
  }
  return total;
}
