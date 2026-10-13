import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-acc-'));
const { db, localDay } = await import('./db.js');
const { upsertHost, getDevice } = await import('./devices.js');
const { AccessController, evaluate, periodBounds, scheduleWindow, setLockdown } = await import('./access.js');
const { state } = await import('./state.js');
type AccessArgs = import('./router.js').AccessArgs;

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const ts = (d: Date) => Math.floor(d.getTime() / 1000);

test('schedule window crosses midnight and follows the start day', () => {
  const s = { enabled: true, days: [5], from: '22:30', to: '07:00' }; // Friday night
  assert.equal(scheduleWindow(s, at(2026, 10, 16, 21, 0)), null); // Fri 21:00
  assert.deepEqual(scheduleWindow(s, at(2026, 10, 16, 23, 0)), { start: ts(at(2026, 10, 16, 22, 30)), end: ts(at(2026, 10, 17, 7, 0)) });
  assert.ok(scheduleWindow(s, at(2026, 10, 17, 6, 59))); // Sat early morning, started Friday
  assert.equal(scheduleWindow(s, at(2026, 10, 17, 7, 0)), null);
  assert.equal(scheduleWindow(s, at(2026, 10, 17, 23, 0)), null); // Saturday not selected
  assert.equal(scheduleWindow({ ...s, enabled: false }, at(2026, 10, 16, 23, 0)), null);
  const day = { enabled: true, days: [1, 2, 3, 4, 5], from: '08:00', to: '13:00' };
  assert.ok(scheduleWindow(day, at(2026, 10, 13, 9, 0))); // Tue
  assert.equal(scheduleWindow(day, at(2026, 10, 18, 9, 0)), null); // Sun
});

test('cap periods: day, week from Monday, billing cycle', () => {
  const now = at(2026, 10, 14, 15, 0); // Wednesday
  assert.deepEqual(periodBounds('day', now), { start: ts(at(2026, 10, 14)), end: ts(at(2026, 10, 15)) });
  assert.deepEqual(periodBounds('week', now), { start: ts(at(2026, 10, 12)), end: ts(at(2026, 10, 19)) });
  assert.deepEqual(periodBounds('cycle', now, 20), { start: ts(at(2026, 9, 20)), end: ts(at(2026, 10, 20)) });
  assert.deepEqual(periodBounds('cycle', now, 5), { start: ts(at(2026, 10, 5)), end: ts(at(2026, 11, 5)) });
});

test('evaluate combines manual pause, cap and lockdown', () => {
  const id = upsertHost('aa:bb:cc:00:00:01', '192.168.1.40', 'PS5-test');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE devices SET cap_bytes = 1000, cap_period = ? WHERE id = ?').run('day', id);
  assert.equal(evaluate(getDevice(id)!, now, null).blocked, false);
  db.prepare('INSERT INTO device_daily (day, device_id, up, down) VALUES (?, ?, 400, 700)').run(localDay(now), id);
  let a = evaluate(getDevice(id)!, now, null);
  assert.deepEqual(a.reasons, ['cap']);
  assert.equal(a.until, periodBounds('day').end);
  // "resume anyway" overrides the cap until the period ends
  db.prepare('UPDATE devices SET override_until = ? WHERE id = ?').run(a.until, id);
  assert.equal(evaluate(getDevice(id)!, now, null).blocked, false);
  // an open-ended manual pause wins over everything
  db.prepare('UPDATE devices SET pause_until = 0 WHERE id = ?').run(id);
  a = evaluate(getDevice(id)!, now, null);
  assert.deepEqual(a.reasons, ['manual']);
  assert.equal(a.until, null);
  db.prepare('UPDATE devices SET pause_until = NULL, override_until = NULL, cap_bytes = NULL WHERE id = ?').run(id);
  // lockdown: blocked unless allowed or essential
  const lock = { until: now + 600, allow: [], started: now };
  assert.deepEqual(evaluate(getDevice(id)!, now, lock).reasons, ['lockdown']);
  db.prepare('UPDATE devices SET essential = 1 WHERE id = ?').run(id);
  assert.equal(evaluate(getDevice(id)!, now, lock).blocked, false);
  // devices known only by IP cannot be blocked
  const pseudo = db.prepare("INSERT INTO devices (mac, ip, first_seen, last_seen, pause_until) VALUES ('ip:192.168.1.99', '192.168.1.99', 0, 0, 0)").run().lastInsertRowid;
  assert.equal(evaluate(getDevice(Number(pseudo))!, now, null).blocked, false);
});

test('controller sends blocks with remaining seconds, allow list and kills', async () => {
  const calls: AccessArgs[] = [];
  const fakeRouter = { access: async (a: AccessArgs) => { calls.push(a); return { ok: true, conntrack: true }; } };
  state.router = { wan: [{ iface: 'wwan', device: 'wwan0' }], plugin: 2 } as never;
  const tv = upsertHost('aa:bb:cc:00:00:02', '192.168.1.41', 'LG-TV');
  const umbrel = upsertHost('aa:bb:cc:00:00:03', '192.168.1.2', 'umbrel');
  assert.equal(getDevice(umbrel)!.essential, 1, 'servers are essential by default');
  // a host first seen without a name becomes essential once its name reveals it
  const ha = upsertHost('aa:bb:cc:00:00:04', '192.168.1.20', null);
  assert.equal(getDevice(ha)!.essential, 0);
  upsertHost('aa:bb:cc:00:00:04', '192.168.1.20', 'homeassistant');
  assert.equal(getDevice(ha)!.essential, 1);
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE devices SET pause_until = ? WHERE id = ?').run(now + 3600, tv);
  const c = new AccessController(() => fakeRouter as never);
  await c.kick();
  const last = calls.at(-1)!;
  assert.match(last.block, /aa:bb:cc:00:00:02=(3599|3600)/);
  assert.equal(last.lock, '0');
  assert.equal(last.wan, 'wwan0');
  assert.match(last.kill, /aa:bb:cc:00:00:02/);
  // unchanged state: no new call
  await c.tick();
  assert.equal(calls.length, 1);
  // lockdown: TV allowed, essential devices always allowed, others cut
  setLockdown({ until: now + 1800, allow: [tv], started: now });
  await c.kick();
  const l = calls.at(-1)!;
  assert.ok(Number(l.lock) > 1790);
  assert.deepEqual(l.allow.split(' ').sort(), ['aa:bb:cc:00:00:01', 'aa:bb:cc:00:00:02', 'aa:bb:cc:00:00:03', 'aa:bb:cc:00:00:04']);
  setLockdown(null);
  await c.kick();
  assert.equal(calls.at(-1)!.lock, '0');
  const ev = db.prepare("SELECT title FROM events WHERE type IN ('access', 'access_info') ORDER BY id").all() as Array<{ title: string }>;
  assert.ok(ev.some((e) => e.title === 'Internet sospeso: LG-TV'));
  assert.ok(ev.some((e) => e.title === 'Internet di nuovo per tutti'));
});
