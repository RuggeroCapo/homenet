// Turns conntrack byte deltas into hourly per-device/per-destination rows and 5-minute device counters.
import { db, kvGet, kvSet } from '../db.js';
import { deviceForIp, displayName, getDevice, isLan, markActive, resolveDevice } from '../devices.js';
import { addEventOnce, countryName, fmtBytes } from '../events.js';
import { lookup } from '../geo.js';
import type { FlowRow } from '../router.js';
import { getSettings } from '../settings.js';
import { state } from '../state.js';

const PROTO: Record<string, number> = { tcp: 6, udp: 17, icmp: 1, icmpv6: 58, sctp: 132, gre: 47 };

interface FlowAgg { ts: number; dev: number; ip: string; proto: number; port: number; up: number; down: number; conns: number; cc: string | null; asn: number | null; domain: number | null }

const flows = new Map<string, FlowAgg>();
const traffic = new Map<string, { ts: number; dev: number; up: number; down: number }>();
/** ip → domain id, fed by the DNS collector */
export const ipDomain = new Map<string, number>();
const dirtyIpDomain = new Map<string, number>();

for (const r of db.prepare('SELECT ip, domain_id FROM ip_domain ORDER BY ts').all() as Array<{ ip: string; domain_id: number }>) {
  ipDomain.set(r.ip, r.domain_id);
}

export function rememberIpDomain(ip: string, domainId: number) {
  if (ipDomain.get(ip) === domainId) return;
  ipDomain.set(ip, domainId);
  dirtyIpDomain.set(ip, domainId);
}

/** Re-reads the ip → domain map after a prune (domain ids may have been deleted). */
export function reloadIpDomain() {
  ipDomain.clear();
  for (const r of db.prepare('SELECT ip, domain_id FROM ip_domain ORDER BY ts').all() as Array<{ ip: string; domain_id: number }>) {
    ipDomain.set(r.ip, r.domain_id);
  }
}

/**
 * A P2P/torrent client can talk to thousands of peers per hour. To keep the database bounded,
 * after MAX_DEST_PER_HOUR distinct destinations a device's extra traffic is folded into one
 * row per country (ip = "*CC"), which keeps per-country and per-device totals exact.
 */
export const MAX_DEST_PER_HOUR = 400;
const destSeen = new Map<string, Set<string>>();
let destHour = 0;

export function ingestFlows(rows: FlowRow[], at = Math.floor(Date.now() / 1000), windowSecs = 0) {
  const window = new Map<number, { up: number; down: number }>();
  const hour = at - (at % 3600);
  const five = at - (at % 300);
  if (hour !== destHour) { destSeen.clear(); destHour = hour; }
  for (const [proto, src, , dst, dport, dOrig, rsrc, dReply, isNew] of rows) {
    let lanIp: string, remote: string, up: number, down: number;
    if (isLan(src) && !isLan(dst)) {
      lanIp = src; remote = dst; up = dOrig; down = dReply;
    } else if (!isLan(src) && rsrc && isLan(rsrc)) {
      // inbound (port forward): reply source is the LAN host
      lanIp = rsrc; remote = src; up = dReply; down = dOrig;
    } else continue;
    const dev = deviceForIp(lanIp);
    markActive(dev, at);
    const p = PROTO[proto] ?? 0;
    let ip = remote, port = dport;
    const destKey = `${remote}|${p}|${dport}`;
    let seen = destSeen.get(`${dev}`);
    if (!seen) destSeen.set(`${dev}`, (seen = new Set()));
    let g: ReturnType<typeof lookup> | null = null;
    if (!seen.has(destKey)) {
      if (seen.size >= MAX_DEST_PER_HOUR) {
        g = lookup(remote);
        ip = `*${g.cc ?? '??'}`; port = 0;
      } else seen.add(destKey);
    }
    const key = `${hour}|${dev}|${ip}|${p}|${port}`;
    let f = flows.get(key);
    if (!f) {
      g ??= lookup(remote);
      const folded = ip !== remote;
      f = { ts: hour, dev, ip, proto: p, port, up: 0, down: 0, conns: 0, cc: g.cc, asn: folded ? null : g.asn, domain: folded ? null : ipDomain.get(remote) ?? null };
      flows.set(key, f);
    }
    f.up += up; f.down += down; f.conns += isNew ? 1 : 0;
    if (f.domain === null && ip === remote) f.domain = ipDomain.get(remote) ?? null;
    const w = window.get(dev) ?? { up: 0, down: 0 };
    w.up += up; w.down += down;
    window.set(dev, w);
    const tk = `${five}|${dev}`;
    let t = traffic.get(tk);
    if (!t) traffic.set(tk, (t = { ts: five, dev, up: 0, down: 0 }));
    t.up += up; t.down += down;
  }
  if (windowSecs > 0) {
    state.deviceRates.clear();
    for (const [dev, w] of window) state.deviceRates.set(dev, { up: (w.up * 8) / windowSecs, down: (w.down * 8) / windowSecs, ts: at });
  }
}

