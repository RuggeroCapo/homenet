// Load test: fills a throwaway DB with 15 days of heavy traffic and times every API endpoint.
// Usage: npx tsx scripts/bench.ts [devices=30] [destsPerHour=150]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-bench-'));
const DEVICES = Number(process.argv[2] ?? 30);
const DESTS = Number(process.argv[3] ?? 150);
const { db, dbSizeBytes, prune, backfillRollups } = await import('../src/db.js');
const Fastify = (await import('fastify')).default;
const { registerApi, clearApiCache } = await import('../src/api.js');

const now = Math.floor(Date.now() / 1000);
const DAYS = 15;
const t0 = Date.now();
const CC = ['US', 'IE', 'DE', 'NL', 'IT', 'FR', 'GB', 'CN', 'SG', 'JP'];
db.transaction(() => {
  for (let d = 1; d <= DEVICES; d++) db.prepare('INSERT INTO devices (mac, hostname, kind, ip, first_seen, last_seen, online) VALUES (?, ?, ?, ?, ?, ?, 1)').run(`aa:bb:cc:00:00:${d.toString(16).padStart(2, '0')}`, `device-${d}`, 'unknown', `192.168.1.${d + 10}`, now - DAYS * 86400, now);
  for (let i = 0; i < 4000; i++) db.prepare('INSERT INTO domains (name, base) VALUES (?, ?)').run(`h${i}.svc${i % 400}.com`, `svc${i % 400}.com`);
  for (let a = 1; a <= 300; a++) db.prepare('INSERT INTO asns (asn, org) VALUES (?, ?)').run(a, a % 37 === 0 ? `Alibaba Cloud ${a}` : `Network ${a}`);
})();
const insF = db.prepare('INSERT OR IGNORE INTO flows_1h (ts, device_id, ip, proto, port, up, down, conns, cc, asn, domain_id) VALUES (?, ?, ?, 6, 443, ?, ?, 1, ?, ?, ?)');
const insQ = db.prepare('INSERT OR IGNORE INTO dns_1h (ts, device_id, domain_id, queries, blocked) VALUES (?, ?, ?, ?, ?)');
const insT = db.prepare('INSERT OR IGNORE INTO traffic_5m (ts, device_id, up, down) VALUES (?, ?, ?, ?)');
const insS = db.prepare('INSERT OR IGNORE INTO samples (ts, online, latency, loss, rx_bps, tx_bps, router_ok, signal) VALUES (?, 1, 20, 0, 1e7, 1e6, 1, ?)');
for (let h = DAYS * 24; h > 0; h--) {
  const hour = now - (now % 3600) - h * 3600;
  db.transaction(() => {
    for (let d = 1; d <= DEVICES; d++) {
      for (let k = 0; k < DESTS; k++) {
        const ip = `${(d * 7 + k) % 223 + 1}.${k % 250}.${(h + k) % 250}.${d}`;
        const asn = (k % 25) + 1 + (d % 4) * 25; // destinations cluster into a few networks, like real traffic
        insF.run(hour, d, ip, k * 1000, k * 9000, CC[asn % CC.length], asn, (d * 31 + k) % 4000 + 1);
      }
      for (let k = 0; k < 60; k++) insQ.run(hour, d, (d * 13 + k * 7) % 4000 + 1, k % 9 + 1, k % 5 === 0 ? 1 : 0);
      for (let m = 0; m < 12; m++) insT.run(hour + m * 300, d, 1e6, 9e6);
    }
    for (let m = 0; m < 60; m++) insS.run(hour + m * 60, JSON.stringify({ q: 70, rsrp: -95, sinr: 13, rsrq: -10, rssi: -67, tech: 'LTE' }));
  })();
}
const rb = performance.now();
backfillRollups();
console.log(`rollup back-fill ${((performance.now() - rb) / 1000).toFixed(1)} s`);
const rows = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
console.log(`filled in ${((Date.now() - t0) / 1000).toFixed(1)} s: flows_1h=${rows('flows_1h')} dns_1h=${rows('dns_1h')} geo_1h=${rows('geo_1h')} base_1h=${rows('base_1h')} traffic_5m=${rows('traffic_5m')} samples=${rows('samples')}  db=${(dbSizeBytes() / 1e6).toFixed(0)} MB`);

const app = Fastify();
registerApi(app, () => null);
await app.ready();
const urls = ['/api/overview', '/api/devices', '/api/devices/5', '/api/services', '/api/services/svc7.com', '/api/geo', '/api/geo?device=5', '/api/monitor', '/api/search?q=svc1', '/api/events'];
for (const range of ['24h', '15d']) {
  for (const u of urls) {
    const url = u + (u.includes('?') ? '&' : '?') + `range=${range}`;
    await app.inject({ url }); // warm
    clearApiCache();
    const s = performance.now();
    const res = await app.inject({ url });
    const ms = performance.now() - s;
    console.log(`${range.padEnd(4)} ${String(res.statusCode)} ${ms.toFixed(0).padStart(6)} ms ${(res.body.length / 1024).toFixed(0).padStart(5)} KB  ${u}`);
  }
}
const ps = performance.now();
prune(DAYS - 2);
console.log(`prune(2 days) ${(performance.now() - ps).toFixed(0)} ms, db now ${(dbSizeBytes() / 1e6).toFixed(0)} MB, rss ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
