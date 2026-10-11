import type { FastifyInstance } from 'fastify';
import { AdGuardClient } from './adguard.js';
import { categoryOf } from './categories.js';
import type { RouterCollector } from './collectors/router.js';
import { runAction } from './collectors/watchdog.js';
import { dayBucket, db, dbSizeBytes, localDay } from './db.js';
import { displayName, getDevice, type DeviceRow } from './devices.js';
import { geoStatus } from './geo.js';
import { UbusClient } from './router.js';
import { adguardConfigured, DEMO, getSettings, publicSettings, routerConfigured, updateSettings, type Settings } from './settings.js';
import { state } from './state.js';
import { send as sendNotice } from './notify.js';

const VERSION = process.env.npm_package_version ?? '0.1.0';
const started = Date.now();

const RANGES: Record<string, number> = { '1h': 3600, '24h': 86400, '7d': 7 * 86400, '15d': 15 * 86400, '30d': 30 * 86400 };

function range(q: { range?: string }) {
  const secs = RANGES[q.range ?? '24h'] ?? 86400;
  const to = Math.floor(Date.now() / 1000);
  return { secs, from: to - secs, to };
}

/** Bucket size for 5-minute traffic data and for minute samples. */
const trafficBucket = (secs: number) => (secs <= 86400 ? 300 : secs <= 7 * 86400 ? 3600 : 7200);
const sampleBucket = (secs: number) => (secs <= 3600 ? 60 : secs <= 86400 ? 300 : secs <= 7 * 86400 ? 1800 : 3600);
const hourStart = (t: number) => t - (t % 3600);

/** Rollup tables + bucket start for a range: hourly up to 24 h, daily beyond. */
function rollup(from: number, secs: number) {
  return secs > 86400 ? { geo: 'geo_1d', base: 'base_1d', start: dayBucket(from) } : { geo: 'geo_1h', base: 'base_1h', start: hourStart(from) };
}

function axis(from: number, to: number, b: number) {
  const start = Math.floor(from / b) * b + b;
  const out: number[] = [];
  for (let t = start; t <= to; t += b) out.push(t);
  return out;
}

interface DevTotals { device_id: number; up: number; down: number }

function deviceTotals(from: number) {
  return db.prepare('SELECT device_id, SUM(up) AS up, SUM(down) AS down FROM traffic_5m WHERE ts >= ? GROUP BY device_id').all(from) as DevTotals[];
}

function sparklines(from: number, to: number, secs: number, ids?: number[]) {
  const b = trafficBucket(secs);
  const ax = axis(from, to, b);
  const index = new Map(ax.map((t, i) => [t, i]));
  const rows = db.prepare(`SELECT device_id, (ts / ${b}) * ${b} + ${b} AS t, SUM(up + down) AS v FROM traffic_5m WHERE ts >= ? GROUP BY device_id, t`).all(from) as Array<{ device_id: number; t: number; v: number }>;
  const out = new Map<number, number[]>();
  for (const r of rows) {
    if (ids && !ids.includes(r.device_id)) continue;
    const i = index.get(r.t);
    if (i === undefined) continue;
    let arr = out.get(r.device_id);
    if (!arr) out.set(r.device_id, (arr = new Array(ax.length).fill(0)));
    arr[i] += r.v;
  }
  return out;
}

function allDevices() {
  return db.prepare('SELECT * FROM devices').all() as DeviceRow[];
}

function liveRate(id: number) {
  const r = state.deviceRates.get(id);
  return r && Date.now() / 1000 - r.ts < 60 ? { rateUp: r.up, rateDown: r.down } : { rateUp: 0, rateDown: 0 };
}

