// Internet reachability (TCP connect latency, no extra privileges needed) + per-minute samples.
import net from 'node:net';
import { db, kvGet, kvSet } from '../db.js';
import { addEvent } from '../events.js';
import { getSettings } from '../settings.js';
import { state } from '../state.js';

export function tcpPing(target: string, timeoutMs = 3000): Promise<number | null> {
  const i = target.lastIndexOf(':');
  const host = target.slice(0, i).replace(/^\[|\]$/g, '');
  const port = Number(target.slice(i + 1)) || 443;
  return new Promise((resolve) => {
    const start = performance.now();
    const sock = net.connect({ host, port });
    const done = (v: number | null) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(performance.now() - start));
    sock.once('timeout', () => done(null));
    sock.once('error', () => done(null));
  });
}

const insSample = db.prepare(`INSERT OR REPLACE INTO samples (ts, online, latency, loss, rx_bps, tx_bps, router_ok, signal)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

export class Probe {
  private timers: NodeJS.Timeout[] = [];
  private latencies: number[] = [];
  private sent = 0;
  private failed = 0;
  private failStreak = 0;

  constructor(private onRound: (online: boolean) => void, private takeThroughput: () => { rx: number | null; tx: number | null }) {
    const saved = kvGet<{ online: boolean; since: number } | null>('internet', null);
    if (saved) Object.assign(state.internet, saved);
  }

  start() {
    void this.round();
    this.timers.push(setInterval(() => void this.round(), 10_000));
    const msToMinute = 60_000 - (Date.now() % 60_000);
    setTimeout(() => {
      this.writeMinute();
      this.timers.push(setInterval(() => this.writeMinute(), 60_000));
    }, msToMinute);
  }

  stop() {
    this.timers.forEach(clearInterval);
  }

  private async round() {
    const targets = getSettings().probeTargets;
    const results = await Promise.all(targets.map((t) => tcpPing(t)));
    const ok = results.filter((r): r is number => r !== null);
    this.sent += results.length;
    this.failed += results.length - ok.length;
    if (ok.length) this.latencies.push(Math.min(...ok));
    state.internet.latency = ok.length ? Math.round(Math.min(...ok)) : null;

    const now = Math.floor(Date.now() / 1000);
    this.failStreak = ok.length ? 0 : this.failStreak + 1;
    if (state.internet.online && this.failStreak >= 3) {
      state.internet.online = false;
      state.internet.since = now - 30;
      addEvent('internet_down', 'error', 'Internet non raggiungibile', state.routerOk ? 'Il router risponde, la connessione esterna no' : 'Anche il router non risponde');
      kvSet('internet', { online: false, since: state.internet.since });
    } else if (!state.internet.online && ok.length) {
      const mins = Math.max(1, Math.round((now - state.internet.since) / 60));
      state.internet.online = true;
      state.internet.since = now;
      addEvent('internet_up', 'success', 'Internet di nuovo online', `Interruzione di ${mins} min`);
      kvSet('internet', { online: true, since: now });
    }
    this.onRound(state.internet.online);
  }

  private writeMinute() {
    const ts = Math.floor(Date.now() / 60_000) * 60 - 60;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const latency = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const loss = this.sent ? this.failed / this.sent : null;
    const thr = this.takeThroughput();
    const m = state.modem;
    const uplink = state.wifi.find((r) => r.mode === 'Client');
    const signal = m || uplink ? JSON.stringify({
      ...(m ? { q: m.quality, rsrp: m.rsrp, rsrq: m.rsrq, sinr: m.sinr, rssi: m.rssi, tech: m.tech } : {}),
      ...(uplink ? { wifi: uplink.signal } : {}),
    }) : null;
    insSample.run(ts, state.internet.online ? 1 : 0, latency, loss, thr.rx, thr.tx, state.routerOk ? 1 : 0, signal);
    this.latencies = [];
    this.sent = 0;
    this.failed = 0;
  }
}
