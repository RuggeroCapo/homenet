import { BlockList, isIP } from 'node:net';
import { db } from './db.js';
import { addEvent } from './events.js';

export interface DeviceRow {
  id: number; mac: string; hostname: string | null; alias: string | null; kind: string | null; ip: string | null;
  first_seen: number; last_seen: number; online: number; notify_offline: number; wifi_signal: number | null; wifi_iface: string | null;
}

const KIND_RULES: Array<[RegExp, string]> = [
  [/homeassistant|hass|home-assistant/i, 'homeassistant'],
  [/cam|ipc|ezviz|tapo-?c|reolink|hikvision|imou|dahua|yi-?home|wyze|blink|arlo|eufy/i, 'camera'],
  [/iphone|android|pixel|galaxy|redmi|xiaomi-?\d|oneplus|phone|huawei-p|oppo|realme|motorola|moto-/i, 'phone'],
  [/ipad|tablet|tab-?s/i, 'tablet'],
  [/macbook|laptop|thinkpad|notebook|xps|surface|zenbook/i, 'laptop'],
  [/imac|desktop|pc-|-pc|workstation|mac-?mini|mac-?studio/i, 'desktop'],
  [/playstation|ps4|ps5|xbox|nintendo|switch|steamdeck|steam-deck/i, 'console'],
  [/tv|bravia|roku|chromecast|fire-?tv|aftmm|shield|webos|tizen|appletv|apple-tv/i, 'tv'],
  [/sonos|echo|alexa|homepod|nest-?(mini|audio|hub)|google-?home|speaker/i, 'speaker'],
  [/umbrel|nas|synology|qnap|raspberry|raspberrypi|server|proxmox|truenas/i, 'server'],
  [/printer|epson|hp[a-f0-9]{6}|canon|brother|laserjet/i, 'printer'],
  [/esp|tuya|shelly|sonoff|tasmota|plug|bulb|tradfri|hue|nest|roborock|vacuum|dreame|ecovacs|smartlife|wled|zigbee/i, 'iot'],
];

export function guessKind(name: string | null | undefined): string {
  if (!name) return 'unknown';
  for (const [re, kind] of KIND_RULES) if (re.test(name)) return kind;
  return 'unknown';
}

export function displayName(d: Pick<DeviceRow, 'alias' | 'hostname' | 'mac' | 'ip'>) {
  return d.alias || d.hostname || (d.mac.startsWith('ip:') ? d.mac.slice(3) : d.ip ?? d.mac);
}

// ---------- LAN membership ----------

let lan = defaultLan();
function defaultLan() {
  const b = new BlockList();
  b.addSubnet('10.0.0.0', 8, 'ipv4');
  b.addSubnet('172.16.0.0', 12, 'ipv4');
  b.addSubnet('192.168.0.0', 16, 'ipv4');
  b.addSubnet('fc00::', 7, 'ipv6');
  return b;
}

export function setLanSubnets(v4: Array<[string, number]>, v6: Array<[string, number]>) {
  if (!v4.length) return;
  const b = new BlockList();
  for (const [a, m] of v4) { try { b.addSubnet(a, m, 'ipv4'); } catch { /* ignore */ } }
  for (const [a, m] of v6) { try { b.addSubnet(a, m, 'ipv6'); } catch { /* ignore */ } }
  lan = b;
}

export function isLan(ip: string) {
  const v = isIP(ip);
  if (!v) return false;
  return lan.check(ip, v === 4 ? 'ipv4' : 'ipv6');
}

// ---------- registry ----------

const byMac = new Map<string, number>();
const byIp = new Map<string, number>();
const lastActive = new Map<number, number>();

const now = () => Math.floor(Date.now() / 1000);
const insert = db.prepare('INSERT OR IGNORE INTO devices (mac, hostname, kind, ip, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)');
const getByMac = db.prepare('SELECT * FROM devices WHERE mac = ?');

for (const d of db.prepare('SELECT id, mac, ip FROM devices').all() as DeviceRow[]) {
  byMac.set(d.mac, d.id);
  if (d.ip) byIp.set(d.ip, d.id);
}

function create(mac: string, ip: string | null, hostname: string | null): number {
  const t = now();
  const info = insert.run(mac, hostname, guessKind(hostname), ip, t, t);
  const id = (getByMac.get(mac) as DeviceRow).id;
  byMac.set(mac, id);
  if (info.changes && !mac.startsWith('ip:')) {
    addEvent('new_device', 'info', 'Nuovo dispositivo rilevato', `${hostname || mac} (${ip ?? mac})`, id);
  }
  return id;
}

