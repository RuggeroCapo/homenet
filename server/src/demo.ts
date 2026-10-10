// DEMO=1: simulated OpenWrt router + AdGuard Home, plus 7 days of back-filled history.
// Lets you develop the UI without touching the real network.
import type { AdGuardApi, QueryLogEntry } from './adguard.js';
import { db, domainId } from './db.js';
import { guessKind } from './devices.js';
import { addEvent } from './events.js';
import { registerDemoGeo } from './geo.js';
import { baseDomain } from './collectors/dns.js';
import type { FlowRow, RawConntrack, RawHosts, RawInfo, RawWifi, RouterAction, RouterApi } from './router.js';
import { log } from './log.js';

interface Dest { ip: string; domain: string; cc: string; asn: number; org: string; port: number; down: number; up: number }

const D: Record<string, Dest> = {
  google: { ip: '142.250.180.14', domain: 'www.google.com', cc: 'US', asn: 15169, org: 'Google LLC', port: 443, down: 9_000, up: 1_500 },
  youtube: { ip: '142.250.184.110', domain: 'rr3---sn-hpa7zn7s.googlevideo.com', cc: 'US', asn: 15169, org: 'Google LLC', port: 443, down: 260_000, up: 4_000 },
  github: { ip: '140.82.121.4', domain: 'github.com', cc: 'US', asn: 36459, org: 'GitHub, Inc.', port: 443, down: 22_000, up: 3_000 },
  apple: { ip: '17.253.53.207', domain: 'gateway.icloud.com', cc: 'US', asn: 714, org: 'Apple Inc.', port: 443, down: 30_000, up: 9_000 },
  anthropic: { ip: '160.79.104.10', domain: 'claude.ai', cc: 'US', asn: 399358, org: 'Anthropic, PBC', port: 443, down: 12_000, up: 2_500 },
  microsoft: { ip: '20.190.159.0', domain: 'login.live.com', cc: 'IE', asn: 8075, org: 'Microsoft Corporation', port: 443, down: 6_000, up: 1_000 },
  netflix: { ip: '45.57.90.1', domain: 'ipv4-c001-mil001-ix.1.oca.nflxvideo.net', cc: 'IT', asn: 2906, org: 'Netflix Streaming Services Inc.', port: 443, down: 520_000, up: 6_000 },
  lgads: { ip: '52.28.71.9', domain: 'eu.info.lgsmartad.com', cc: 'DE', asn: 16509, org: 'Amazon.com, Inc.', port: 443, down: 1_500, up: 2_200 },
  playstation: { ip: '23.40.100.12', domain: 'gs2.ww.prod.dl.playstation.net', cc: 'DE', asn: 20940, org: 'Akamai International B.V.', port: 443, down: 380_000, up: 9_000 },
  nabucasa: { ip: '104.26.4.12', domain: 'remote.nabucasa.com', cc: 'US', asn: 13335, org: 'Cloudflare, Inc.', port: 443, down: 4_000, up: 6_000 },
  tuya: { ip: '3.120.33.7', domain: 'a1.tuyaeu.com', cc: 'DE', asn: 16509, org: 'Amazon.com, Inc.', port: 8883, down: 300, up: 500 },
  instagram: { ip: '157.240.231.174', domain: 'i.instagram.com', cc: 'IE', asn: 32934, org: 'Facebook, Inc.', port: 443, down: 70_000, up: 6_000 },
  whatsapp: { ip: '157.240.231.60', domain: 'mmg.whatsapp.net', cc: 'IE', asn: 32934, org: 'Facebook, Inc.', port: 443, down: 9_000, up: 4_000 },
  cloudlinks: { ip: '47.92.18.10', domain: 'p2p.cloudlinks.cn', cc: 'CN', asn: 37963, org: 'Hangzhou Alibaba Advertising Co.,Ltd.', port: 10051, down: 900, up: 38_000 },
  tencent: { ip: '119.29.29.29', domain: 'log.yi-iot.qq.com', cc: 'CN', asn: 45090, org: 'Shenzhen Tencent Computer Systems Company Limited', port: 443, down: 300, up: 2_400 },
  cloudflare: { ip: '1.1.1.1', domain: 'cloudflare-dns.com', cc: 'US', asn: 13335, org: 'Cloudflare, Inc.', port: 853, down: 2_000, up: 1_000 },
  docker: { ip: '54.236.113.205', domain: 'registry-1.docker.io', cc: 'US', asn: 14618, org: 'Amazon.com, Inc.', port: 443, down: 40_000, up: 1_000 },
  micn: { ip: '120.92.65.3', domain: 'ot.io.mi.com', cc: 'CN', asn: 59019, org: 'Beijing Kingsoft Cloud Internet Technology Co., Ltd', port: 8053, down: 400, up: 1_600 },
  mieu: { ip: '47.254.140.77', domain: 'de.ot.io.mi.com', cc: 'DE', asn: 45102, org: 'Alibaba (US) Technology Co., Ltd.', port: 8053, down: 600, up: 900 },
  amazon: { ip: '52.95.116.115', domain: 'images-eu.ssl-images-amazon.com', cc: 'IE', asn: 16509, org: 'Amazon.com, Inc.', port: 443, down: 15_000, up: 1_000 },
};

