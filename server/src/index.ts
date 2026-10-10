import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdGuardClient, type AdGuardApi } from './adguard.js';
import { registerApi } from './api.js';
import { DnsCollector, flushDns } from './collectors/dns.js';
import { flushFlows } from './collectors/flows.js';
import { Probe } from './collectors/probe.js';
import { RouterCollector } from './collectors/router.js';
import { Watchdog } from './collectors/watchdog.js';
import { db, prune } from './db.js';
import { refreshOnline } from './devices.js';
import { initGeo } from './geo.js';
import { log } from './log.js';
import { UbusClient, type RouterApi } from './router.js';
import { adguardConfigured, DEMO, getSettings, onSettingsChange, routerConfigured, type Settings } from './settings.js';
import { collectorDisabled } from './state.js';

const PORT = Number(process.env.PORT ?? 3000);

let routerCollector: RouterCollector | null = null;
let dnsCollector: DnsCollector | null = null;

async function startCollectors(s: Settings) {
  routerCollector?.stop();
  dnsCollector?.stop();
  routerCollector = null;
  dnsCollector = null;
  for (const k of ['router.info', 'router.hosts', 'router.wifi', 'router.conntrack', 'router.modem', 'router.sms', 'adguard']) collectorDisabled(k);

  let routerApi: RouterApi | null = null;
  let adguardApi: AdGuardApi | null = null;
  if (DEMO) {
    const demo = await import('./demo.js');
    demo.backfillDemo();
    routerApi = new demo.DemoRouter();
    adguardApi = new demo.DemoAdGuard();
  } else {
    if (routerConfigured(s)) routerApi = new UbusClient(s.router.url, s.router.username, s.router.password);
    if (adguardConfigured(s)) adguardApi = new AdGuardClient(s.adguard.url, s.adguard.username, s.adguard.password);
  }
  if (routerApi) { routerCollector = new RouterCollector(routerApi); routerCollector.start(); }
  if (adguardApi) { dnsCollector = new DnsCollector(adguardApi); dnsCollector.start(); }
  log.info(`collectors: router=${!!routerApi} adguard=${!!adguardApi}${DEMO ? ' (demo)' : ''}`);
}

async function main() {
  void initGeo();
  await startCollectors(getSettings());

  let restartTimer: NodeJS.Timeout | undefined;
  onSettingsChange((s) => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => void startCollectors(s), 500);
  });

  const watchdog = new Watchdog(() => routerCollector);
  const probe = new Probe(
    (online) => void watchdog.tick(online),
    () => routerCollector?.takeMinute() ?? { rx: null, tx: null },
  );
  probe.start();

  setInterval(() => { flushFlows(); flushDns(); }, 60_000);
  setInterval(refreshOnline, 60_000);
  setTimeout(refreshOnline, 20_000);
  const doPrune = () => { try { prune(getSettings().retentionDays); } catch (e) { log.error('prune', e); } };
  setTimeout(doPrune, 30_000);
  setInterval(doPrune, 6 * 3600_000);
  setInterval(() => void initGeo(), 7 * 86400_000);

  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  registerApi(app, () => routerCollector);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webRoot = [process.env.WEB_ROOT, path.join(here, '../public'), path.join(here, '../../web/dist')].find((p) => p && fs.existsSync(p));
  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }
  app.setErrorHandler((err, _req, reply) => {
    log.error(err);
    reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
  });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  log.info(`HomeNet listening on :${PORT}${webRoot ? ` (ui: ${webRoot})` : ''}`);

  const shutdown = () => {
    log.info('shutting down');
    try { flushFlows(); flushDns(); db.close(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