/** Usage in the current billing cycle (LTE interfaces only when present, else all WANs). */
export function dataUsage() {
  const plan = getSettings().dataPlan;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), plan.cycleDay);
  if (now.getDate() < plan.cycleDay) start.setMonth(start.getMonth() - 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  const ts = (d: Date) => Math.floor(d.getTime() / 1000);
  const hasLte = (db.prepare("SELECT 1 FROM wan_daily WHERE kind = 'lte' LIMIT 1").get()) !== undefined;
  const kindFilter = hasLte ? "AND kind = 'lte'" : '';
  const tot = db.prepare(`SELECT COALESCE(SUM(rx), 0) AS rx, COALESCE(SUM(tx), 0) AS tx FROM wan_daily WHERE day >= ? AND day < ? ${kindFilter}`)
    .get(localDay(ts(start)), localDay(ts(end))) as { rx: number; tx: number };
  const daily = db.prepare(`SELECT day, SUM(rx) AS rx, SUM(tx) AS tx FROM wan_daily WHERE day >= ? ${kindFilter} GROUP BY day ORDER BY day`)
    .all(localDay(ts(now) - 30 * 86400)) as Array<{ day: string; rx: number; tx: number }>;
  const elapsed = Math.max(0.25, (now.getTime() - start.getTime()) / 86400_000);
  const days = (end.getTime() - start.getTime()) / 86400_000;
  const used = tot.rx + tot.tx;
  return {
    kind: hasLte ? 'lte' : 'all',
    start: ts(start), end: ts(end),
    rx: tot.rx, tx: tot.tx, used,
    quota: plan.quotaGb > 0 ? plan.quotaGb * 1e9 : null,
    projected: (used / elapsed) * days,
    daily,
  };
}

function devicePublic(d: DeviceRow) {
  return {
    ...liveRate(d.id),
    id: d.id, name: displayName(d), hostname: d.hostname, alias: d.alias, kind: d.kind ?? 'unknown',
    ip: d.ip ?? (d.mac.startsWith('ip:') ? d.mac.slice(3) : null), mac: d.mac.startsWith('ip:') ? null : d.mac,
    online: !!d.online, lastSeen: d.last_seen, firstSeen: d.first_seen, notifyOffline: !!d.notify_offline,
    wifiSignal: d.wifi_signal, wifiIface: d.wifi_iface,
  };
}

function watchAsns(s: Settings): number[] {
  if (!s.watchlist.asnKeywords.length) return [];
  const where = s.watchlist.asnKeywords.map(() => 'lower(org) LIKE ?').join(' OR ');
  return (db.prepare(`SELECT asn FROM asns WHERE ${where}`).all(...s.watchlist.asnKeywords.map((k) => `%${k}%`)) as Array<{ asn: number }>).map((r) => r.asn);
}

function watchClause(s: Settings) {
  const cc = s.watchlist.countries;
  const asns = watchAsns(s);
  const parts: string[] = [];
  if (cc.length) parts.push(`f.cc IN (${cc.map((c) => `'${c.replace(/[^A-Z]/g, '')}'`).join(',')})`);
  if (asns.length) parts.push(`f.asn IN (${asns.join(',')})`);
  return parts.length ? `(${parts.join(' OR ')})` : '0';
}

/** Registrable domains ranked by DNS queries, with bytes, from the base_1h rollup. */
function topServices(from: number, secs: number, limit: number) {
  const r = rollup(from, secs);
  return db.prepare(`SELECT d.name AS base, SUM(b.queries) AS queries, SUM(b.blocked) AS blocked, COUNT(DISTINCT b.device_id) AS devices,
      SUM(b.up) AS up, SUM(b.down) AS down
    FROM ${r.base} b JOIN domains d ON d.id = b.base_id WHERE b.ts >= ?
    GROUP BY b.base_id HAVING queries > 0 ORDER BY queries DESC LIMIT ${limit}`).all(r.start) as Array<{ base: string; queries: number; blocked: number; devices: number; up: number; down: number }>;
}

// ---- response cache: long ranges are expensive on a 2011 CPU and change slowly ----
const cache = new Map<string, { at: number; value: unknown }>();
const TTL: Record<string, number> = { '1h': 0, '24h': 20_000, '7d': 90_000, '15d': 120_000, '30d': 180_000 };
async function cached<T>(url: string, rangeKey: string | undefined, fn: () => T): Promise<T> {
  const ttl = TTL[rangeKey ?? '24h'] ?? 20_000;
  if (!ttl) return fn();
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = fn();
  if (cache.size > 200) cache.clear();
  cache.set(url, { at: Date.now(), value });
  return value;
}
export function clearApiCache() { cache.clear(); }

function recentEvents(limit: number, before?: number, deviceId?: number) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (before) { where.push('e.id < ?'); args.push(before); }
  if (deviceId) { where.push('e.device_id = ?'); args.push(deviceId); }
  return db.prepare(`SELECT e.* FROM events e ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.ts DESC, e.id DESC LIMIT ${limit}`).all(...args);
}