/** DNS-only noise (blocked trackers etc.), no traffic */
const NOISE: Record<string, string[]> = {
  tv: ['tracking.netflix.com', 'ngfts.lge.com', 'us.ad.lgsmartad.com', 'samsungads.com'],
  phone: ['app-measurement.com', 'graph.instagram.com', 'firebaselogging-pa.googleapis.com', 'doubleclick.net'],
  laptop: ['www.googletagmanager.com', 'sentry.io', 'api.github.com', 'registry.npmjs.org', 'stackoverflow.com'],
  camera: ['ntp.aliyun.com', 'log.cloudlinks.cn'],
  any: ['time.apple.com', 'connectivitycheck.gstatic.com', 'pool.ntp.org'],
};

type Profile = 'evening' | 'work' | 'flat' | 'phone';

interface Dev { mac: string; ip: string; name: string; dests: string[]; scale: number; profile: Profile; wifi?: 'radio0' | 'radio1'; signal?: number; noise: string }

const DEVS: Dev[] = [
  { mac: 'a4:83:e7:10:00:10', ip: '192.168.1.10', name: 'MacBook-Pro', dests: ['google', 'github', 'apple', 'anthropic', 'microsoft', 'youtube', 'docker'], scale: 1, profile: 'work', wifi: 'radio1', signal: -48, noise: 'laptop' },
  { mac: '58:fd:b1:22:00:35', ip: '192.168.1.35', name: 'LG-webOS-TV', dests: ['netflix', 'youtube', 'lgads'], scale: 1, profile: 'evening', wifi: 'radio1', signal: -61, noise: 'tv' },
  { mac: '00:e4:21:33:00:42', ip: '192.168.1.42', name: 'PS5-2F9A', dests: ['playstation', 'netflix', 'google'], scale: 0.9, profile: 'evening', noise: 'any' },
  { mac: 'dc:a6:32:44:00:20', ip: '192.168.1.20', name: 'homeassistant', dests: ['nabucasa', 'github', 'tuya', 'google'], scale: 1, profile: 'flat', noise: 'any' },
  { mac: 'f0:18:98:55:00:15', ip: '192.168.1.15', name: 'iPhone-di-Marco', dests: ['apple', 'instagram', 'whatsapp', 'google', 'youtube', 'amazon'], scale: 0.45, profile: 'phone', wifi: 'radio1', signal: -57, noise: 'phone' },
  { mac: '7c:a7:b0:66:00:55', ip: '192.168.1.55', name: 'IPC-365-Camera', dests: ['cloudlinks', 'tencent', 'tuya'], scale: 1, profile: 'flat', wifi: 'radio0', signal: -67, noise: 'camera' },
  { mac: '00:1e:06:77:00:02', ip: '192.168.1.2', name: 'umbrel', dests: ['cloudflare', 'docker', 'github'], scale: 0.6, profile: 'flat', noise: 'any' },
  { mac: '1c:f2:9a:88:00:60', ip: '192.168.1.60', name: 'Google-Nest-Hub', dests: ['google', 'youtube'], scale: 0.15, profile: 'evening', wifi: 'radio0', signal: -63, noise: 'any' },
  { mac: '50:ec:50:99:00:71', ip: '192.168.1.71', name: 'roborock-vacuum', dests: ['micn', 'mieu'], scale: 1, profile: 'flat', wifi: 'radio0', signal: -72, noise: 'any' },
  { mac: 'a0:b7:65:aa:00:73', ip: '192.168.1.73', name: 'ESP32-CAM', dests: ['tuya', 'cloudlinks'], scale: 0.2, profile: 'flat', wifi: 'radio0', signal: -76, noise: 'camera' },
];

