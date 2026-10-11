import { Activity, Cable, Globe, Clock, Gauge as GaugeIcon, MessageSquare, Power, RefreshCw, RotateCw, Router, ShieldCheck, Signal, Wifi, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { PageHead, type PageProps } from '../App';
import { Gauge, TimeChart } from '../components/charts';
import { Card, CardHead, DeviceIcon, Empty, EventList, RangePicker, Skeleton, Stat, Stats, Status, useUi } from '../components/ui';
import { api, fmtBps, fmtDate, fmtDuration, fmtPct, seriesColor, usePoll } from '../lib';
import type { DataUsage, EventRow, Modem, SamplePoint, Wan, WifiRadio } from '../types';
import { UsageCard } from '../components/UsageCard';
import { signalTone } from './Devices';

interface MonitorData {
  router: { model?: string; hostname?: string; release?: string; uptime?: number; load?: number; memUsed?: number; offload: boolean; acct: boolean } | null;
  routerOk: boolean;
  internet: { online: boolean; since: number; latency: number | null };
  wan: Wan[];
  modem: Modem | null;
  wifi: WifiRadio[];
  sms: Array<{ sender: string; timestamp: string; content: string }>;
  usage: DataUsage;
  series: { bucket: number; points: SamplePoint[] };
  summary: { a: number | null; lat: number | null; loss: number | null; n: number };
  watchdog: { enabled: boolean; downMinutes: number; escalateMinutes: number; firstAction: string; maxRebootsPer6h: number; ha: { enabled: boolean }; state: { step: number; lastAction: { ts: number; action: string } | null } };
  events: EventRow[];
}

type Tone = 'ok' | 'warn' | 'err' | 'off';
const grade = (v: number | undefined, good: number, ok: number, fair: number): [Tone, string] =>
  v === undefined ? ['off', 'n/d'] : v >= good ? ['ok', 'Ottimo'] : v >= ok ? ['ok', 'Buono'] : v >= fair ? ['warn', 'Discreto'] : ['err', 'Scarso'];

function Metric({ label, value, unit, tone, note }: { label: string; value: ReactNode; unit?: string; tone: Tone; note: string }) {
  return (
    <div className="inset" style={{ padding: '12px 14px' }}>
      <div className="kpi-lbl" style={{ marginTop: 0 }}>{label}</div>
      <div className="kpi-val num" style={{ margin: '4px 0' }}>{value ?? '—'} {unit && <span style={{ fontSize: 13, fontWeight: 500 }} className="muted">{unit}</span>}</div>
      <Status tone={tone}>{note}</Status>
    </div>
  );
}

function Actions({ data, reload }: { data: MonitorData; reload: () => void }) {
  const { confirm, toast } = useUi();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (action: string, title: string, body: string, danger = false) => {
    if (!(await confirm({ title, body, confirm: 'Conferma', danger }))) return;
    setBusy(action);
    try { await api(`/api/actions/${action}`, { method: 'POST' }); toast(`${title}: comando inviato`); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); } finally { setBusy(null); reload(); }
  };
  const hasLte = data.wan.some((w) => w.kind === 'lte') || !!data.modem;
  const wd = data.watchdog;
  return (
    <Card>
      <CardHead icon={Zap} title="Azioni di ripristino" sub="Ogni azione chiede conferma e viene registrata negli eventi" />
      <div className="stack" style={{ gap: 10 }}>
        <button className="btn" disabled={!data.routerOk || !!busy} onClick={() => run('restart_wan', 'Riavviare la connessione WAN?', 'Le interfacce WAN verranno riavviate. Internet si interromperà per circa 30 secondi.')}>
          <RefreshCw />Riavvia connessione WAN
        </button>
        {hasLte && (
          <button className="btn" disabled={!data.routerOk || !!busy} onClick={() => run('modem_reset', 'Resettare il modem LTE?', 'Il modem verrà riavviato e si ricollegherà alla rete mobile. Internet si interromperà per 1–2 minuti.')}>
            <Signal />Reset modem LTE
          </button>
        )}
        <button className="btn danger" disabled={!data.routerOk || !!busy} onClick={() => run('reboot', 'Riavviare il router?', 'Tutta la rete (Wi-Fi e cablata) si interromperà per 1–3 minuti, compreso l\'accesso a Umbrel.', true)}>
          <RotateCw />Riavvia router
        </button>
        {wd.ha.enabled && (
          <button className="btn danger" disabled={!!busy} onClick={() => run('power_cycle', 'Spegnere e riaccendere il router?', 'La presa smart collegata al router verrà spenta per 15 secondi tramite Home Assistant. Usalo solo se il router non risponde.', true)}>
            <Power />Spegni/riaccendi (Home Assistant)
          </button>
        )}
      </div>
      <div className="inset" style={{ padding: 14, marginTop: 16 }}>
        <div className="between">
          <div className="hstack" style={{ gap: 8, fontWeight: 550 }}><ShieldCheck size={17} />Watchdog automatico</div>
          <Status tone={wd.enabled ? 'ok' : 'off'}>{wd.enabled ? 'Attivo' : 'Disattivato'}</Status>
        </div>
        <div className="meta" style={{ marginTop: 6 }}>
          {wd.enabled
            ? `Dopo ${wd.downMinutes} min offline: ${wd.firstAction === 'modem_reset' ? 'reset modem' : wd.firstAction === 'none' ? 'nessuna azione' : 'riavvio WAN'}; dopo altri ${wd.escalateMinutes} min: riavvio router (max ${wd.maxRebootsPer6h} ogni 6 ore).`
            : 'Attivalo nelle impostazioni per riavviare automaticamente connessione e router quando internet cade.'}
          {wd.state.lastAction && <> Ultima azione: {fmtDate(wd.state.lastAction.ts)}.</>}
        </div>
        <a className="btn sm" href="#/settings" style={{ marginTop: 10 }}>Configura</a>
      </div>
    </Card>
  );
}

