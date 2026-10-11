import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-col-'));
const { db, prune } = await import('./db.js');
const { setLanSubnets, upsertHost, deviceForIp } = await import('./devices.js');
const { ingestFlows, flushFlows, MAX_DEST_PER_HOUR } = await import('./collectors/flows.js');
const { ingestQuery, flushDns } = await import('./collectors/dns.js');
const { registerDemoGeo } = await import('./geo.js');
const { updateSettings, getSettings } = await import('./settings.js');
const { state } = await import('./state.js');
const { Watchdog } = await import('./collectors/watchdog.js');

setLanSubnets([['192.168.1.1', 24]], [['2a01:db8:1::', 64]]);
registerDemoGeo('47.92.18.10', { cc: 'CN', asn: 37963, org: 'Hangzhou Alibaba Advertising Co.,Ltd.' });
registerDemoGeo('142.250.180.14', { cc: 'US', asn: 15169, org: 'Google LLC' });

const sum = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as Record<string, number | null>);

test('classifies outbound, inbound (port forward) and IPv6 flows', () => {
  const cam = upsertHost('7c:a7:b0:66:00:55', '192.168.1.55', 'IPC-365-Camera');
  upsertHost('7c:a7:b0:66:00:55', '2a01:db8:1::55', null);
  const now = Math.floor(Date.now() / 1000);
  ingestFlows([
    ['udp', '192.168.1.55', 5000, '47.92.18.10', 10051, 30_000, '47.92.18.10', 1_000, 1], // outbound: up 30k
    ['tcp', '47.92.18.10', 40000, '93.40.1.2', 8443, 2_000, '192.168.1.55', 50_000, 1], // inbound via DNAT: up 50k
    ['tcp', '2a01:db8:1::55', 40001, '2a00:1450::e', 443, 100, '2a00:1450::e', 900, 0], // IPv6 global LAN address
    ['tcp', '10.0.0.5', 1, '8.8.8.8', 53, 999, '8.8.8.8', 999, 0], // router's own WAN-side traffic: ignored
  ], now);
  flushFlows();
  const t = sum('SELECT SUM(up) AS up, SUM(down) AS down FROM traffic_5m WHERE device_id = ?', cam);
  assert.equal(t.up, 30_000 + 50_000 + 100);
  assert.equal(t.down, 1_000 + 2_000 + 900);
  const cn = sum("SELECT SUM(up) AS up FROM geo_1h WHERE device_id = ? AND cc = 'CN'", cam);
  assert.equal(cn.up, 80_000);
  assert.equal(sum('SELECT COUNT(*) AS n FROM devices').n, 1);
});

test('folds destinations beyond the hourly cap into one row per country', () => {
  const dev = upsertHost('aa:aa:aa:aa:aa:01', '192.168.1.80', 'torrent-box');
  const rows: Array<[string, string, number, string, number, number, string, number, number]> = [];
  for (let i = 0; i < MAX_DEST_PER_HOUR + 50; i++) rows.push(['udp', '192.168.1.80', 6881, `81.2.${i >> 8}.${i & 255}`, 6881, 10, `81.2.${i >> 8}.${i & 255}`, 20, 1]);
  ingestFlows(rows);
  flushFlows();
  const n = sum('SELECT COUNT(*) AS n FROM flows_1h WHERE device_id = ?', dev).n;
  assert.equal(n, MAX_DEST_PER_HOUR + 1);
  const t = sum('SELECT SUM(up) AS up FROM flows_1h WHERE device_id = ?', dev);
  assert.equal(t.up, (MAX_DEST_PER_HOUR + 50) * 10, 'totals stay exact');
});

test('DNS answers label later flows; unknown clients become placeholders that merge into the real device', () => {
  const now = new Date().toISOString();
  ingestQuery({ time: now, client: '192.168.1.42', question: { name: 'www.google.com.', type: 'A' }, answer: [{ type: 'A', value: '142.250.180.14' }], reason: 'NotFilteredNotFound', client_info: { name: 'PS5' } });
  ingestQuery({ time: now, client: '192.168.1.42', question: { name: 'ads.doubleclick.net', type: 'A' }, answer: [], reason: 'FilteredBlackList' });
  ingestQuery({ time: now, client: '192.168.1.42', question: { name: '1.1.168.192.in-addr.arpa', type: 'PTR' }, reason: 'NotFilteredNotFound' });
  flushDns();
  const pseudo = deviceForIp('192.168.1.42');
  assert.equal((db.prepare('SELECT mac FROM devices WHERE id = ?').get(pseudo) as { mac: string }).mac, 'ip:192.168.1.42');
  ingestFlows([['tcp', '192.168.1.42', 5555, '142.250.180.14', 443, 500, '142.250.180.14', 5000, 1]]);
  // router reports the (new) MAC later: the placeholder is promoted in place
  const real = upsertHost('00:e4:21:33:00:42', '192.168.1.42', 'PS5-2F9A');
  flushFlows();
  assert.equal(real, pseudo);
  assert.equal((db.prepare('SELECT mac FROM devices WHERE id = ?').get(real) as { mac: string }).mac, '00:e4:21:33:00:42');
  const q = sum('SELECT SUM(queries) AS q, SUM(blocked) AS b FROM dns_1h WHERE device_id = ?', real);
  assert.deepEqual([q.q, q.b], [2, 1], 'arpa lookups ignored, blocked counted');
  const f = db.prepare('SELECT d.name, f.up FROM flows_1h f JOIN domains d ON d.id = f.domain_id WHERE f.device_id = ?').get(real) as { name: string; up: number };
  assert.deepEqual(f, { name: 'www.google.com', up: 500 });
  const base = db.prepare('SELECT SUM(b.queries) AS q, SUM(b.up) AS up FROM base_1h b JOIN domains d ON d.id = b.base_id WHERE b.device_id = ? AND d.name = ?').get(real, 'google.com') as { q: number; up: number };
  assert.deepEqual(base, { q: 1, up: 500 });
});

