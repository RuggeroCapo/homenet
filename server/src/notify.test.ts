import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hn-notify-'));
const { updateSettings, publicSettings, getSettings } = await import('./settings.js');
const { send, notifyEvent } = await import('./notify.js');

test('sends ntfy with title/priority headers and keeps secrets out of public settings', async () => {
  const got: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { got.push({ headers: req.headers, body }); res.end('{}'); });
  });
  await new Promise<void>((r) => srv.listen(0, r));
  const port = (srv.address() as { port: number }).port;
  updateSettings({ notify: { ...getSettings().notify, ntfy: { enabled: true, url: `http://127.0.0.1:${port}/topic`, token: 'tok' } } });

  await send({ title: 'Internet non raggiungibile', body: 'Il router risponde', severity: 'error', ts: Math.floor(Date.now() / 1000) });
  assert.equal(got.length, 1);
  assert.equal(got[0].headers.title, 'Internet non raggiungibile');
  assert.equal(got[0].headers.priority, 'high');
  assert.equal(got[0].headers.authorization, 'Bearer tok');
  assert.equal(got[0].body, 'Il router risponde');

  const pub = publicSettings() as unknown as { notify: { ntfy: { token: string; has_token: boolean } } };
  assert.equal(pub.notify.ntfy.token, '');
  assert.equal(pub.notify.ntfy.has_token, true);
  // empty secret in an update keeps the stored value
  updateSettings({ notify: { ...getSettings().notify, ntfy: { ...getSettings().notify.ntfy, token: '' } } });
  assert.equal(getSettings().notify.ntfy.token, 'tok');

  // events of disabled groups are not pushed
  updateSettings({ notify: { ...getSettings().notify, types: { ...getSettings().notify.types, newDevice: false } } });
  notifyEvent('new_device', { title: 'x', body: '', severity: 'info', ts: Math.floor(Date.now() / 1000) });
  notifyEvent('internet_up', { title: 'Internet di nuovo online', body: '', severity: 'success', ts: Math.floor(Date.now() / 1000) });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(got.map((g) => g.headers.title), ['Internet non raggiungibile', 'Internet di nuovo online']);
  srv.close();
});

test('reports channel errors', async () => {
  updateSettings({ notify: { ...getSettings().notify, ntfy: { enabled: true, url: 'http://127.0.0.1:9/x', token: '' } } });
  await assert.rejects(send({ title: 't', body: 'b', severity: 'info', ts: 0 }), /ntfy/);
});