function activity(p: Profile, t: number) {
  const h = new Date(t * 1000).getHours() + new Date(t * 1000).getMinutes() / 60;
  const bump = (c: number, w: number) => Math.exp(-((h - c) ** 2) / (2 * w * w));
  switch (p) {
    case 'evening': return 0.03 + 1.1 * bump(21, 1.6) + 0.25 * bump(14, 1.5);
    case 'work': return 0.05 + 0.9 * bump(11, 2) + 0.8 * bump(16, 2) + 0.3 * bump(22, 1);
    case 'phone': return 0.1 + 0.6 * bump(8, 1) + 0.5 * bump(13, 1) + 0.9 * bump(22, 1.5);
    default: return 0.8 + 0.2 * Math.sin(h);
  }
}

const jitter = (x: number, k = 0.35) => x * (1 - k + Math.random() * 2 * k);

for (const d of Object.values(D)) registerDemoGeo(d.ip, { cc: d.cc, asn: d.asn, org: d.org });

export class DemoRouter implements RouterApi {
  private boot = Math.floor(Date.now() / 86_400_000) * 86400 - 12 * 86400 - 4 * 3600;
  private last = Date.now() / 1000;
  private rx = 8.4e11;
  private tx = 9.1e10;
  private ports = new Map<string, number>();

  async info(): Promise<RawInfo> {
    const up = Date.now() / 1000 - this.boot;
    return {
      plugin: 1,
      board: { model: 'GL.iNet GL-X3000', hostname: 'OpenWrt', release: { description: 'OpenWrt 23.05.4 r24012' } },
      system: { uptime: Math.floor(up), load: [0.21 * 65536, 0.18 * 65536, 0.15 * 65536], memory: { total: 512e6, free: 210e6, available: 300e6 } },
      ifaces: {
        interface: [
          { interface: 'lan', up: true, proto: 'static', device: 'br-lan', l3_device: 'br-lan', 'ipv4-address': [{ address: '192.168.1.1', mask: 24 }], route: [] },
          { interface: 'modem_1_1_2', up: true, proto: 'qmi', device: 'wwan0', l3_device: 'wwan0', uptime: Math.floor(up - 3600), 'ipv4-address': [{ address: '10.152.33.17', mask: 30 }], route: [{ target: '0.0.0.0', mask: 0, nexthop: '10.152.33.18' }] },
          { interface: 'wwan', up: false, proto: 'dhcp', device: 'phy0-sta0', l3_device: 'phy0-sta0', route: [] },
          { interface: 'loopback', up: true, proto: 'static', device: 'lo', 'ipv4-address': [{ address: '127.0.0.1', mask: 8 }] },
        ],
      },
      netdev: { wwan0: [this.rx, this.tx], 'br-lan': [1, 1] },
      offload: '0',
      acct: '1',
    };
  }

  async hosts(): Promise<RawHosts> {
    return {
      leases: DEVS.map((d) => [d.mac, d.ip, d.name]),
      neigh: DEVS.map((d) => [d.ip, d.mac, d.name === 'Google-Nest-Hub' && new Date().getMinutes() % 20 < 3 ? 'STALE' : 'REACHABLE', 'br-lan']),
    };
  }

  async wifi(): Promise<RawWifi> {
    const radio = (id: 'radio0' | 'radio1', freq: number, ch: number) => ({
      info: { ssid: 'CasaNet', mode: 'Master', channel: ch, frequency: freq, txpower: 20, bitrate: 0, quality: 70, quality_max: 70 },
      assoc: { results: DEVS.filter((d) => d.wifi === id).map((d) => ({ mac: d.mac, signal: Math.round(jitter(d.signal!, 0.05)), noise: -92, inactive: 1200, rx: { rate: id === 'radio1' ? 866700 : 72200 }, tx: { rate: id === 'radio1' ? 780000 : 65000 } })) },
    });
    return { 'phy0-ap0': radio('radio0', 2437, 6), 'phy1-ap0': radio('radio1', 5500, 100) };
  }

  async conntrack(): Promise<RawConntrack> {
    const now = Date.now() / 1000;
    const dt = Math.min(120, now - this.last);
    this.last = now;
    const flows: FlowRow[] = [];
    for (const dev of DEVS) {
      const a = activity(dev.profile, now) * dev.scale;
      for (const k of dev.dests) {
        const d = D[k];
        if (Math.random() > 0.85) continue;
        const key = `${dev.mac}|${k}`;
        let isNew = 0;
        if (!this.ports.has(key) || Math.random() < 0.08) { this.ports.set(key, 40000 + Math.floor(Math.random() * 20000)); isNew = 1; }
        const flat = dev.profile === 'flat' ? 1 : a;
        const down = Math.round(jitter(d.down * flat * dt));
        const upB = Math.round(jitter(d.up * flat * dt));
        this.rx += down; this.tx += upB;
        flows.push(['tcp', dev.ip, this.ports.get(key)!, d.ip, d.port, upB, d.ip, down, isNew]);
      }
    }
    return { seed: false, flows, truncated: 0 };
  }

