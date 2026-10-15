// Destinations of one device, grouped by service (registrable domain, else network owner) or by
// address, plus the drill-down of a single group. All figures come from the hourly flows_1h table,
// so time windows are whole hours.
import { dayBucket, db } from './db.js';
import { displayName, type DeviceRow } from './devices.js';

export type GroupBy = 'service' | 'ip';
export type GroupKind = 'service' | 'network' | 'ip' | 'other';

interface IpRow { ip: string; up: number; down: number; conns: number; cc: string | null; asn: number | null; org: string | null; ports: string | null; domain: string | null; base: string | null }

export interface DestGroup {
  key: string; kind: GroupKind; label: string;
  up: number; down: number; conns: number; ips: number;
  cc: string | null; ccs: number; asn: number | null; org: string | null;
  ports: string[]; base: string | null; ip: string | null; domain: string | null; flagged: boolean;
}

export interface Watch { countries: string[]; asns: Set<number> }

/** ips: the addresses the group was built from, used by the drill-down. */
type Built = DestGroup & { ipList: string[] };

const hourStart = (t: number) => t - (t % 3600);

function ipRows(device: number, from: number, to: number): IpRow[] {
  const rows = db.prepare(`SELECT f.ip, SUM(f.up) AS up, SUM(f.down) AS down, SUM(f.conns) AS conns, f.cc, f.asn, a.org,
      GROUP_CONCAT(DISTINCT f.port) AS ports, MAX(f.domain_id) AS domain_id
    FROM flows_1h f LEFT JOIN asns a ON a.asn = f.asn
    WHERE f.device_id = ? AND f.ts >= ? AND f.ts < ? GROUP BY f.ip`).all(device, hourStart(from), to) as Array<Omit<IpRow, 'domain' | 'base'> & { domain_id: number | null }>;
  const ids = [...new Set(rows.map((r) => r.domain_id).filter((x): x is number => x !== null))];
  const names = new Map(ids.length
    ? (db.prepare(`SELECT id, name, base FROM domains WHERE id IN (${ids.join(',')})`).all() as Array<{ id: number; name: string; base: string }>).map((r) => [r.id, r])
    : []);
  return rows.map(({ domain_id, ...r }) => {
    const d = domain_id !== null ? names.get(domain_id) : undefined;
    return { ...r, domain: d?.name ?? null, base: d?.base ?? null };
  });
}

function keyOf(r: IpRow, by: GroupBy): [string, GroupKind] {
  if (r.ip.startsWith('*')) return [`ip:${r.ip}`, 'other']; // folded "many destinations in this country" row
  if (by === 'ip') return [`ip:${r.ip}`, 'ip'];
  if (r.base) return [`base:${r.base}`, 'service'];
  if (r.asn) return [`asn:${r.asn}`, 'network'];
  return [`ip:${r.ip}`, 'ip'];
}

function build(device: number, from: number, to: number, by: GroupBy, watch: Watch): Built[] {
  const groups = new Map<string, Built & { ccBytes: Map<string, number>; portSet: Map<string, number>; top: number }>();
  for (const r of ipRows(device, from, to)) {
    const [key, kind] = keyOf(r, by);
    let g = groups.get(key);
    if (!g) {
      const label = kind === 'service' ? r.base! : kind === 'network' ? r.org ?? `AS${r.asn}` : kind === 'other' ? 'Altri indirizzi' : r.domain ?? r.ip;
      g = {
        key, kind, label, up: 0, down: 0, conns: 0, ips: 0, cc: null, ccs: 0, asn: r.asn, org: r.org, ports: [], base: kind === 'service' || kind === 'ip' ? r.base : null,
        ip: kind === 'ip' || kind === 'other' ? r.ip : null, domain: kind === 'ip' ? r.domain : null, flagged: false,
        ipList: [], ccBytes: new Map(), portSet: new Map(), top: -1,
      };
      groups.set(key, g);
    }
    const bytes = r.up + r.down;
    g.up += r.up; g.down += r.down; g.conns += r.conns; g.ips++;
    g.ipList.push(r.ip);
    if (bytes > g.top) { g.top = bytes; g.asn = r.asn; g.org = r.org; } // a service is described by its busiest address
    if (r.cc) g.ccBytes.set(r.cc, (g.ccBytes.get(r.cc) ?? 0) + bytes);
    for (const p of (r.ports ?? '').split(',')) if (p) g.portSet.set(p, (g.portSet.get(p) ?? 0) + bytes);
    if ((r.cc && watch.countries.includes(r.cc)) || (r.asn && watch.asns.has(r.asn))) g.flagged = true;
  }
  return [...groups.values()].map(({ ccBytes, portSet, top: _t, ...g }) => {
    const ccs = [...ccBytes.entries()].sort((a, b) => b[1] - a[1]);
    return { ...g, cc: ccs[0]?.[0] ?? (g.kind === 'other' ? g.ip!.slice(1) : null), ccs: ccs.length, ports: [...portSet.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p) };
  }).sort((a, b) => b.up + b.down - (a.up + a.down));
}

