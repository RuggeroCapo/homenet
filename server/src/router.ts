/* eslint-disable @typescript-eslint/no-explicit-any */
// Client for the "homenet" rpcd plugin on OpenWrt (ubus over HTTP JSON-RPC) + parsers for its raw output.

export type FlowRow = [proto: string, src: string, sport: number, dst: string, dport: number, dOrig: number, rsrc: string, dReply: number, isNew: number];

export interface RawInfo { plugin?: number; board: any; system: any; ifaces: { interface: any[] } | null; netdev: Record<string, [number, number]>; offload?: string; acct?: string }
export interface RawHosts { leases: [mac: string, ip: string, name: string][]; neigh: [ip: string, mac: string, state: string, dev: string][] }
export type RawWifi = Record<string, { info: any; assoc: { results?: any[] } | null }>;
export interface RawConntrack { seed?: boolean; flows: FlowRow[]; truncated?: number; error?: string }
export interface RawSms { msg?: Array<Record<string, unknown>> }
export type RouterAction = 'reboot' | 'restart_wan' | 'modem_reset';

export interface RouterApi {
  info(): Promise<RawInfo>;
  hosts(): Promise<RawHosts>;
  wifi(): Promise<RawWifi>;
  conntrack(): Promise<RawConntrack>;
  modem(): Promise<any>;
  sms(): Promise<RawSms>;
  action(name: RouterAction, ifaces: string[]): Promise<void>;
}

const NULL_SESSION = '00000000000000000000000000000000';

export class UbusClient implements RouterApi {
  private session = NULL_SESSION;
  private id = 0;

  constructor(private baseUrl: string, private username: string, private password: string) {}

  private async rpc(method: string, params: unknown[], timeoutMs: number): Promise<any> {
    const res = await fetch(this.baseUrl.replace(/\/+$/, '') + '/ubus', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`router HTTP ${res.status}`);
    return res.json();
  }

  private async login() {
    const res = await this.rpc('call', [NULL_SESSION, 'session', 'login', { username: this.username, password: this.password }], 8000);
    const sid = res?.result?.[1]?.ubus_rpc_session;
    if (!sid) throw new Error('router login failed (check user/password and that the HomeNet plugin is installed)');
    this.session = sid;
  }

  async call(object: string, method: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.session === NULL_SESSION) await this.login();
      const res = await this.rpc('call', [this.session, object, method, args], timeoutMs);
      const code = res?.error ? res.error.code : res?.result?.[0];
      // -32002 access denied / 6 permission denied: usually an expired session
      if ((code === -32002 || code === 6) && attempt === 0) { this.session = NULL_SESSION; continue; }
      if (res?.error) throw new Error(`ubus ${object}.${method}: ${res.error.message}`);
      if (code !== 0) throw new Error(`ubus ${object}.${method}: status ${code}${code === 2 || code === 3 ? ' (is the HomeNet plugin installed?)' : ''}`);
      return res.result[1] ?? {};
    }
    throw new Error('router: access denied');
  }

  info() { return this.call('homenet', 'info'); }
  hosts() { return this.call('homenet', 'hosts'); }
  wifi() { return this.call('homenet', 'wifi'); }
  conntrack() { return this.call('homenet', 'conntrack', {}, 20_000); }
  modem() { return this.call('homenet', 'modem', {}, 20_000); }
  sms() { return this.call('homenet', 'sms', {}, 20_000); }
  async action(name: RouterAction, ifaces: string[]) {
    await this.call('homenet', 'action', { name, ifaces: ifaces.join(' ') });
  }
}

// ---------- parsers ----------

export interface WanStatus { iface: string; up: boolean; proto: string; device: string; kind: 'lte' | 'wifi' | 'ethernet'; ipv4?: string; uptime?: number; isDefault: boolean }
export interface ParsedInfo {
  model?: string; hostname?: string; release?: string;
  uptime?: number; load?: number; memUsed?: number;
  wan: WanStatus[];
  lan4: Array<[string, number]>;
  lan6: Array<[string, number]>;
  wanCounters: { rx: number; tx: number };
  offload: boolean; acct: boolean;
}

const LTE_PROTOS = new Set(['qmi', 'ncm', 'mbim', '3g', 'modemmanager', 'directip', 'uqmi', 'wwan']);

function wanKind(i: any): WanStatus['kind'] {
  const dev = String(i.l3_device ?? i.device ?? '');
  if (LTE_PROTOS.has(i.proto) || /lte|4g|5g|mobile|modem|cell/i.test(i.interface) || /^(wwan|usb|cdc)/.test(dev)) return 'lte';
  if (/^(wlan|wl|phy\d+-sta|ra|apcli)/.test(dev)) return 'wifi';
  return 'ethernet';
}