  async modem() {
    const rsrp = Math.round(jitter(-94, 0.04));
    const rsrq = Math.round(jitter(-10, 0.15));
    const rssi = rsrp + 28;
    const sinr = Math.round(jitter(13, 0.25));
    return {
      method: 'at',
      csq: `+CSQ: ${Math.round((rssi + 113) / 2)},99`,
      cops: '+COPS: 0,0,"TIM",7',
      qeng: `+QENG: "servingcell","NOCONN","LTE","FDD",222,01,1A2B3C4,123,1850,3,5,5,ABCD,${rsrp},${rsrq},${rssi},${sinr},30`,
      qnwinfo: '+QNWINFO: "FDD LTE","22201","LTE BAND 3",1850',
    };
  }

  async sms() {
    return {
      msg: [
        { index: 0, sender: 'TIM', timestamp: '10/10/26 09:12:44', content: 'TIM: hai consumato l\'80% dei Giga inclusi nella tua offerta. Rinnovo il 15/10.' },
        { index: 1, sender: '40916', timestamp: '11/10/26 07:30:02', content: 'Gentile cliente, la tua offerta è stata rinnovata. Giga disponibili: 150GB.' },
      ],
    };
  }

  async action(name: RouterAction, ifaces: string[]) {
    log.info(`demo: router action ${name} (${ifaces.join(' ')})`);
  }
}

export class DemoAdGuard implements AdGuardApi {
  private buf: QueryLogEntry[] = [];
  private last = Date.now() / 1000 - 3600;

  private generate() {
    const now = Date.now() / 1000;
    const out: QueryLogEntry[] = [];
    for (const dev of DEVS) {
      const a = dev.profile === 'flat' ? 0.6 : activity(dev.profile, now);
      const names = [...dev.dests.flatMap((k) => [D[k].domain, D[k].domain, D[k].domain]), ...NOISE[dev.noise], ...(dev.noise === 'any' ? [] : NOISE.any)];
      const n = Math.round(jitter((now - this.last) / 60 * 6 * a));
      for (let i = 0; i < n; i++) {
        const name = names[Math.floor(Math.random() * names.length)];
        const dest = Object.values(D).find((d) => d.domain === name);
        const blocked = /tracking|ad\.|ads\.|lgsmartad|measurement|doubleclick|googletagmanager|firebaselogging|ngfts|samsungads|sentry/.test(name);
        out.push({
          time: new Date((this.last + Math.random() * (now - this.last)) * 1000).toISOString(),
          client: dev.ip,
          question: { name, type: 'A' },
          answer: dest && !blocked ? [{ type: 'A', value: dest.ip, ttl: 300 }] : [],
          reason: blocked ? 'FilteredBlackList' : 'NotFilteredNotFound',
        });
      }
    }
    this.last = now;
    this.buf.push(...out);
    this.buf.sort((x, y) => Date.parse(y.time) - Date.parse(x.time));
    this.buf = this.buf.slice(0, 5000);
  }

  async querylog(olderThan?: string, limit = 500) {
    if (!olderThan) this.generate();
    const cut = olderThan ? Date.parse(olderThan) : Infinity;
    const data = this.buf.filter((e) => Date.parse(e.time) < cut).slice(0, limit);
    return { data, oldest: data.at(-1)?.time };
  }

  async status() {
    return { version: 'v0.107.52 (demo)', running: true, protection_enabled: true };
  }
}

