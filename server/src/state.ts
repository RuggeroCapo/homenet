// In-memory runtime state shared between collectors and the API (nothing here is persisted).
import type { ModemStatus, ParsedInfo, WifiRadio } from './router.js';

export interface CollectorStatus { ok: boolean; lastOk?: number; lastError?: string; lastErrorAt?: number }

export const state = {
  router: null as ParsedInfo | null,
  routerOk: false,
  wifi: [] as WifiRadio[],
  modem: null as ModemStatus | null,
  sms: [] as Array<{ index?: number; sender: string; timestamp: string; content: string }>,
  /** live WAN throughput, ~10 s resolution, last hour: [ts, rxBps, txBps] */
  live: [] as Array<[number, number, number]>,
  internet: { online: true, since: Math.floor(Date.now() / 1000), latency: null as number | null, loss: 0 },
  collectors: {} as Record<string, CollectorStatus>,
  conntrackTruncated: 0,
  /** live per-device rate from the last conntrack window (bps) */
  deviceRates: new Map<number, { up: number; down: number; ts: number }>(),
  watchdog: { step: 0, lastAction: null as null | { ts: number; action: string } },
};

export function collectorOk(name: string) {
  state.collectors[name] = { ...state.collectors[name], ok: true, lastOk: Date.now() };
}

export function collectorError(name: string, err: unknown) {
  const msg = err instanceof Error ? (err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message) : String(err);
  state.collectors[name] = { ...state.collectors[name], ok: false, lastError: msg, lastErrorAt: Date.now() };
}

export function collectorDisabled(name: string) {
  delete state.collectors[name];
}