function samplesSeries(from: number, to: number, secs: number) {
  const b = sampleBucket(secs);
  const rows = db.prepare('SELECT * FROM samples WHERE ts >= ? ORDER BY ts').all(from) as Array<{ ts: number; online: number; latency: number | null; loss: number | null; rx_bps: number | null; tx_bps: number | null; router_ok: number; signal: string | null }>;
  const ax = axis(from, to, b);
  const idx = new Map(ax.map((t, i) => [t, i]));
  type Acc = { n: number; online: number; lat: number[]; loss: number[]; rx: number[]; tx: number[]; q: number[]; rsrp: number[]; sinr: number[]; rsrq: number[]; wifi: number[] };
  const acc: Array<Acc | null> = ax.map(() => null);
  const push = (arr: number[], v: unknown) => { if (typeof v === 'number' && Number.isFinite(v)) arr.push(v); };
  for (const r of rows) {
    const i = idx.get(Math.floor(r.ts / b) * b + b);
    if (i === undefined) continue;
    const a = (acc[i] ??= { n: 0, online: 0, lat: [], loss: [], rx: [], tx: [], q: [], rsrp: [], sinr: [], rsrq: [], wifi: [] });
    a.n++; a.online += r.online;
    push(a.lat, r.latency); push(a.loss, r.loss); push(a.rx, r.rx_bps); push(a.tx, r.tx_bps);
    if (r.signal) {
      const s = JSON.parse(r.signal);
      push(a.q, s.q); push(a.rsrp, s.rsrp); push(a.sinr, s.sinr); push(a.rsrq, s.rsrq); push(a.wifi, s.wifi);
    }
  }
  const avg = (arr: number[]) => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null);
  const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null);
  return {
    bucket: b,
    points: ax.map((t, i) => {
      const a = acc[i];
      if (!a) return { t, online: null, latency: null, loss: null, rx: null, tx: null, rxPeak: null, q: null, rsrp: null, sinr: null, rsrq: null, wifi: null };
      return { t, online: a.online / a.n, latency: avg(a.lat), loss: avg(a.loss), rx: avg(a.rx), tx: avg(a.tx), rxPeak: max(a.rx), q: avg(a.q), rsrp: avg(a.rsrp), sinr: avg(a.sinr), rsrq: avg(a.rsrq), wifi: avg(a.wifi) };
    }),
  };
}