/** Fills the database with a week of synthetic history the first time demo mode starts. */
export function backfillDemo() {
  const has = db.prepare('SELECT COUNT(*) AS n FROM traffic_5m').get() as { n: number };
  if (has.n > 0) return;
  log.info('demo: back-filling 7 days of history…');
  const now = Math.floor(Date.now() / 1000);
  const start = now - 7 * 86400;
  const t0 = start - (start % 300);
  const insDev = db.prepare('INSERT OR IGNORE INTO devices (mac, hostname, kind, ip, first_seen, last_seen, online) VALUES (?, ?, ?, ?, ?, ?, 1)');
  const insT = db.prepare('INSERT OR REPLACE INTO traffic_5m (ts, device_id, up, down) VALUES (?, ?, ?, ?)');
  const insF = db.prepare(`INSERT INTO flows_1h (ts, device_id, ip, proto, port, up, down, conns, cc, asn, domain_id) VALUES (?, ?, ?, 6, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ts, device_id, ip, proto, port) DO UPDATE SET up = up + excluded.up, down = down + excluded.down, conns = conns + excluded.conns`);
  const insQ = db.prepare(`INSERT INTO dns_1h (ts, device_id, domain_id, queries, blocked) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(ts, device_id, domain_id) DO UPDATE SET queries = queries + excluded.queries, blocked = blocked + excluded.blocked`);
  const insS = db.prepare('INSERT OR REPLACE INTO samples (ts, online, latency, loss, rx_bps, tx_bps, router_ok, signal) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  const insA = db.prepare('INSERT OR IGNORE INTO asns (asn, org) VALUES (?, ?)');
  const outage = [now - 2 * 86400 - 3 * 3600, now - 2 * 86400 - 3 * 3600 + 7 * 60];

  db.transaction(() => {
    for (const d of Object.values(D)) insA.run(d.asn, d.org);
    const ids = new Map<string, number>();
    for (const dev of DEVS) {
      insDev.run(dev.mac, dev.name, guessKind(dev.name), dev.ip, start, now);
      ids.set(dev.mac, (db.prepare('SELECT id FROM devices WHERE mac = ?').get(dev.mac) as { id: number }).id);
    }
    const blockedRe = /tracking|ad\.|ads\.|lgsmartad|measurement|doubleclick|googletagmanager|firebaselogging|ngfts|samsungads|sentry/;
    for (let t = t0; t < now - 300; t += 300) {
      const hour = t - (t % 3600);
      const down = outage[0] <= t && t < outage[1];
      let rxSum = 0, txSum = 0;
      for (const dev of DEVS) {
        const id = ids.get(dev.mac)!;
        const a = (dev.profile === 'flat' ? 1 : activity(dev.profile, t)) * dev.scale * (down ? 0 : 1);
        let up = 0, dn = 0;
        for (const k of dev.dests) {
          const d = D[k];
          const u = Math.round(jitter(d.up * a * 300));
          const w = Math.round(jitter(d.down * a * 300));
          up += u; dn += w;
          insF.run(hour, id, d.ip, d.port, u, w, Math.random() < 0.3 ? 1 : 0, d.cc, d.asn, domainId(d.domain, baseDomain(d.domain)));
        }
        rxSum += dn; txSum += up;
        insT.run(t, id, up, dn);
        const qa = dev.profile === 'flat' ? 0.6 : activity(dev.profile, t);
        const names = [...dev.dests.flatMap((k) => [D[k].domain, D[k].domain, D[k].domain]), ...NOISE[dev.noise], ...(dev.noise === 'any' ? [] : NOISE.any)];
        for (const name of names) {
          const q = Math.round(jitter(30 * qa / names.length, 0.6));
          if (q > 0) insQ.run(hour, id, domainId(name, baseDomain(name)), q, blockedRe.test(name) ? q : 0);
        }
      }
      for (let m = 0; m < 5; m++) {
        const ts = t + m * 60;
        const off = outage[0] <= ts && ts < outage[1];
        const rsrp = jitter(-94, 0.04);
        insS.run(ts, off ? 0 : 1, off ? null : jitter(18, 0.3), off ? 1 : Math.random() < 0.05 ? 0.33 : 0, (rxSum * 8) / 300, (txSum * 8) / 300,
          JSON.stringify({ q: Math.round(((rsrp + 120) / 40) * 100), rsrp, rsrq: jitter(-10, 0.15), sinr: jitter(13, 0.25), rssi: rsrp + 28, tech: 'LTE' }));
      }
    }
  })();
  const esp = (db.prepare('SELECT id FROM devices WHERE mac = ?').get('a0:b7:65:aa:00:73') as { id: number }).id;
  addEvent('internet_down', 'error', 'Internet non raggiungibile', 'Il router risponde, la connessione esterna no', null, outage[0]);
  addEvent('action', 'warning', 'Riavvio connessione WAN', 'Avviato automaticamente dal watchdog', null, outage[0] + 300);
  addEvent('internet_up', 'success', 'Internet di nuovo online', 'Interruzione di 7 min', null, outage[1]);
  addEvent('new_device', 'info', 'Nuovo dispositivo rilevato', 'ESP32-CAM (192.168.1.73)', esp, now - 5 * 3600);
  addEvent('router_boot', 'info', 'Router riavviato', 'GL.iNet GL-X3000', null, now - 12 * 86400);
  log.info('demo: back-fill done');
}