export function parseInfo(raw: RawInfo): ParsedInfo {
  const ifaces: any[] = raw.ifaces?.interface ?? [];
  const isDefault = (i: any) => (i.route ?? []).some((r: any) => (r.target === '0.0.0.0' || r.target === '::') && r.mask === 0);
  const wanIfaces = ifaces.filter((i) => i.interface !== 'loopback' && (isDefault(i) || /^(wan|wwan|lte|modem|mobile|4g|5g)/i.test(i.interface)) && !/_?6$/.test(i.interface) && !/^wan6$/.test(i.interface));
  const wanNames = new Set(wanIfaces.map((i) => i.interface));
  const wan: WanStatus[] = wanIfaces.map((i) => ({
    iface: i.interface,
    up: !!i.up,
    proto: i.proto,
    device: i.l3_device ?? i.device ?? '',
    kind: wanKind(i),
    ipv4: i['ipv4-address']?.[0]?.address,
    uptime: i.uptime,
    isDefault: isDefault(i),
  }));
  const lan4: Array<[string, number]> = [];
  const lan6: Array<[string, number]> = [];
  for (const i of ifaces) {
    if (i.interface === 'loopback' || wanNames.has(i.interface) || /6$/.test(i.interface) && isDefault(i)) continue;
    for (const a of i['ipv4-address'] ?? []) lan4.push([a.address, a.mask]);
    for (const p of i['ipv6-prefix-assignment'] ?? []) lan6.push([p.address, p.mask]);
    for (const a of i['ipv6-address'] ?? []) if (!String(a.address).startsWith('fe80')) lan6.push([a.address, Math.min(a.mask, 64)]);
  }
  let rx = 0, tx = 0;
  const seen = new Set<string>();
  for (const w of wan) {
    if (!w.up || !w.device || seen.has(w.device)) continue;
    seen.add(w.device);
    const c = raw.netdev?.[w.device];
    if (c) { rx += c[0]; tx += c[1]; }
  }
  const mem = raw.system?.memory;
  return {
    model: raw.board?.model, hostname: raw.board?.hostname, release: raw.board?.release?.description,
    uptime: raw.system?.uptime,
    load: raw.system?.load ? raw.system.load[0] / 65536 : undefined,
    memUsed: mem ? 1 - (mem.available ?? mem.free) / mem.total : undefined,
    wan, lan4, lan6,
    wanCounters: { rx, tx },
    offload: raw.offload === '1',
    acct: raw.acct === undefined || raw.acct === '1',
  };
}

