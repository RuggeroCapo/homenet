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

-- rollups maintained at write time so long ranges stay cheap on slow CPUs
CREATE TABLE IF NOT EXISTS geo_1h (
  ts INTEGER NOT NULL, device_id INTEGER NOT NULL, cc TEXT NOT NULL, asn INTEGER NOT NULL,
  up INTEGER NOT NULL, down INTEGER NOT NULL, conns INTEGER NOT NULL,
  PRIMARY KEY (ts, device_id, cc, asn)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS base_1h (
  ts INTEGER NOT NULL, device_id INTEGER NOT NULL, base_id INTEGER NOT NULL,
  queries INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ts, device_id, base_id)
) WITHOUT ROWID;

-- same rollups per local day, used for ranges longer than 24 h
CREATE TABLE IF NOT EXISTS geo_1d (
  ts INTEGER NOT NULL, device_id INTEGER NOT NULL, cc TEXT NOT NULL, asn INTEGER NOT NULL,
  up INTEGER NOT NULL, down INTEGER NOT NULL, conns INTEGER NOT NULL,
  PRIMARY KEY (ts, device_id, cc, asn)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS base_1d (
  ts INTEGER NOT NULL, device_id INTEGER NOT NULL, base_id INTEGER NOT NULL,
  queries INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ts, device_id, base_id)
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

-- bytes per device per local day (kept 400 days, used for per-device data caps)
CREATE TABLE IF NOT EXISTS device_daily (
  day TEXT NOT NULL, device_id INTEGER NOT NULL, up INTEGER NOT NULL, down INTEGER NOT NULL,
  PRIMARY KEY (day, device_id)
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

// ---------- column migrations ----------
function addColumn(table: string, column: string, ddl: string, onAdd?: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  if (onAdd) db.exec(onAdd);
}
// internet access control (see access.ts)
addColumn('devices', 'pause_until', 'INTEGER');      // NULL = not paused, 0 = until resumed, else unix time
addColumn('devices', 'override_until', 'INTEGER');   // manual resume: schedule and cap ignored until then
addColumn('devices', 'essential', 'INTEGER NOT NULL DEFAULT 0', "UPDATE devices SET essential = 1 WHERE kind IN ('server', 'homeassistant')");
addColumn('devices', 'cap_bytes', 'INTEGER');
addColumn('devices', 'cap_period', 'TEXT');
addColumn('devices', 'schedule', 'TEXT');

/** Local-midnight bucket for a timestamp (uses the current UTC offset; set TZ for local days). */
export const TZ_OFFSET = -new Date().getTimezoneOffset() * 60;
export function dayBucket(ts: number) {
  const off = -new Date(ts * 1000).getTimezoneOffset() * 60; // per timestamp, so DST changes are handled
  return Math.floor((ts + off) / 86400) * 86400 - off;
}

/** One-time rollup back-fill for databases created before the rollup tables existed. */
export function backfillRollups() {
  const empty = (t: string) => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get() === undefined;
  if (empty('geo_1h') && !empty('flows_1h')) {
    db.exec(`INSERT INTO geo_1h (ts, device_id, cc, asn, up, down, conns)
      SELECT ts, device_id, COALESCE(cc, ''), COALESCE(asn, 0), SUM(up), SUM(down), SUM(conns) FROM flows_1h GROUP BY ts, device_id, COALESCE(cc, ''), COALESCE(asn, 0)`);
  }
  if (empty('base_1h') && !empty('dns_1h')) {
    db.exec(`INSERT OR IGNORE INTO domains (name, base) SELECT DISTINCT base, base FROM domains`);
    db.exec(`INSERT INTO base_1h (ts, device_id, base_id, queries, blocked)
      SELECT q.ts, q.device_id, b.id, SUM(q.queries), SUM(q.blocked) FROM dns_1h q JOIN domains d ON d.id = q.domain_id JOIN domains b ON b.name = d.base
      GROUP BY q.ts, q.device_id, b.id`);
    db.exec(`INSERT INTO base_1h (ts, device_id, base_id, up, down)
      SELECT f.ts, f.device_id, b.id, SUM(f.up), SUM(f.down) FROM flows_1h f JOIN domains d ON d.id = f.domain_id JOIN domains b ON b.name = d.base
      GROUP BY f.ts, f.device_id, b.id
      ON CONFLICT(ts, device_id, base_id) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`);
  }
  const day = `((ts + ${TZ_OFFSET}) / 86400 * 86400 - ${TZ_OFFSET})`;
  if (empty('geo_1d') && !empty('geo_1h')) {
    db.exec(`INSERT INTO geo_1d (ts, device_id, cc, asn, up, down, conns)
      SELECT ${day}, device_id, cc, asn, SUM(up), SUM(down), SUM(conns) FROM geo_1h GROUP BY 1, device_id, cc, asn`);
  }
  if (empty('device_daily') && !empty('traffic_5m')) {
    db.exec(`INSERT INTO device_daily (day, device_id, up, down)
      SELECT date(ts, 'unixepoch', 'localtime'), device_id, SUM(up), SUM(down) FROM traffic_5m GROUP BY 1, device_id`);
  }
  if (empty('base_1d') && !empty('base_1h')) {
    db.exec(`INSERT INTO base_1d (ts, device_id, base_id, queries, blocked, up, down)
      SELECT ${day}, device_id, base_id, SUM(queries), SUM(blocked), SUM(up), SUM(down) FROM base_1h GROUP BY 1, device_id, base_id`);
  }
}
backfillRollups();

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

const baseCache = new Map<number, number>();
/** id of the registrable-domain row ("google.com") for any domain id */
export function baseIdOf(id: number): number {
  let b = baseCache.get(id);
  if (b !== undefined) return b;
  const row = db.prepare('SELECT base FROM domains WHERE id = ?').get(id) as { base: string } | undefined;
  b = row ? domainId(row.base, row.base) : id;
  if (baseCache.size > 50_000) baseCache.clear();
  baseCache.set(id, b);
  return b;
}

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
    db.prepare('DELETE FROM geo_1h WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM base_1h WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM geo_1d WHERE ts < ?').run(dayBucket(cutoff));
    db.prepare('DELETE FROM base_1d WHERE ts < ?').run(dayBucket(cutoff));
    db.prepare('DELETE FROM samples WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM ip_domain WHERE ts < ?').run(cutoff);
    db.prepare('DELETE FROM wan_daily WHERE day < ?').run(localDay(Date.now() / 1000 - 400 * 86400));
    db.prepare('DELETE FROM device_daily WHERE day < ?').run(localDay(Date.now() / 1000 - 400 * 86400));
    db.prepare('DELETE FROM kv WHERE key LIKE \'seen:%\' AND ts < ?').run(cutoff);
    // pseudo devices (no MAC) that have not been seen for the whole window
    db.prepare("DELETE FROM devices WHERE mac LIKE 'ip:%' AND last_seen < ?").run(cutoff);
    // domains no longer referenced anywhere (random CDN sub-domains pile up otherwise)
    db.prepare(`DELETE FROM domains WHERE id NOT IN (SELECT domain_id FROM dns_1h)
      AND id NOT IN (SELECT domain_id FROM flows_1h WHERE domain_id IS NOT NULL)
      AND id NOT IN (SELECT domain_id FROM ip_domain) AND id NOT IN (SELECT base_id FROM base_1h) AND id NOT IN (SELECT base_id FROM base_1d)`).run();
  });
  tx();
  domainCache.clear();
  baseCache.clear();
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
