// Turns conntrack byte deltas into hourly per-device/per-destination rows and 5-minute device counters.
import { db, kvSet } from '../db.js';
import { deviceForIp, displayName, getDevice, isLan, markActive } from '../devices.js';
import { addEventOnce, countryName, fmtBytes } from '../events.js';
import { lookup } from '../geo.js';
import type { FlowRow } from '../router.js';
import { getSettings } from '../settings.js';

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

export function ingestFlows(rows: FlowRow[], at = Math.floor(Date.now() / 1000)) {
  const hour = at - (at % 3600);
  const five = at - (at % 300);
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
    const key = `${hour}|${dev}|${remote}|${p}|${dport}`;
    let f = flows.get(key);
    if (!f) {
      const g = lookup(remote);
      f = { ts: hour, dev, ip: remote, proto: p, port: dport, up: 0, down: 0, conns: 0, cc: g.cc, asn: g.asn, domain: ipDomain.get(remote) ?? null };
      flows.set(key, f);
    }
    f.up += up; f.down += down; f.conns += isNew ? 1 : 0;
    if (f.domain === null) f.domain = ipDomain.get(remote) ?? null;
    const tk = `${five}|${dev}`;
    let t = traffic.get(tk);
    if (!t) traffic.set(tk, (t = { ts: five, dev, up: 0, down: 0 }));
    t.up += up; t.down += down;
  }
}

const upFlow = db.prepare(`INSERT INTO flows_1h (ts, device_id, ip, proto, port, up, down, conns, cc, asn, domain_id)
  VALUES (@ts, @dev, @ip, @proto, @port, @up, @down, @conns, @cc, @asn, @domain)
  ON CONFLICT(ts, device_id, ip, proto, port) DO UPDATE SET up = up + excluded.up, down = down + excluded.down,
  conns = conns + excluded.conns, domain_id = COALESCE(excluded.domain_id, domain_id)`);
const upTraffic = db.prepare(`INSERT INTO traffic_5m (ts, device_id, up, down) VALUES (@ts, @dev, @up, @down)
  ON CONFLICT(ts, device_id) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`);
const upIpDomain = db.prepare('INSERT INTO ip_domain (ip, domain_id, ts) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET domain_id = excluded.domain_id, ts = excluded.ts');

/** Daily per-device totals towards watch-listed countries / networks, used for alerts. */
const watchTotals = new Map<string, number>();

function checkWatchlist(f: FlowAgg) {
  const s = getSettings().watchlist;
  const org = f.asn ? (db.prepare('SELECT org FROM asns WHERE asn = ?').get(f.asn) as { org: string } | undefined)?.org ?? '' : '';
  const ccHit = f.cc && s.countries.includes(f.cc);
  const orgHit = !ccHit && org && s.asnKeywords.some((k) => org.toLowerCase().includes(k));
  if (!ccHit && !orgHit) return;
  const day = new Date(f.ts * 1000).toISOString().slice(0, 10);
  const target = ccHit ? f.cc! : `AS${f.asn}`;
  const key = `watch:${day}:${f.dev}:${target}`;
  const total = (watchTotals.get(key) ?? 0) + f.up + f.down;
  watchTotals.set(key, total);
  if (total < s.minBytes) return;
  const d = getDevice(f.dev);
  const name = d ? displayName(d) : `#${f.dev}`;
  const where = ccHit ? `${countryName(f.cc)} (${f.cc})` : org;
  addEventOnce(key, 'geo_alert', 'warning', `Traffico verso ${where}`, `${name} · ${fmtBytes(total)} oggi${org && ccHit ? ` · ${org}` : ''}`, f.dev);
}

export function flushFlows() {
  if (!flows.size && !traffic.size && !dirtyIpDomain.size) return;
  const batch = [...flows.values()];
  const tBatch = [...traffic.values()];
  const now = Math.floor(Date.now() / 1000);
  flows.clear();
  traffic.clear();
  db.transaction(() => {
    for (const f of batch) upFlow.run(f);
    for (const t of tBatch) upTraffic.run(t);
    for (const [ip, id] of dirtyIpDomain) upIpDomain.run(ip, id, now);
  })();
  dirtyIpDomain.clear();
  for (const f of batch) if (f.up + f.down > 0) checkWatchlist(f);
  if (watchTotals.size > 5000) watchTotals.clear();
  kvSet('last_flow_flush', now);
}
