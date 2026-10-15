import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-dest-'));
const { db } = await import('./db.js');
const { setLanSubnets, upsertHost } = await import('./devices.js');
const { ingestFlows, flushFlows } = await import('./collectors/flows.js');
const { ingestQuery, flushDns } = await import('./collectors/dns.js');
const { registerDemoGeo } = await import('./geo.js');
const { destinationGroups, destinationDetail } = await import('./destinations.js');

setLanSubnets([['192.168.1.1', 24]], []);
registerDemoGeo('54.230.183.37', { cc: 'US', asn: 16509, org: 'Amazon.com, Inc.' });
registerDemoGeo('54.230.183.38', { cc: 'US', asn: 16509, org: 'Amazon.com, Inc.' });
registerDemoGeo('52.1.1.1', { cc: 'IE', asn: 16509, org: 'Amazon.com, Inc.' });
registerDemoGeo('47.92.18.10', { cc: 'CN', asn: 37963, org: 'Alibaba' });

const watch = { countries: ['CN'], asns: new Set<number>() };
const H = 3600;
const now = Math.floor(Date.now() / 1000);
const hour = now - (now % H);

const umbrel = upsertHost('aa:bb:cc:00:00:10', '192.168.1.10', 'umbrel');
const laptop = upsertHost('aa:bb:cc:00:00:20', '192.168.1.20', 'laptop');
const t = new Date((hour - 2 * H + 60) * 1000).toISOString();
for (const ip of ['54.230.183.37', '54.230.183.38']) {
  ingestQuery({ time: t, client: '192.168.1.10', question: { name: 'production.cloudfront.docker.com', type: 'A' }, answer: [{ type: 'A', value: ip }], reason: 'NotFilteredNotFound' });
}
flushDns();
// two hours ago: a Docker pull over two CDN addresses; one hour ago: an unlabelled Amazon address and a CN upload
ingestFlows([
  ['tcp', '192.168.1.10', 40000, '54.230.183.37', 443, 1_000, '54.230.183.37', 3_000_000, 1],
  ['tcp', '192.168.1.10', 40001, '54.230.183.38', 443, 1_000, '54.230.183.38', 2_000_000, 1],
  ['tcp', '192.168.1.20', 40002, '54.230.183.38', 443, 500, '54.230.183.38', 7_000, 1],
], hour - 2 * H + 120);
ingestFlows([
  ['tcp', '192.168.1.10', 40003, '52.1.1.1', 443, 2_000, '52.1.1.1', 400_000, 1],
  ['udp', '192.168.1.10', 40004, '47.92.18.10', 10051, 90_000, '47.92.18.10', 1_000, 1],
  ['tcp', '192.168.1.10', 40000, '54.230.183.37', 443, 0, '54.230.183.37', 100_000, 0],
], hour - H + 120);
flushFlows();

test('groups addresses by registrable domain, then by network owner', () => {
  const g = destinationGroups(umbrel, hour - 3 * H, now + 1, 'service', watch);
  assert.deepEqual(g.map((x) => [x.key, x.kind, x.label, x.ips, x.down]), [
    ['base:docker.com', 'service', 'docker.com', 2, 5_100_000],
    ['asn:16509', 'network', 'Amazon.com, Inc.', 1, 400_000],
    ['asn:37963', 'network', 'Alibaba', 1, 1_000],
  ]);
  assert.equal(g[0].conns, 2);
  assert.deepEqual(g.map((x) => x.flagged), [false, false, true]);
  const byIp = destinationGroups(umbrel, hour - 3 * H, now + 1, 'ip', watch);
  assert.equal(byIp.length, 4);
  assert.equal(byIp[0].label, 'production.cloudfront.docker.com');
});

test('a window keeps only the hours inside it', () => {
  const g = destinationGroups(umbrel, hour - H, hour, 'service', watch);
  assert.deepEqual(g.map((x) => [x.key, x.down]), [['asn:16509', 400_000], ['base:docker.com', 100_000], ['asn:37963', 1_000]]);
});

test('detail of a window still charts the whole range', () => {
  const byId = new Map() as never;
  const d = destinationDetail(umbrel, hour - 2 * H, hour - H, [hour - 3 * H, now + 1], 'base:docker.com', 'service', watch, byId)!;
  assert.deepEqual(d.series.map((p) => p[1]), [0, 5_000_000, 100_000, 0]);
  assert.deepEqual(d.ports.map((p) => p.down), [5_000_000]);
});

test('detail: hourly series over the range, ports, addresses, other devices, first/last seen', () => {
  const byId = new Map((db.prepare('SELECT * FROM devices').all() as Array<{ id: number }>).map((d) => [d.id, d])) as never;
  const d = destinationDetail(umbrel, hour - 3 * H, now + 1, [hour - 3 * H, now + 1], 'base:docker.com', 'service', watch, byId)!;
  assert.deepEqual(d.series.map((p) => p[1]), [0, 5_000_000, 100_000, 0]);
  assert.equal(d.step, H);
  assert.deepEqual(d.ports, [{ proto: 6, port: 443, up: 2_000, down: 5_100_000, conns: 2 }]);
  assert.deepEqual(d.addresses.map((a) => (a as { ip: string }).ip), ['54.230.183.37', '54.230.183.38']);
  assert.deepEqual(d.devices.map((x) => [x.id, x.down]), [[laptop, 7_000]]);
  assert.deepEqual([d.firstSeen, d.lastSeen], [hour - 2 * H, hour - H]);
  assert.equal(destinationDetail(umbrel, hour - 3 * H, now + 1, [hour - 3 * H, now + 1], 'base:nope.com', 'service', watch, byId), null);
});
