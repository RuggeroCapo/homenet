export interface Device {
  id: number; name: string; hostname: string | null; alias: string | null; kind: string;
  ip: string | null; mac: string | null; online: boolean; lastSeen: number; firstSeen: number;
  notifyOffline: boolean; wifiSignal: number | null; wifiIface: string | null;
}
export interface DeviceWithTraffic extends Device {
  up: number; down: number; total: number; spark: number[];
  queries?: number; blocked?: number; countries?: number;
  flagged?: { up: number; countries: string[] } | null;
}
export interface EventRow { id: number; ts: number; type: string; severity: 'info' | 'success' | 'warning' | 'error'; title: string; detail: string | null; device_id: number | null }
export interface Wan { iface: string; up: boolean; proto: string; device: string; kind: 'lte' | 'wifi' | 'ethernet'; ipv4?: string; uptime?: number; isDefault: boolean }
export interface Modem { method: string; tech?: string; operator?: string; band?: string; rssi?: number; rsrp?: number; rsrq?: number; sinr?: number; quality?: number; registered?: boolean }
export interface Service { base: string; queries: number; blocked: number; devices: number; category: string; pct: number; up: number; down: number }
export interface WifiRadio {
  device: string; ssid?: string; mode?: string; channel?: number; frequency?: number; band: string; signal?: number; noise?: number; quality?: number; txpower?: number;
  clients: Array<{ mac: string; signal?: number; rxRate?: number; txRate?: number; id: number | null; name: string; kind: string }>;
}

export interface Overview {
  internet: { online: boolean; since: number; latency: number | null; loss: number | null; routerOk: boolean; routerUptime: number | null; availability: number | null };
  configured: { router: boolean; adguard: boolean };
  wan: Wan[];
  modem: Modem | null;
  uplinkWifi: WifiRadio | null;
  traffic: { rx: number | null; tx: number | null; series: Array<[number, number | null, number | null, number | null]>; live: Array<[number, number, number]>; totalDown: number; totalUp: number };
  devices: DeviceWithTraffic[];
  deviceCount: { total: number; online: number };
  dns: { queries: number; blocked: number };
  services: Service[];
  map: { devices: number[]; services: string[]; links: Array<{ device: number; service: string; weight: number }>; otherServices: number };
  geo: { top: Array<{ cc: string; up: number; down: number }>; flaggedDevices: number; flaggedUp: number; homeCountry: string };
  events: EventRow[];
}

export interface SamplePoint { t: number; online: number | null; latency: number | null; loss: number | null; rx: number | null; tx: number | null; rxPeak: number | null; q: number | null; rsrp: number | null; sinr: number | null; rsrq: number | null; wifi: number | null }

export interface Status {
  version: string; demo: boolean; uptime: number; rss: number; dbSize: number; retentionDays: number;
  geo: { loaded: boolean; asn: boolean; built: string | null };
  configured: { router: boolean; adguard: boolean };
  collectors: Record<string, { ok: boolean; lastOk?: number; lastError?: string; lastErrorAt?: number }>;
  routerOk: boolean; conntrackTruncated: number; offload: boolean; acct: boolean;
}

export interface Destination { ip: string; up: number; down: number; conns: number; cc: string | null; asn: number | null; org: string | null; ports: string | null; domain: string | null; base: string | null; flagged: boolean }