export function registerApi(app: FastifyInstance, getRouter: () => RouterCollector | null) {
  app.get('/api/status', async () => ({
    version: VERSION,
    demo: DEMO,
    uptime: Math.floor((Date.now() - started) / 1000),
    rss: process.memoryUsage().rss,
    dbSize: dbSizeBytes(),
    retentionDays: getSettings().retentionDays,
    geo: geoStatus(),
    configured: { router: routerConfigured(), adguard: adguardConfigured() },
    collectors: state.collectors,
    routerOk: state.routerOk,
    conntrackTruncated: state.conntrackTruncated,
    offload: state.router?.offload ?? false,
    acct: state.router?.acct ?? true,
  }));

  // ---- umbrelOS home-screen widgets (fetched by umbreld at server:3000) ----
  app.get('/api/widget/status', async () => {
    const live = state.live.at(-1);
    const mbps = live ? live[1] / 1e6 : null;
    const online = (db.prepare('SELECT COUNT(*) AS n FROM devices WHERE online = 1').get() as { n: number }).n;
    return {
      type: 'four-stats',
      link: '',
      items: [
        { title: 'Internet', text: state.internet.online ? 'Online' : 'Offline', subtext: '' },
        { title: 'Latenza', text: state.internet.latency !== null ? String(state.internet.latency) : '—', subtext: 'ms' },
        { title: 'Download', text: mbps === null ? '—' : mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1), subtext: 'Mbps' },
        { title: 'Dispositivi', text: String(online), subtext: 'online' },
      ],
    };
  });

  app.get('/api/widget/usage', async () => {
    const u = dataUsage();
    const gb = (b: number) => (b / 1e9).toLocaleString('it-IT', { maximumFractionDigits: b >= 1e11 ? 0 : 1 });
    return {
      type: 'text-with-progress',
      link: '/#/monitor',
      title: u.kind === 'lte' ? 'Dati LTE nel ciclo' : 'Dati WAN nel ciclo',
      text: `${gb(u.used)} GB`,
      progressLabel: u.quota ? `di ${gb(u.quota)} GB · stima ${gb(u.projected)} GB` : `stima fine ciclo ${gb(u.projected)} GB`,
      progress: u.quota ? Math.min(1, u.used / u.quota) : 0,
    };
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/overview', async (req) => cached(req.url, (req.query as { range?: string }).range, () => {
    const { from, to, secs } = range(req.query as { range?: string });
    const s = getSettings();
    const devs = allDevices();
    const totals = deviceTotals(from);
    const byId = new Map(devs.map((d) => [d.id, d]));
    const ranked = totals.map((t) => ({ ...t, total: t.up + t.down })).filter((t) => byId.has(t.device_id)).sort((a, b) => b.total - a.total);
    const top = ranked.slice(0, 5);
    const sparks = sparklines(from, to, secs, top.map((t) => t.device_id));

    const services = topServices(from, secs, 5);
    const ru = rollup(from, secs);
    const totalQ = (db.prepare(`SELECT SUM(queries) AS q, SUM(blocked) AS b FROM ${ru.base} WHERE ts >= ?`).get(ru.start) as { q: number | null; b: number | null });

    // network map: top devices ↔ top services by DNS activity
    const mapDevices = top.map((t) => t.device_id);
    const mapServices = services.map((x) => x.base);
    let links: Array<{ device: number; service: string; weight: number }> = [];
    if (mapDevices.length && mapServices.length) {
      links = db.prepare(`SELECT b.device_id AS device, d.name AS service, SUM(b.queries) AS weight FROM ${ru.base} b JOIN domains d ON d.id = b.base_id
        WHERE b.ts >= ? AND b.device_id IN (${mapDevices.join(',')}) AND d.name IN (${mapServices.map(() => '?').join(',')})
        GROUP BY b.device_id, d.name`).all(ru.start, ...mapServices) as typeof links;
    }

    const samples = samplesSeries(from, to, secs);
    const lossRow = db.prepare('SELECT AVG(loss) AS loss, AVG(online) AS avail FROM samples WHERE ts >= ?').get(to - 3600) as { loss: number | null; avail: number | null };
    const avail = db.prepare('SELECT AVG(online) AS a FROM samples WHERE ts >= ?').get(from) as { a: number | null };
    const geoTop = db.prepare(`SELECT cc, SUM(up) AS up, SUM(down) AS down FROM ${ru.geo} WHERE ts >= ? AND cc != '' GROUP BY cc ORDER BY SUM(up) + SUM(down) DESC LIMIT 6`).all(ru.start);
    const flagged = db.prepare(`SELECT COUNT(DISTINCT f.device_id) AS n, SUM(f.up) AS up FROM ${ru.geo} f WHERE f.ts >= ? AND ${watchClause(s)}`).get(ru.start) as { n: number; up: number | null };
    const live = state.live.at(-1);

    return {
      internet: { ...state.internet, routerOk: state.routerOk, routerUptime: state.router?.uptime ?? null, loss: lossRow.loss, availability: avail.a },
      configured: { router: routerConfigured(), adguard: adguardConfigured() },
      wan: state.router?.wan ?? [],
      modem: state.modem,
      usage: dataUsage(),
      uplinkWifi: state.wifi.find((r) => r.mode === 'Client') ?? null,
      traffic: {
        rx: live?.[1] ?? null, tx: live?.[2] ?? null,
        series: samples.points.map((p) => [p.t, p.rx, p.tx, p.latency]),
        live: state.live.slice(-60),
        totalDown: totals.reduce((a, t) => a + t.down, 0),
        totalUp: totals.reduce((a, t) => a + t.up, 0),
      },
      devices: top.map((t) => ({ ...devicePublic(byId.get(t.device_id)!), up: t.up, down: t.down, total: t.total, spark: sparks.get(t.device_id) ?? [] })),
      deviceCount: { total: devs.filter((d) => d.last_seen >= from).length, online: devs.filter((d) => d.online).length },
      dns: { queries: totalQ.q ?? 0, blocked: totalQ.b ?? 0 },
      services: services.map((x) => ({ ...x, category: categoryOf(x.base), pct: totalQ.q ? x.queries / totalQ.q : 0 })),
      map: { devices: mapDevices, services: mapServices, links, otherServices: Math.max(0, (db.prepare(`SELECT COUNT(DISTINCT base_id) AS n FROM ${ru.base} WHERE ts >= ? AND queries > 0`).get(ru.start) as { n: number }).n - mapServices.length) },
      geo: { top: geoTop, flaggedDevices: flagged.n ?? 0, flaggedUp: flagged.up ?? 0, homeCountry: s.homeCountry },
      events: recentEvents(6),
    };
  }));

  app.get('/api/devices', async (req) => cached(req.url, (req.query as { range?: string }).range, () => {
    const { from, to, secs } = range(req.query as { range?: string });
    const s = getSettings();
    const totals = new Map(deviceTotals(from).map((t) => [t.device_id, t]));
    const sparks = sparklines(from, to, secs);
    const ru = rollup(from, secs);
    const dns = new Map((db.prepare(`SELECT device_id, SUM(queries) AS q, SUM(blocked) AS b FROM ${ru.base} WHERE ts >= ? GROUP BY device_id`).all(ru.start) as Array<{ device_id: number; q: number; b: number }>).map((r) => [r.device_id, r]));
    const flagged = new Map((db.prepare(`SELECT f.device_id AS id, SUM(f.up) AS up, GROUP_CONCAT(DISTINCT f.cc) AS ccs FROM ${ru.geo} f WHERE f.ts >= ? AND ${watchClause(s)} GROUP BY f.device_id`).all(ru.start) as Array<{ id: number; up: number; ccs: string | null }>).map((r) => [r.id, r]));
    const countries = new Map<number, number>();
    for (const r of db.prepare(`SELECT device_id, COUNT(DISTINCT cc) AS n FROM ${ru.geo} WHERE ts >= ? AND cc != '' GROUP BY device_id`).all(ru.start) as Array<{ device_id: number; n: number }>) countries.set(r.device_id, r.n);
    return allDevices()
      .filter((d) => d.last_seen >= from || d.online || totals.has(d.id))
      .map((d) => {
        const t = totals.get(d.id);
        const q = dns.get(d.id);
        const f = flagged.get(d.id);
        return {
          ...devicePublic(d), up: t?.up ?? 0, down: t?.down ?? 0, total: (t?.up ?? 0) + (t?.down ?? 0),
          spark: sparks.get(d.id) ?? [], queries: q?.q ?? 0, blocked: q?.b ?? 0, countries: countries.get(d.id) ?? 0,
          flagged: f ? { up: f.up, countries: f.ccs?.split(',').filter(Boolean) ?? [] } : null,
        };
      })
      .sort((a, b) => Number(b.online) - Number(a.online) || b.total - a.total);
  }));

  app.get('/api/devices/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const d = getDevice(id);
    if (!d) return reply.code(404).send({ error: 'not found' });
    const { from, to, secs } = range(req.query as { range?: string });
    const s = getSettings();
    const b = trafficBucket(secs);
    const ax = axis(from, to, b);
    const idx = new Map(ax.map((t, i) => [t, i]));
    const series = ax.map((t) => [t, 0, 0] as [number, number, number]);
    for (const r of db.prepare(`SELECT (ts / ${b}) * ${b} + ${b} AS t, SUM(up) AS up, SUM(down) AS down FROM traffic_5m WHERE device_id = ? AND ts >= ? GROUP BY t`).all(id, from) as Array<{ t: number; up: number; down: number }>) {
      const i = idx.get(r.t);
      if (i !== undefined) { series[i][1] = r.down; series[i][2] = r.up; }
    }
    const hs = hourStart(from);
    const wAsns = new Set(watchAsns(s));
    const destRows = db.prepare(`SELECT f.ip, SUM(f.up) AS up, SUM(f.down) AS down, SUM(f.conns) AS conns, f.cc, f.asn, a.org,
        GROUP_CONCAT(DISTINCT f.port) AS ports, MAX(f.domain_id) AS domain_id
      FROM flows_1h f LEFT JOIN asns a ON a.asn = f.asn
      WHERE f.device_id = ? AND f.ts >= ? GROUP BY f.ip ORDER BY SUM(up) + SUM(down) DESC LIMIT 150`).all(id, hs) as Array<Record<string, unknown> & { cc: string | null; asn: number | null; up: number; down: number; domain_id: number | null }>;
    const domIds = [...new Set(destRows.map((r) => r.domain_id).filter((x): x is number => x !== null))];
    const domNames = new Map(domIds.length
      ? (db.prepare(`SELECT id, name, base FROM domains WHERE id IN (${domIds.join(',')})`).all() as Array<{ id: number; name: string; base: string }>).map((r) => [r.id, r])
      : []);
    const destinations = destRows.map((r) => ({
      ...r,
      domain: r.domain_id !== null ? domNames.get(r.domain_id)?.name ?? null : null,
      base: r.domain_id !== null ? domNames.get(r.domain_id)?.base ?? null : null,
      flagged: (!!r.cc && s.watchlist.countries.includes(r.cc)) || (!!r.asn && wAsns.has(r.asn)),
    }));
    const countries = db.prepare(`SELECT cc, SUM(up) AS up, SUM(down) AS down, COUNT(DISTINCT ip) AS ips FROM flows_1h WHERE device_id = ? AND ts >= ? GROUP BY cc ORDER BY SUM(up) + SUM(down) DESC`).all(id, hs);
    const domains = db.prepare(`SELECT dm.name, dm.base, SUM(q.queries) AS queries, SUM(q.blocked) AS blocked FROM dns_1h q JOIN domains dm ON dm.id = q.domain_id
      WHERE q.device_id = ? AND q.ts >= ? GROUP BY dm.id ORDER BY queries DESC LIMIT 100`).all(id, hs) as Array<{ name: string; base: string; queries: number; blocked: number }>;
    const tot = series.reduce((a, p) => ({ down: a.down + p[1], up: a.up + p[2] }), { down: 0, up: 0 });
    return {
      device: devicePublic(d),
      totals: tot,
      series,
      destinations,
      countries,
      domains: domains.map((x) => ({ ...x, category: categoryOf(x.base) })),
      events: recentEvents(20, undefined, id),
    };
  });

  app.patch('/api/devices/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!getDevice(id)) return reply.code(404).send({ error: 'not found' });
    const body = (req.body ?? {}) as { alias?: string | null; kind?: string; notifyOffline?: boolean };
    if (body.alias !== undefined) db.prepare('UPDATE devices SET alias = ? WHERE id = ?').run(body.alias?.trim() || null, id);
    if (body.kind !== undefined) db.prepare('UPDATE devices SET kind = ? WHERE id = ?').run(String(body.kind), id);
    if (body.notifyOffline !== undefined) db.prepare('UPDATE devices SET notify_offline = ? WHERE id = ?').run(body.notifyOffline ? 1 : 0, id);
    clearApiCache();
    return devicePublic(getDevice(id)!);
  });

  app.delete('/api/devices/:id', async (req) => {
    const id = Number((req.params as { id: string }).id);
    db.transaction(() => {
      for (const t of ['traffic_5m', 'flows_1h', 'dns_1h', 'geo_1h', 'base_1h', 'geo_1d', 'base_1d']) db.prepare(`DELETE FROM ${t} WHERE device_id = ?`).run(id);
      db.prepare('DELETE FROM devices WHERE id = ?').run(id);
    })();
    clearApiCache();
    return { ok: true };
  });

  app.get('/api/services', async (req) => {
    const q = req.query as { range?: string; q?: string };
    const { from, secs } = range(q);
    return cached(req.url, q.range, () => {
      let rows = topServices(from, secs, 300);
      if (q.q) rows = rows.filter((r) => r.base.includes(q.q!.toLowerCase()));
      const total = rows.reduce((a, r) => a + r.queries, 0);
      // services that move bytes but are never resolved through AdGuard (hard-coded IPs) are listed by network owner in /api/geo
      return rows.map((r) => ({ ...r, category: categoryOf(r.base), pct: total ? r.queries / total : 0 }));
    });
  });

  app.get('/api/services/:base', async (req) => {
    const base = (req.params as { base: string }).base.toLowerCase();
    const { from } = range(req.query as { range?: string });
    const hs = hourStart(from);
    const byId = new Map(allDevices().map((d) => [d.id, d]));
    const devices = (db.prepare(`SELECT q.device_id AS id, SUM(q.queries) AS queries, SUM(q.blocked) AS blocked FROM dns_1h q JOIN domains d ON d.id = q.domain_id
      WHERE d.base = ? AND q.ts >= ? GROUP BY q.device_id ORDER BY queries DESC`).all(base, hs) as Array<{ id: number; queries: number; blocked: number }>)
      .map((r) => ({ ...r, name: byId.get(r.id) ? displayName(byId.get(r.id)!) : `#${r.id}`, kind: byId.get(r.id)?.kind ?? 'unknown' }));
    const subdomains = db.prepare(`SELECT d.name, SUM(q.queries) AS queries, SUM(q.blocked) AS blocked FROM dns_1h q JOIN domains d ON d.id = q.domain_id
      WHERE d.base = ? AND q.ts >= ? GROUP BY d.id ORDER BY queries DESC LIMIT 50`).all(base, hs);
    const ips = db.prepare(`SELECT f.ip, f.cc, a.org, SUM(f.up) AS up, SUM(f.down) AS down FROM flows_1h f JOIN domains d ON d.id = f.domain_id LEFT JOIN asns a ON a.asn = f.asn
      WHERE d.base = ? AND f.ts >= ? GROUP BY f.ip ORDER BY SUM(up) + SUM(down) DESC LIMIT 50`).all(base, hs);
    return { base, category: categoryOf(base), devices, subdomains, ips };
  });

  app.get('/api/geo', async (req) => cached(req.url, (req.query as { range?: string }).range, () => {
    const q = req.query as { range?: string; device?: string };
    const { from, secs } = range(q);
    const s = getSettings();
    const hs = hourStart(from);
    const ru = rollup(from, secs);
    const dev = q.device ? Number(q.device) : null;
    const devFilter = dev ? `AND f.device_id = ${dev}` : '';
    const countries = db.prepare(`SELECT NULLIF(f.cc, '') AS cc, SUM(f.up) AS up, SUM(f.down) AS down, COUNT(DISTINCT f.device_id) AS devices, SUM(f.conns) AS conns
      FROM ${ru.geo} f WHERE f.ts >= ? ${devFilter} GROUP BY f.cc ORDER BY SUM(up) + SUM(down) DESC`).all(ru.start);
    const asns = db.prepare(`SELECT NULLIF(f.asn, 0) AS asn, a.org, NULLIF(f.cc, '') AS cc, SUM(f.up) AS up, SUM(f.down) AS down, COUNT(DISTINCT f.device_id) AS devices
      FROM ${ru.geo} f LEFT JOIN asns a ON a.asn = f.asn WHERE f.ts >= ? ${devFilter} GROUP BY f.asn, f.cc ORDER BY SUM(up) + SUM(down) DESC LIMIT 40`).all(ru.start);
    const byId = new Map(allDevices().map((d) => [d.id, d]));
    const flagged = (db.prepare(`SELECT f.device_id AS id, f.cc, f.asn, a.org, SUM(f.up) AS up, SUM(f.down) AS down, SUM(f.conns) AS conns,
        COUNT(DISTINCT f.ip) AS ips, GROUP_CONCAT(DISTINCT dm.name) AS domains, MAX(f.ts) AS last
      FROM flows_1h f LEFT JOIN asns a ON a.asn = f.asn LEFT JOIN domains dm ON dm.id = f.domain_id
      WHERE f.ts >= ? ${devFilter} AND ${watchClause(s)} GROUP BY f.device_id, f.cc, f.asn ORDER BY up DESC LIMIT 100`).all(hs) as Array<{ id: number; domains: string | null } & Record<string, unknown>>)
      .map((r) => ({ ...r, name: byId.get(r.id) ? displayName(byId.get(r.id)!) : `#${r.id}`, kind: byId.get(r.id)?.kind ?? 'unknown', domains: r.domains?.split(',').slice(0, 6) ?? [] }));
    const matrix = (db.prepare(`SELECT f.device_id AS id, f.cc, SUM(f.up) AS up, SUM(f.down) AS down FROM ${ru.geo} f WHERE f.ts >= ? ${devFilter} AND f.cc != ''
      GROUP BY f.device_id, f.cc`).all(ru.start) as Array<{ id: number; cc: string; up: number; down: number }>);
    const perDevice = new Map<number, { id: number; name: string; kind: string; total: number; up: number; countries: Array<{ cc: string; up: number; down: number }> }>();
    for (const r of matrix) {
      const d = byId.get(r.id);
      if (!d) continue;
      let e = perDevice.get(r.id);
      if (!e) perDevice.set(r.id, (e = { id: r.id, name: displayName(d), kind: d.kind ?? 'unknown', total: 0, up: 0, countries: [] }));
      e.total += r.up + r.down; e.up += r.up;
      e.countries.push({ cc: r.cc, up: r.up, down: r.down });
    }
    for (const e of perDevice.values()) e.countries.sort((a, b) => b.up + b.down - (a.up + a.down));
    return {
      homeCountry: s.homeCountry,
      watchlist: s.watchlist,
      countries,
      asns,
      flagged,
      devices: [...perDevice.values()].sort((a, b) => b.total - a.total),
      geo: geoStatus(),
    };
  }));

  app.get('/api/monitor', async (req) => {
    const { from, to, secs } = range(req.query as { range?: string });
    const byMac = new Map(allDevices().map((d) => [d.mac, d]));
    const avail = db.prepare('SELECT AVG(online) AS a, AVG(latency) AS lat, AVG(loss) AS loss, COUNT(*) AS n FROM samples WHERE ts >= ?').get(from);
    const s = getSettings();
    return {
      router: state.router ? { model: state.router.model, hostname: state.router.hostname, release: state.router.release, uptime: state.router.uptime, load: state.router.load, memUsed: state.router.memUsed, offload: state.router.offload, acct: state.router.acct } : null,
      routerOk: state.routerOk,
      internet: state.internet,
      wan: state.router?.wan ?? [],
      modem: state.modem,
      wifi: state.wifi.map((r) => ({
        ...r,
        clients: r.clients.map((c) => { const d = byMac.get(c.mac); return { ...c, id: d?.id ?? null, name: d ? displayName(d) : c.mac, kind: d?.kind ?? 'unknown' }; })
          .sort((a, b) => (b.signal ?? -100) - (a.signal ?? -100)),
      })),
      sms: state.sms,
      usage: dataUsage(),
      series: samplesSeries(from, to, secs),
      live: state.live,
      summary: avail,
      watchdog: { ...s.watchdog, state: state.watchdog, reboots: db.prepare("SELECT value FROM kv WHERE key = 'reboots'").pluck().get() ?? '[]' },
      events: (db.prepare(`SELECT * FROM events WHERE type IN ('internet_down','internet_up','wan_up','wan_down','router_boot','action','watchdog') ORDER BY ts DESC LIMIT 20`).all()),
    };
  });

  app.post('/api/actions/:name', async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (!['reboot', 'restart_wan', 'modem_reset', 'power_cycle'].includes(name)) return reply.code(400).send({ error: 'unknown action' });
    try {
      await runAction(getRouter(), name, 'manual');
      return { ok: true };
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/events', async (req) => {
    const q = req.query as { limit?: string; before?: string; type?: string; device?: string };
    const limit = Math.min(200, Number(q.limit ?? 50));
    if (q.type) return db.prepare('SELECT * FROM events WHERE type = ? AND id < ? ORDER BY id DESC LIMIT ?').all(q.type, Number(q.before ?? 1e15), limit);
    return recentEvents(limit, q.before ? Number(q.before) : undefined, q.device ? Number(q.device) : undefined);
  });

  app.get('/api/search', async (req) => {
    const term = String((req.query as { q?: string }).q ?? '').trim().toLowerCase();
    if (term.length < 2) return { devices: [], services: [] };
    const like = `%${term}%`;
    const devices = (db.prepare('SELECT * FROM devices WHERE lower(COALESCE(alias, \'\')) LIKE ? OR lower(COALESCE(hostname, \'\')) LIKE ? OR ip LIKE ? OR mac LIKE ? LIMIT 8').all(like, like, like, like) as DeviceRow[]).map(devicePublic);
    const services = db.prepare(`SELECT d.base, SUM(q.queries) AS queries FROM domains d JOIN dns_1h q ON q.domain_id = d.id WHERE d.name LIKE ? AND q.ts >= ?
      GROUP BY d.base ORDER BY queries DESC LIMIT 8`).all(like, Math.floor(Date.now() / 1000) - 7 * 86400);
    return { devices, services };
  });

  app.get('/api/settings', async () => publicSettings());

  app.put('/api/settings', async (req) => {
    updateSettings((req.body ?? {}) as Partial<Settings>);
    clearApiCache();
    return publicSettings();
  });

  app.post('/api/notify/test', async () => {
    try {
      await sendNotice({ title: 'Notifica di prova', body: 'HomeNet è collegato correttamente.', severity: 'info', ts: Math.floor(Date.now() / 1000) });
      return { ok: true, message: 'Inviata' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post('/api/settings/test', async (req) => {
    const body = (req.body ?? {}) as { target: 'router' | 'adguard'; url?: string; username?: string; password?: string };
    const s = getSettings();
    try {
      if (body.target === 'router') {
        const c = new UbusClient(body.url || s.router.url, body.username || s.router.username, body.password || s.router.password);
        const info = await c.info();
        return { ok: true, message: `${info.board?.model ?? 'Router'} · ${info.board?.release?.description ?? ''}`.trim(), acct: info.acct, offload: info.offload };
      }
      const c = new AdGuardClient(body.url || s.adguard.url, body.username ?? s.adguard.username, body.password || s.adguard.password);
      const st = await c.status();
      return { ok: true, message: `AdGuard Home ${st.version ?? ''}`.trim() };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? (e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message) : String(e) };
    }
  });
}