export function destinationGroups(device: number, from: number, to: number, by: GroupBy, watch: Watch, limit = 200): DestGroup[] {
  return build(device, from, to, by, watch).slice(0, limit).map(({ ipList: _l, ...g }) => g);
}

/**
 * Drill-down of one group: traffic over the whole range (hourly up to 7 days, daily beyond),
 * ports, addresses, domain names, other devices talking to the same addresses in the window,
 * and when the device first/last talked to them.
 */
export function destinationDetail(device: number, from: number, to: number, [rangeFrom, rangeTo]: [number, number], key: string, by: GroupBy, watch: Watch, byId: Map<number, DeviceRow>) {
  const g = build(device, from, to, by, watch).find((x) => x.key === key);
  if (!g) return null;
  const ips = g.ipList.slice(0, 5000);
  const inList = `ip IN (${ips.map(() => '?').join(',')})`;
  const hs = hourStart(from);

  const daily = rangeTo - rangeFrom > 7 * 86400;
  const hourly = db.prepare(`SELECT ts, SUM(up) AS up, SUM(down) AS down FROM flows_1h WHERE device_id = ? AND ts >= ? AND ts < ? AND ${inList} GROUP BY ts`)
    .all(device, hourStart(rangeFrom), rangeTo, ...ips) as Array<{ ts: number; up: number; down: number }>;
  // hours are walked one by one so that daily buckets follow local days (23/25 h on DST changes)
  const buckets = new Map<number, [number, number, number]>();
  for (let h = hourStart(rangeFrom); h < rangeTo; h += 3600) {
    const k = daily ? dayBucket(h) : h;
    if (!buckets.has(k)) buckets.set(k, [k, 0, 0]);
  }
  for (const r of hourly) {
    const b = buckets.get(daily ? dayBucket(r.ts) : r.ts);
    if (b) { b[1] += r.down; b[2] += r.up; }
  }

  const ports = db.prepare(`SELECT proto, port, SUM(up) AS up, SUM(down) AS down, SUM(conns) AS conns FROM flows_1h
    WHERE device_id = ? AND ts >= ? AND ts < ? AND ${inList} GROUP BY proto, port ORDER BY SUM(up) + SUM(down) DESC LIMIT 12`).all(device, hs, to, ...ips);
  const addresses = g.ipList.length > 1 || g.kind === 'other' ? db.prepare(`SELECT f.ip, f.cc, a.org, SUM(f.up) AS up, SUM(f.down) AS down, SUM(f.conns) AS conns, dm.name AS domain
    FROM flows_1h f LEFT JOIN asns a ON a.asn = f.asn LEFT JOIN domains dm ON dm.id = f.domain_id
    WHERE f.device_id = ? AND f.ts >= ? AND f.ts < ? AND f.${inList} GROUP BY f.ip ORDER BY SUM(f.up) + SUM(f.down) DESC LIMIT 25`).all(device, hs, to, ...ips) : [];
  const domains = db.prepare(`SELECT dm.name, SUM(f.up) AS up, SUM(f.down) AS down FROM flows_1h f JOIN domains dm ON dm.id = f.domain_id
    WHERE f.device_id = ? AND f.ts >= ? AND f.ts < ? AND f.${inList} GROUP BY dm.id ORDER BY SUM(f.up) + SUM(f.down) DESC LIMIT 12`).all(device, hs, to, ...ips);
  const devices = (db.prepare(`SELECT device_id AS id, SUM(up) AS up, SUM(down) AS down FROM flows_1h
    WHERE device_id != ? AND ts >= ? AND ts < ? AND ${inList} GROUP BY device_id ORDER BY SUM(up) + SUM(down) DESC LIMIT 10`).all(device, hs, to, ...ips) as Array<{ id: number; up: number; down: number }>)
    .map((r) => ({ ...r, name: byId.get(r.id) ? displayName(byId.get(r.id)!) : `#${r.id}`, kind: byId.get(r.id)?.kind ?? 'unknown' }));
  const seen = db.prepare(`SELECT MIN(ts) AS first, MAX(ts) AS last FROM flows_1h WHERE device_id = ? AND ${inList}`).get(device, ...ips) as { first: number | null; last: number | null };

  const { ipList: _l, ...group } = g;
  return { group, series: [...buckets.values()], step: daily ? 86400 : 3600, ports, addresses, domains, devices, firstSeen: seen.first, lastSeen: seen.last };
}
