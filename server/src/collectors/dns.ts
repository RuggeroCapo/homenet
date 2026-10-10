// Pulls new AdGuard query-log entries and aggregates them per device/domain/hour.
import { getDomain } from 'tldts';
import { isBlocked, type AdGuardApi, type QueryLogEntry } from '../adguard.js';
import { db, domainId, kvGet, kvSet } from '../db.js';
import { deviceForIp, markActive } from '../devices.js';
import { collectorError, collectorOk } from '../state.js';
import { rememberIpDomain } from './flows.js';

const IGNORE = /(\.arpa|\.local|\.lan|\.home|\.internal|\.localdomain)$/;

const buckets = new Map<string, { ts: number; dev: number; dom: number; q: number; b: number }>();
const upsert = db.prepare(`INSERT INTO dns_1h (ts, device_id, domain_id, queries, blocked) VALUES (@ts, @dev, @dom, @q, @b)
  ON CONFLICT(ts, device_id, domain_id) DO UPDATE SET queries = queries + excluded.queries, blocked = blocked + excluded.blocked`);

export function baseDomain(name: string) {
  return getDomain(name, { allowPrivateDomains: false }) ?? name;
}

export function ingestQuery(e: QueryLogEntry) {
  const t = Math.floor(Date.parse(e.time) / 1000);
  const name = (e.question?.name ?? '').replace(/\.$/, '').toLowerCase();
  if (!name || !name.includes('.') || IGNORE.test(name)) return;
  const dom = domainId(name, baseDomain(name));
  const dev = deviceForIp(e.client, e.client_info?.name || null);
  markActive(dev, t);
  const hour = t - (t % 3600);
  const key = `${hour}|${dev}|${dom}`;
  let b = buckets.get(key);
  if (!b) buckets.set(key, (b = { ts: hour, dev, dom, q: 0, b: 0 }));
  b.q++;
  if (isBlocked(e.reason)) b.b++;
  for (const a of e.answer ?? []) {
    if (a.type === 'A' || a.type === 'AAAA') rememberIpDomain(a.value, dom);
  }
}

export function flushDns() {
  if (!buckets.size) return;
  const rows = [...buckets.values()];
  buckets.clear();
  db.transaction(() => { for (const r of rows) upsert.run(r); })();
}

export class DnsCollector {
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private api: AdGuardApi, private intervalMs = 30_000) {}

  start() {
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    void this.poll();
  }

  stop() {
    clearInterval(this.timer);
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      // first run: only look back one hour to keep start-up cheap
      const cursor = kvGet<number>('adguard_cursor', Date.now() - 3600_000);
      const fresh: QueryLogEntry[] = [];
      let older: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await this.api.querylog(older, 500);
        const data = res.data ?? [];
        let reached = false;
        for (const e of data) {
          if (Date.parse(e.time) <= cursor) { reached = true; break; }
          fresh.push(e);
        }
        if (reached || data.length < 500 || !res.oldest) break;
        older = res.oldest;
      }
      let max = cursor;
      for (let i = fresh.length - 1; i >= 0; i--) {
        ingestQuery(fresh[i]);
        max = Math.max(max, Date.parse(fresh[i].time));
      }
      flushDns();
      kvSet('adguard_cursor', max);
      collectorOk('adguard');
    } catch (e) {
      collectorError('adguard', e);
    } finally {
      this.busy = false;
    }
  }
}
