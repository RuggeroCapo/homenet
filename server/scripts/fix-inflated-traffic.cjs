// One-off repair for traffic inflated by the conntrack recount bug fixed in 0.3.1.
// For every hour where the devices add up to more than the WAN counter measured (+10%),
// scales that hour's per-device bytes down to the WAN total and fixes the daily rollups.
// Dry run by default; APPLY=1 writes, after saving a copy of the database next to it.
//   docker exec -i -u 1000:1000 -w /app <container> node - < fix-inflated-traffic.cjs
const Database = require('better-sqlite3');

const file = process.env.DB ?? '/data/homenet.db';
const apply = process.env.APPLY === '1';
const db = new Database(file);
db.pragma('busy_timeout = 15000');

const dayBucket = (ts) => { const off = -new Date(ts * 1000).getTimezoneOffset() * 60; return Math.floor((ts + off) / 86400) * 86400 - off; };
const localDay = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const gb = (b) => (b / 1e9).toFixed(2);

const wanQ = db.prepare('SELECT COUNT(*) AS n, AVG(rx_bps) AS rx, AVG(tx_bps) AS tx FROM samples WHERE ts >= ? AND ts < ? AND rx_bps IS NOT NULL');
const fixes = [];
for (const r of db.prepare('SELECT ts - ts % 3600 AS h, SUM(up) AS up, SUM(down) AS down FROM traffic_5m GROUP BY h ORDER BY h').all()) {
  const w = wanQ.get(r.h, r.h + 3600);
  if (w.n < 30) continue; // too few WAN samples to judge this hour
  const wd = (w.rx * 3600) / 8, wu = (w.tx * 3600) / 8;
  const fd = r.down > wd * 1.1 ? wd / r.down : 1;
  const fu = r.up > wu * 1.1 ? wu / r.up : 1;
  if (fd < 1 || fu < 1) fixes.push({ ...r, wd, wu, fd, fu });
}

if (!fixes.length) { console.log('Nessuna ora gonfiata.'); process.exit(0); }
for (const f of fixes) {
  console.log(`${new Date(f.h * 1000).toLocaleString('it-IT')}  down ${gb(f.down)} → ${gb(f.down * f.fd)} GB (WAN ${gb(f.wd)})  up ${gb(f.up)} → ${gb(f.up * f.fu)} GB (WAN ${gb(f.wu)})`);
}
if (!apply) { console.log('\nProva a secco: nulla è stato modificato. Rilancia con APPLY=1 per correggere.'); process.exit(0); }

const backup = file.replace(/\.db$/, '') + `.pre-0.3.1-fix.db`;
db.exec(`VACUUM INTO '${backup}'`);
console.log(`\nCopia di sicurezza: ${backup}`);

const scale = (table, keyCols, h, fu, fd, rollup) => {
  const where = keyCols.map((c) => `${c} = ?`).join(' AND ');
  const set = db.prepare(`UPDATE ${table} SET up = ?, down = ? WHERE ${where}`);
  const sub = rollup && db.prepare(`UPDATE ${rollup.table} SET up = MAX(0, up - ?), down = MAX(0, down - ?) WHERE ${rollup.keyCols.map((c) => `${c} = ?`).join(' AND ')}`);
  // traffic_5m holds 5-minute buckets inside the hour, the other tables one row per hour
  const [range, args] = table === 'traffic_5m' ? ['ts >= ? AND ts < ?', [h, h + 3600]] : ['ts = ?', [h]];
  for (const row of db.prepare(`SELECT ${keyCols.join(', ')}, up, down FROM ${table} WHERE ${range}`).all(...args)) {
    const up = Math.round(row.up * fu), down = Math.round(row.down * fd);
    set.run(up, down, ...keyCols.map((c) => row[c]));
    if (sub) sub.run(row.up - up, row.down - down, ...rollup.key(row));
  }
};

db.transaction(() => {
  for (const { h, fu, fd } of fixes) {
    scale('traffic_5m', ['ts', 'device_id'], h, fu, fd, { table: 'device_daily', keyCols: ['day', 'device_id'], key: (r) => [localDay(r.ts), r.device_id] });
    scale('flows_1h', ['ts', 'device_id', 'ip', 'proto', 'port'], h, fu, fd);
    scale('geo_1h', ['ts', 'device_id', 'cc', 'asn'], h, fu, fd, { table: 'geo_1d', keyCols: ['ts', 'device_id', 'cc', 'asn'], key: (r) => [dayBucket(r.ts), r.device_id, r.cc, r.asn] });
    scale('base_1h', ['ts', 'device_id', 'base_id'], h, fu, fd, { table: 'base_1d', keyCols: ['ts', 'device_id', 'base_id'], key: (r) => [dayBucket(r.ts), r.device_id, r.base_id] });
  }
})();
console.log(`Corrette ${fixes.length} ore.`);