test('a known device seen first on a new IP is merged back with its history', () => {
  ingestQuery({ time: new Date().toISOString(), client: '192.168.1.99', question: { name: 'github.com', type: 'A' }, reason: 'NotFilteredNotFound' });
  ingestFlows([['tcp', '192.168.1.99', 5555, '142.250.180.14', 443, 700, '142.250.180.14', 0, 1]]);
  const pseudo = deviceForIp('192.168.1.99');
  const cam = upsertHost('7c:a7:b0:66:00:55', '192.168.1.99', null); // DHCP gave the camera a new address
  flushDns();
  flushFlows();
  assert.notEqual(cam, pseudo);
  assert.equal(sum('SELECT COUNT(*) AS n FROM devices WHERE id = ?', pseudo).n, 0);
  assert.equal(sum('SELECT COUNT(*) AS n FROM flows_1h WHERE device_id = ?', pseudo).n, 0, 'in-memory buckets remapped');
  assert.equal(sum('SELECT SUM(queries) AS q FROM dns_1h WHERE device_id = ?', cam).q, 1);
  assert.equal(deviceForIp('192.168.1.99'), cam);
});

test('watchlist alert fires once per device/day with DB totals', () => {
  const alerts = () => sum("SELECT COUNT(*) AS n FROM events WHERE type = 'geo_alert'").n;
  assert.equal(alerts(), 0, 'below the 100 KB default threshold so far');
  ingestFlows([['udp', '192.168.1.55', 5000, '47.92.18.10', 10051, 60_000, '47.92.18.10', 0, 0]]);
  flushFlows();
  assert.equal(alerts(), 1);
  ingestFlows([['udp', '192.168.1.55', 5000, '47.92.18.10', 10051, 60_000, '47.92.18.10', 0, 0]]);
  flushFlows();
  assert.equal(alerts(), 1);
});

test('watchdog escalates restart_wan → reboot, honours the reboot cap and resets when back online', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const calls: string[] = [];
  const router = { action: async (name: string) => { calls.push(name); } } as never;
  updateSettings({ watchdog: { ...getSettings().watchdog, enabled: true, downMinutes: 5, escalateMinutes: 5, maxRebootsPer6h: 1, firstAction: 'restart_wan' } });
  state.routerOk = true;
  const wd = new Watchdog(() => router);
  const minute = async (n: number) => { for (let i = 0; i < n; i++) { t.mock.timers.tick(60_000); await wd.tick(false); } };
  await wd.tick(false);
  await minute(4);
  assert.deepEqual(calls, []);
  await minute(1);
  assert.deepEqual(calls, ['restart_wan']);
  await minute(5);
  assert.deepEqual(calls, ['restart_wan', 'reboot']);
  await minute(30); // still down: new cycle, but the reboot cap (1 per 6 h) stops a second reboot
  assert.deepEqual(calls, ['restart_wan', 'reboot', 'restart_wan']);
  assert.ok(sum("SELECT COUNT(*) AS n FROM events WHERE title = 'Watchdog in pausa'").n >= 1);
  await wd.tick(true);
  assert.equal(state.watchdog.step, 0);
});

test('prune drops old rows and unreferenced domains', () => {
  const old = Math.floor(Date.now() / 1000) - 40 * 86400;
  db.prepare("INSERT INTO domains (name, base) VALUES ('stale.example.com', 'example.com')").run();
  db.prepare('INSERT INTO traffic_5m (ts, device_id, up, down) VALUES (?, 1, 1, 1)').run(old);
  db.prepare('INSERT INTO geo_1d (ts, device_id, cc, asn, up, down, conns) VALUES (?, 1, \'US\', 1, 1, 1, 1)').run(old);
  prune(15);
  assert.equal(sum('SELECT COUNT(*) AS n FROM traffic_5m WHERE ts = ?', old).n, 0);
  assert.equal(sum('SELECT COUNT(*) AS n FROM geo_1d WHERE ts <= ?', old).n, 0);
  assert.equal(sum("SELECT COUNT(*) AS n FROM domains WHERE name = 'stale.example.com'").n, 0);
  assert.equal(sum("SELECT COUNT(*) AS n FROM domains WHERE name = 'www.google.com'").n, 1);
});