/** Moves all history of a placeholder device into the real one, then deletes the placeholder. */
function mergeDevice(from: number, to: number) {
  db.transaction(() => {
    db.prepare(`INSERT INTO traffic_5m (ts, device_id, up, down) SELECT ts, ?, up, down FROM traffic_5m WHERE device_id = ?
      ON CONFLICT(ts, device_id) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`).run(to, from);
    db.prepare(`INSERT INTO flows_1h (ts, device_id, ip, proto, port, up, down, conns, cc, asn, domain_id)
      SELECT ts, ?, ip, proto, port, up, down, conns, cc, asn, domain_id FROM flows_1h WHERE device_id = ?
      ON CONFLICT(ts, device_id, ip, proto, port) DO UPDATE SET up = up + excluded.up, down = down + excluded.down, conns = conns + excluded.conns`).run(to, from);
    db.prepare(`INSERT INTO dns_1h (ts, device_id, domain_id, queries, blocked) SELECT ts, ?, domain_id, queries, blocked FROM dns_1h WHERE device_id = ?
      ON CONFLICT(ts, device_id, domain_id) DO UPDATE SET queries = queries + excluded.queries, blocked = blocked + excluded.blocked`).run(to, from);
    for (const t of ['traffic_5m', 'flows_1h', 'dns_1h']) db.prepare(`DELETE FROM ${t} WHERE device_id = ?`).run(from);
    db.prepare('UPDATE events SET device_id = ? WHERE device_id = ?').run(to, from);
    db.prepare('DELETE FROM devices WHERE id = ?').run(from);
  })();
  const last = lastActive.get(from);
  if (last) markActive(to, last);
  lastActive.delete(from);
  for (const [k, v] of byMac) if (v === from) byMac.delete(k);
  for (const [k, v] of byIp) if (v === from) byIp.set(k, to);
}

/** Called with fresh router host data: MAC is the identity, IPs and names may change. */
export function upsertHost(mac: string, ip: string | null, hostname: string | null): number {
  mac = mac.toLowerCase();
  const name = hostname && hostname !== '*' ? hostname : null;
  let id = byMac.get(mac);
  if (id === undefined) {
    // promote a pseudo device created earlier from the same IP (e.g. seen by AdGuard first)
    const pseudo = ip ? byMac.get(`ip:${ip}`) : undefined;
    if (pseudo !== undefined) {
      db.prepare('UPDATE devices SET mac = ? WHERE id = ?').run(mac, pseudo);
      byMac.delete(`ip:${ip}`);
      byMac.set(mac, pseudo);
      id = pseudo;
    } else {
      id = create(mac, ip, name);
    }
  } else if (ip) {
    const pseudo = byMac.get(`ip:${ip}`);
    if (pseudo !== undefined && pseudo !== id) mergeDevice(pseudo, id);
  }
  if (ip && isIP(ip) === 4) {
    db.prepare('UPDATE devices SET ip = ? WHERE id = ? AND (ip IS NULL OR ip != ?)').run(ip, id, ip);
  }
  if (name) {
    db.prepare("UPDATE devices SET hostname = ?, kind = CASE WHEN kind IS NULL OR kind = 'unknown' THEN ? ELSE kind END WHERE id = ? AND (hostname IS NULL OR hostname != ?)")
      .run(name, guessKind(name), id, name);
  }
  if (ip) byIp.set(ip, id);
  return id;
}

/** Resolves a LAN IP to a device, creating a placeholder when the MAC is unknown. */
export function deviceForIp(ip: string, nameHint?: string | null): number {
  let id = byIp.get(ip);
  if (id !== undefined) return id;
  const key = `ip:${ip}`;
  id = byMac.get(key);
  if (id === undefined) {
    const row = getByMac.get(key) as DeviceRow | undefined;
    id = row ? row.id : create(key, ip, nameHint ?? null);
    byMac.set(key, id);
  }
  byIp.set(ip, id);
  if (nameHint) {
    db.prepare("UPDATE devices SET hostname = ?, kind = CASE WHEN kind IS NULL OR kind = 'unknown' THEN ? ELSE kind END WHERE id = ? AND hostname IS NULL")
      .run(nameHint, guessKind(nameHint), id);
  }
  return id;
}

export function nameHintFor(id: number, name: string) {
  db.prepare("UPDATE devices SET hostname = ?, kind = CASE WHEN kind IS NULL OR kind = 'unknown' THEN ? ELSE kind END WHERE id = ? AND hostname IS NULL")
    .run(name, guessKind(name), id);
}

export function markActive(id: number, ts = now()) {
  const prev = lastActive.get(id) ?? 0;
  if (ts > prev) lastActive.set(id, ts);
}

export function setWifi(macSignals: Map<string, { signal?: number; iface: string }>) {
  const upd = db.prepare('UPDATE devices SET wifi_signal = ?, wifi_iface = ? WHERE id = ?');
  const clear = db.prepare('UPDATE devices SET wifi_signal = NULL, wifi_iface = NULL WHERE wifi_iface IS NOT NULL');
  db.transaction(() => {
    clear.run();
    for (const [mac, w] of macSignals) {
      const id = byMac.get(mac);
      if (id !== undefined) { upd.run(w.signal ?? null, w.iface, id); markActive(id); }
    }
  })();
}

const ONLINE_WINDOW = 300;

/** Recomputes online flags from recent activity and emits events for watched devices. */
export function refreshOnline() {
  const t = now();
  const rows = db.prepare('SELECT * FROM devices').all() as DeviceRow[];
  const upd = db.prepare('UPDATE devices SET online = ?, last_seen = MAX(last_seen, ?) WHERE id = ?');
  db.transaction(() => {
    for (const d of rows) {
      const last = lastActive.get(d.id) ?? 0;
      const online = t - last < ONLINE_WINDOW ? 1 : 0;
      if (online !== d.online || last > d.last_seen) upd.run(online, last, d.id);
      if (online !== d.online && d.notify_offline) {
        if (online) addEvent('device_online', 'success', 'Dispositivo online', `${displayName(d)} (${d.ip ?? ''})`, d.id);
        else addEvent('device_offline', 'warning', 'Dispositivo offline', `${displayName(d)} (${d.ip ?? ''})`, d.id);
      }
    }
  })();
}

export function getDevice(id: number) {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
}