function WifiCard({ radios }: { radios: WifiRadio[] }) {
  return (
    <Card>
      <CardHead icon={Wifi} title="Wi-Fi" sub={`${radios.reduce((a, r) => a + r.clients.length, 0)} client connessi`} />
      {radios.length === 0 ? <Empty icon={Wifi}>Nessuna radio Wi-Fi rilevata</Empty> : (
        <div className="stack" style={{ gap: 16 }}>
          {radios.map((r) => (
            <div key={r.device} className="inset" style={{ padding: 14 }}>
              <div className="between wrap" style={{ marginBottom: r.clients.length ? 8 : 0 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.ssid || r.device} <span className="meta">· {r.band} · canale {r.channel ?? '—'}</span></div>
                  <div className="meta">{r.mode === 'Client' ? 'Connessione Wi-Fi in uscita (WAN)' : 'Access point'}{r.txpower ? ` · ${r.txpower} dBm` : ''}</div>
                </div>
                {r.mode === 'Client' && <Status tone={signalTone(r.signal)}>{r.signal ?? '—'} dBm</Status>}
              </div>
              {r.clients.map((c) => (
                <a key={c.mac} href={c.id ? `#/devices/${c.id}` : undefined} className="row-item" style={{ gridTemplateColumns: '32px minmax(0,1fr) auto auto', padding: '8px 10px' }}>
                  <DeviceIcon kind={c.kind} size="sm" color={c.id ? seriesColor(c.id) : undefined} />
                  <span className="name">{c.name}</span>
                  <span className="meta num">{c.rxRate ? `${Math.round(c.rxRate / 1000)} Mbps` : ''}</span>
                  <Status tone={signalTone(c.signal)}>{c.signal ?? '—'} dBm</Status>
                </a>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Monitor({ range, setRange }: PageProps) {
  const { data, reload } = usePoll<MonitorData>(`/api/monitor?range=${range}`, 15_000);
  if (!data) return <><PageHead title="Monitoraggio"><RangePicker value={range} onChange={setRange} /></PageHead><Skeleton h={500} /></>;
  const pts = data.series.points;
  const times = pts.map((p) => p.t);
  const m = data.modem;
  const [rsrpT, rsrpN] = grade(m?.rsrp, -80, -90, -100);
  const [rsrqT, rsrqN] = grade(m?.rsrq, -10, -15, -20);
  const [sinrT, sinrN] = grade(m?.sinr, 20, 13, 0);
  const [rssiT, rssiN] = grade(m?.rssi, -65, -75, -85);
  const hasSignal = pts.some((p) => p.rsrp !== null);
  const r = data.router;

  return (
    <>
      <PageHead title="Monitoraggio" subtitle="Stato di router, connessione LTE / Wi-Fi e azioni di ripristino.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <div className="stack">
        {r && (!r.acct || r.offload) && (
          <div className="banner warn">
            <Activity />
            <div>{!r.acct ? 'Il conteggio dei byte di conntrack è disattivato sul router: esegui di nuovo lo script di installazione. ' : ''}
              {r.offload ? 'Il flow offloading del firewall è attivo: alcune connessioni potrebbero non aggiornare i contatori e il traffico per dispositivo risultare sottostimato.' : ''}</div>
          </div>
        )}
        <Stats>
          <Stat value={data.internet.online ? 'Online' : 'Offline'} label={`Internet · da ${fmtDate(data.internet.since)}`} icon={Globe} tone={data.internet.online ? undefined : 'err'} />
          <Stat value={fmtPct(data.summary.a, 2)} label="Disponibilità nel periodo" icon={ShieldCheck} />
          <Stat value={data.summary.lat !== null ? Math.round(data.summary.lat) : '—'} unit="ms" label={`Latenza media · ora ${data.internet.latency ?? '—'} ms · loss ${fmtPct(data.summary.loss, 1)}`} icon={GaugeIcon} />
          <Stat value={data.routerOk ? 'OK' : 'Giù'} label={r ? `Router · uptime ${fmtDuration(r.uptime)} · CPU ${r.load?.toFixed(2) ?? '—'} · RAM ${fmtPct(r.memUsed)}` : 'Router non configurato'} icon={Router} tone={data.routerOk ? undefined : 'err'} />
        </Stats>

        <div className="grid g-wide">
          <Card>
            <CardHead icon={Signal} title="Segnale LTE" sub={m ? `${m.operator ?? 'Operatore sconosciuto'} · ${m.tech ?? ''}${m.band ? ` · banda ${m.band}` : ''} · via ${m.method}` : undefined} />
            {!m ? <Empty icon={Signal}>Nessun modem rilevato. Configura MODEM_METHOD in /etc/homenet.conf sul router.</Empty> : (
              <>
                <div className="hstack wrap" style={{ gap: 24, alignItems: 'center' }}>
                  <Gauge value={m.quality} label="Qualità segnale"><div className="kpi-val num">{m.quality ?? '—'}%</div></Gauge>
                  <div className="grid" style={{ flex: 1, minWidth: 'min(320px, 100%)', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))' }}>
                    <Metric label="RSRP (potenza)" value={m.rsrp} unit="dBm" tone={rsrpT} note={rsrpN} />
                    <Metric label="SINR (rumore)" value={m.sinr !== undefined ? Math.round(m.sinr) : undefined} unit="dB" tone={sinrT} note={sinrN} />
                    <Metric label="RSRQ (qualità)" value={m.rsrq} unit="dB" tone={rsrqT} note={rsrqN} />
                    <Metric label="RSSI" value={m.rssi} unit="dBm" tone={rssiT} note={rssiN} />
                  </div>
                </div>
                {hasSignal && (
                  <div className="grid g-2" style={{ marginTop: 20 }}>
                    <div><div className="meta" style={{ marginBottom: 6 }}>RSRP nel tempo (dBm)</div>
                      <TimeChart height={140} times={times} format={(v) => `${Math.round(v)} dBm`} hideZeroBase series={[{ key: 'rsrp', label: 'RSRP', color: 'var(--s1)', values: pts.map((p) => p.rsrp), area: false }]} /></div>
                    <div><div className="meta" style={{ marginBottom: 6 }}>SINR nel tempo (dB)</div>
                      <TimeChart height={140} times={times} format={(v) => `${Math.round(v)} dB`} hideZeroBase series={[{ key: 'sinr', label: 'SINR', color: 'var(--s3)', values: pts.map((p) => p.sinr), area: false }]} /></div>
                  </div>
                )}
              </>
            )}
          </Card>
          <Card>
            <CardHead icon={Cable} title="Connessioni WAN" sub={r?.model ? `${r.model} · ${r.release ?? ''}` : undefined} />
            {data.wan.length === 0 ? <Empty icon={Router}>Router non collegato</Empty> : (
              <div className="rows">
                {data.wan.map((w) => (
                  <div key={w.iface} className="row-item" style={{ gridTemplateColumns: '36px minmax(0,1fr) auto' }}>
                    <span className="avatar sm" style={{ background: 'rgba(255,255,255,.07)' }}>{w.kind === 'wifi' ? <Wifi /> : w.kind === 'lte' ? <Signal /> : <Cable />}</span>
                    <div className="ellipsis">
                      <div className="name">{w.kind === 'lte' ? 'LTE / Mobile' : w.kind === 'wifi' ? 'Wi-Fi (client)' : 'Ethernet'} <span className="meta">· {w.iface}</span></div>
                      <div className="meta num">{w.proto} · {w.device}{w.ipv4 ? ` · ${w.ipv4}` : ''}{w.up && w.uptime ? ` · su da ${fmtDuration(w.uptime)}` : ''}</div>
                    </div>
                    <Status tone={w.up ? (w.isDefault ? 'ok' : 'warn') : 'err'}>{w.up ? (w.isDefault ? 'Attiva' : 'Pronta') : 'Giù'}</Status>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid g-wide">
          <div className="stack">
            <Card>
              <CardHead icon={GaugeIcon} title="Latenza" sub="Tempo di connessione TCP verso 1.1.1.1, 8.8.8.8, 9.9.9.9" />
              <TimeChart height={170} times={times} format={(v) => `${Math.round(v)} ms`} series={[{ key: 'lat', label: 'Latenza', color: 'var(--s3)', values: pts.map((p) => p.latency), area: true }]} />
              <div className="meta" style={{ margin: '16px 0 6px' }}>Disponibilità (le interruzioni appaiono come barre rosse)</div>
              <div style={{ display: 'flex', gap: 1, height: 18 }} role="img" aria-label="Disponibilità nel tempo">
                {pts.map((p) => (
                  <div key={p.t} title={`${fmtDate(p.t)} · ${p.online === null ? 'nessun dato' : fmtPct(p.online, 0)}`}
                    style={{ flex: 1, borderRadius: 2, background: p.online === null ? 'rgba(255,255,255,.06)' : p.online >= 0.999 ? 'rgba(63,207,142,.55)' : p.online > 0.5 ? 'var(--warn)' : 'var(--err)' }} />
                ))}
              </div>
            </Card>
            <Card>
              <CardHead icon={Activity} title="Throughput WAN" sub="Media per intervallo" />
              <TimeChart height={190} times={times} format={fmtBps} series={[
                { key: 'rx', label: 'Download', color: 'var(--down)', values: pts.map((p) => p.rx), area: true },
                { key: 'tx', label: 'Upload', color: 'var(--up)', values: pts.map((p) => p.tx), area: true },
              ]} />
              <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--down)' }} />Download</span><span><i style={{ background: 'var(--up)' }} />Upload</span></div>
            </Card>
            <WifiCard radios={data.wifi} />
          </div>
          <div className="stack">
            <Actions data={data} reload={reload} />
            {data.router && <UsageCard u={data.usage} />}
            <Card>
              <CardHead icon={MessageSquare} title="SMS del router" sub="Letti dal modem tramite sms_tool" />
              {data.sms.length === 0 ? <Empty icon={MessageSquare}>Nessun SMS</Empty> : data.sms.slice(0, 8).map((s, i) => (
                <div key={i} className="inset sms">
                  <div className="between"><b style={{ fontSize: 14 }}>{s.sender}</b><span className="meta">{s.timestamp}</span></div>
                  <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{s.content}</div>
                </div>
              ))}
            </Card>
            <Card>
              <CardHead icon={Clock} title="Eventi di connettività" href="#/events" />
              <EventList events={data.events} compact />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