const upFlow = db.prepare(`INSERT INTO flows_1h (ts, device_id, ip, proto, port, up, down, conns, cc, asn, domain_id)
  VALUES (@ts, @dev, @ip, @proto, @port, @up, @down, @conns, @cc, @asn, @domain)
  ON CONFLICT(ts, device_id, ip, proto, port) DO UPDATE SET up = up + excluded.up, down = down + excluded.down,
  conns = conns + excluded.conns, domain_id = COALESCE(excluded.domain_id, domain_id)`);
const upTraffic = db.prepare(`INSERT INTO traffic_5m (ts, device_id, up, down) VALUES (@ts, @dev, @up, @down)
  ON CONFLICT(ts, device_id) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`);
const upIpDomain = db.prepare('INSERT INTO ip_domain (ip, domain_id, ts) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET domain_id = excluded.domain_id, ts = excluded.ts');

function dayStart(ts: number) {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function checkWatchlist(f: FlowAgg) {
  const s = getSettings().watchlist;
  const org = f.asn ? (db.prepare('SELECT org FROM asns WHERE asn = ?').get(f.asn) as { org: string } | undefined)?.org ?? '' : '';
  const ccHit = f.cc && s.countries.includes(f.cc);
  const orgHit = !ccHit && org && s.asnKeywords.some((k) => org.toLowerCase().includes(k));
  if (!ccHit && !orgHit) return;
  const day = new Date(f.ts * 1000).toISOString().slice(0, 10);
  const target = ccHit ? f.cc! : `AS${f.asn}`;
  const key = `watch:${day}:${f.dev}:${target}`;
  if (kvGet<number | null>(`seen:${key}`, null) !== null) return;
  const total = (ccHit
    ? db.prepare('SELECT SUM(up + down) AS t FROM flows_1h WHERE device_id = ? AND ts >= ? AND cc = ?').get(f.dev, dayStart(f.ts), f.cc)
    : db.prepare('SELECT SUM(up + down) AS t FROM flows_1h WHERE device_id = ? AND ts >= ? AND asn = ?').get(f.dev, dayStart(f.ts), f.asn)) as { t: number | null };
  if ((total.t ?? 0) < s.minBytes) return;
  const d = getDevice(f.dev);
  const name = d ? displayName(d) : `#${f.dev}`;
  const where = ccHit ? `${countryName(f.cc)} (${f.cc})` : org;
  addEventOnce(key, 'geo_alert', 'warning', `Traffico verso ${where}`, `${name} · ${fmtBytes(total.t ?? 0)} oggi${org && ccHit ? ` · ${org}` : ''}`, f.dev);
}

export function flushFlows() {
  if (!flows.size && !traffic.size && !dirtyIpDomain.size) return;
  const batch = [...flows.values()];
  const tBatch = [...traffic.values()];
  const now = Math.floor(Date.now() / 1000);
  flows.clear();
  traffic.clear();
  for (const f of batch) f.dev = resolveDevice(f.dev);
  for (const t of tBatch) t.dev = resolveDevice(t.dev);
  db.transaction(() => {
    for (const f of batch) upFlow.run(f);
    for (const t of tBatch) upTraffic.run(t);
    for (const [ip, id] of dirtyIpDomain) upIpDomain.run(ip, id, now);
  })();
  dirtyIpDomain.clear();
  for (const f of batch) if (f.up + f.down > 0) checkWatchlist(f);
  kvSet('last_flow_flush', now);
}