export interface ModemStatus {
  method: string;
  tech?: string; operator?: string; band?: string;
  rssi?: number; rsrp?: number; rsrq?: number; sinr?: number;
  quality?: number; registered?: boolean;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

export function signalQuality(m: Pick<ModemStatus, 'rsrp' | 'rssi'>): number | undefined {
  if (m.rsrp !== undefined) return Math.round(Math.max(0, Math.min(100, ((m.rsrp + 120) / 40) * 100)));
  if (m.rssi !== undefined) return Math.round(Math.max(0, Math.min(100, ((m.rssi + 110) / 60) * 100)));
  return undefined;
}

const ACT: Record<string, string> = { '0': '2G', '2': '3G', '3': '2G', '4': '3G', '5': '3G', '6': '3G', '7': 'LTE', '10': 'LTE', '11': '5G', '12': '5G', '13': '5G NSA' };

export function parseModem(raw: any): ModemStatus | null {
  if (!raw || raw.method === 'none' || !raw.method) return null;
  const m: ModemStatus = { method: raw.method };
  if (raw.method === 'uqmi') {
    const s = raw.signal ?? {};
    m.tech = s.type ? String(s.type).toUpperCase() : undefined;
    m.rssi = num(s.rssi); m.rsrp = num(s.rsrp); m.rsrq = num(s.rsrq); m.sinr = num(s.snr ?? s.sinr);
    m.operator = raw.serving?.plmn_description;
    m.registered = raw.serving?.registration === 'registered';
  } else if (raw.method === 'mmcli') {
    const g = raw.modem?.modem?.generic ?? {};
    m.tech = (g['access-technologies'] ?? [])[0]?.toUpperCase();
    m.operator = raw.modem?.modem?.['3gpp']?.['operator-name'];
    m.registered = /registered|home|roaming/.test(raw.modem?.modem?.['3gpp']?.['registration-state'] ?? '');
    const sig = raw.signal?.modem?.signal ?? {};
    const s = sig['5g'] && num(sig['5g'].rsrp) !== undefined ? sig['5g'] : sig.lte ?? {};
    m.rssi = num(s.rssi); m.rsrp = num(s.rsrp); m.rsrq = num(s.rsrq); m.sinr = num(s.snr ?? s.sinr);
    if (m.rsrp === undefined) m.quality = num(g['signal-quality']?.value);
  } else if (raw.method === 'at') {
    const csq = /\+CSQ:\s*(\d+),/.exec(raw.csq ?? '');
    if (csq && csq[1] !== '99') m.rssi = -113 + 2 * Number(csq[1]);
    const cesq = /\+CESQ:\s*\d+,\d+,\d+,\d+,(\d+),(\d+)/.exec(raw.cesq ?? '');
    if (cesq) {
      if (cesq[1] !== '255') m.rsrq = Number(cesq[1]) * 0.5 - 20;
      if (cesq[2] !== '255') m.rsrp = Number(cesq[2]) - 141;
    }
    const cops = /\+COPS:\s*\d+,\d+,"([^"]+)"(?:,(\d+))?/.exec(raw.cops ?? '');
    if (cops) { m.operator = cops[1]; m.registered = true; if (cops[2]) m.tech = ACT[cops[2]]; }
    // Quectel: +QENG: "servingcell","NOCONN","LTE","FDD",mcc,mnc,cellid,pcid,earfcn,band,ul_bw,dl_bw,tac,rsrp,rsrq,rssi,sinr,srxlev
    const qeng = /\+QENG:\s*"servingcell","[^"]*","(LTE|NR5G-SA|NR5G-NSA)"(.*)/.exec(raw.qeng ?? '');
    if (qeng) {
      const f = qeng[2].split(',').map((x) => x.replace(/"/g, ''));
      // f[0] is empty (text after the captured RAT starts with a comma)
      if (qeng[1] === 'LTE' && f.length >= 15) {
        m.tech = 'LTE'; m.band = `B${f[7]}`;
        m.rsrp = num(f[11]); m.rsrq = num(f[12]); m.rssi = num(f[13]);
        const sinr = num(f[14]);
        if (sinr !== undefined) m.sinr = sinr > 40 ? sinr / 5 - 20 : sinr;
      } else if (qeng[1].startsWith('NR5G')) m.tech = '5G';
    }
    const qnw = /\+QNWINFO:\s*"([^"]*)","[^"]*","([^"]*)"/.exec(raw.qnwinfo ?? '');
    if (qnw) { m.band = m.band ?? qnw[2].replace(/^LTE BAND /, 'B'); if (!m.tech && /LTE/.test(qnw[1])) m.tech = 'LTE'; }
    // Huawei: ^HCSQ: "LTE",rssi,rsrp,sinr,rsrq
    const h = /\^HCSQ:\s*"(\w+)",(\d+),(\d+),(\d+),(\d+)/.exec(raw.hcsq ?? '');
    if (h && m.rsrp === undefined) {
      m.tech = m.tech ?? h[1]; m.rssi = -120 + Number(h[2]); m.rsrp = -140 + Number(h[3]);
      m.sinr = -20 + Number(h[4]) * 0.2; m.rsrq = -19.5 + Number(h[5]) * 0.5;
    }
  }
  m.quality = m.quality ?? signalQuality(m);
  return m;
}

export interface WifiRadio {
  device: string; ssid?: string; mode?: string; channel?: number; frequency?: number; band: string;
  signal?: number; noise?: number; bitrate?: number; quality?: number; txpower?: number;
  clients: Array<{ mac: string; signal?: number; noise?: number; rxRate?: number; txRate?: number; inactive?: number }>;
}

export function parseWifi(raw: RawWifi): WifiRadio[] {
  return Object.entries(raw ?? {}).map(([device, { info, assoc }]) => {
    const freq = num(info?.frequency);
    return {
      device,
      ssid: info?.ssid,
      mode: info?.mode,
      channel: num(info?.channel),
      frequency: freq,
      band: freq ? (freq > 5900 ? '6 GHz' : freq > 4900 ? '5 GHz' : '2.4 GHz') : '',
      signal: num(info?.signal),
      noise: num(info?.noise),
      bitrate: num(info?.bitrate),
      txpower: num(info?.txpower),
      quality: info?.quality && info?.quality_max ? Math.round((info.quality / info.quality_max) * 100) : undefined,
      clients: (assoc?.results ?? []).map((c: any) => ({
        mac: String(c.mac).toLowerCase(),
        signal: num(c.signal),
        noise: num(c.noise),
        rxRate: num(c.rx?.rate),
        txRate: num(c.tx?.rate),
        inactive: num(c.inactive),
      })),
    };
  });
}

export function parseSms(raw: RawSms) {
  return (raw?.msg ?? []).map((m) => ({
    index: m.index as number | undefined,
    sender: String(m.sender ?? ''),
    timestamp: String(m.timestamp ?? ''),
    content: String(m.content ?? ''),
  }));
}
