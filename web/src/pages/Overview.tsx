import { ArrowDown, ArrowRight, ArrowUp, Clock, Globe, Monitor, Radar, ShieldAlert, Signal, Waypoints, Wifi } from 'lucide-react';
import { useState } from 'react';
import { PageHead, type PageProps } from '../App';
import { NetworkFlow } from '../components/NetworkFlow';
import { Sparkline, TimeChart } from '../components/charts';
import { Card, CardHead, DeviceIcon, Empty, EventList, LetterAvatar, RangePicker, Seg, Skeleton } from '../components/ui';
import { countryName, flag, fmtBps, fmtBytes, fmtDate, fmtDuration, fmtNum, fmtPct, hashColor, seriesColor, splitUnit, usePoll } from '../lib';
import type { Overview as OverviewData, Wan } from '../types';

const WAN_LABEL: Record<Wan['kind'], string> = { lte: 'LTE', wifi: 'Wi-Fi', ethernet: 'Ethernet' };

export function SetupBanner({ configured }: { configured: { router: boolean; adguard: boolean } }) {
  if (configured.router && configured.adguard) return null;
  const missing = [!configured.router && 'router OpenWrt', !configured.adguard && 'AdGuard Home'].filter(Boolean).join(' e ');
  return (
    <div className="banner info">
      <Radar />
      <div>Collega {missing} per iniziare a raccogliere i dati. <a href="#/settings" style={{ textDecoration: 'underline' }}>Apri le impostazioni</a></div>
    </div>
  );
}

function InternetCard({ d }: { d: OverviewData }) {
  const on = d.internet.online;
  const lat = d.traffic.series.map((p) => p[3]);
  const primary = d.wan.find((w) => w.up && w.isDefault) ?? d.wan.find((w) => w.up);
  return (
    <Card>
      <div className="hstack" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ width: 76, height: 76, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: 'none', background: on ? 'rgba(63,207,142,.12)' : 'rgba(240,90,98,.12)', color: on ? 'var(--ok)' : 'var(--err)' }}>
          <Globe size={38} strokeWidth={1.6} />
        </div>
        <div style={{ minWidth: 150 }}>
          <div style={{ fontWeight: 600, fontSize: 17 }}>Internet</div>
          <div className="big" style={{ color: on ? 'var(--ok)' : 'var(--err)', margin: '4px 0' }}>{on ? 'Online' : 'Offline'}</div>
          <div className="meta">{on ? 'Da' : 'Offline da'} {fmtDate(d.internet.since)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Sparkline values={lat.map((v) => v ?? 0)} color="var(--s3)" height={60} label="Latenza nel periodo" />
        </div>
      </div>
      <div className="hstack" style={{ marginTop: 20, gap: 0, justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 16 }}>
        {[
          [d.internet.latency !== null ? `${d.internet.latency} ms` : '—', 'Latenza'],
          [fmtPct(d.internet.loss, 1), 'Packet loss'],
          [fmtDuration(d.internet.routerUptime), 'Uptime router'],
          [fmtPct(d.internet.availability, 2), 'Disponibilità'],
        ].map(([v, l], i) => (
          <div key={l} style={{ flex: 1, paddingLeft: i ? 16 : 0, borderLeft: i ? '1px solid var(--border)' : 0, minWidth: 90 }}>
            <div className="kpi-val num" style={i === 0 ? { color: 'var(--s3)' } : undefined}>{v}</div>
            <div className="kpi-lbl">{l}</div>
          </div>
        ))}
      </div>
      {(primary || d.modem) && (
        <div className="hstack wrap" style={{ marginTop: 18, gap: 8 }}>
          {d.wan.map((w) => (
            <span key={w.iface} className={`pill ${w.up ? '' : 'err'}`} title={`Interfaccia ${w.iface}`}>
              {w.kind === 'wifi' ? <Wifi /> : <Signal />}{WAN_LABEL[w.kind]} {w.up ? (w.isDefault ? '· attiva' : '· pronta') : '· giù'}
            </span>
          ))}
          {d.modem && (
            <a href="#/monitor" className="pill">
              <Signal />{d.modem.operator ?? 'LTE'} {d.modem.tech ?? ''} · segnale {d.modem.quality ?? '—'}%{d.modem.rsrp !== undefined ? ` (${d.modem.rsrp} dBm)` : ''}
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

function TrafficCard({ d }: { d: OverviewData }) {
  const [rx, rxU] = splitUnit(fmtBps(d.traffic.rx));
  const [tx, txU] = splitUnit(fmtBps(d.traffic.tx));
  const times = d.traffic.series.map((p) => p[0]);
  return (
    <Card>
      <CardHead title="Traffico totale" sub={`${fmtBytes(d.traffic.totalDown)} scaricati · ${fmtBytes(d.traffic.totalUp)} inviati nel periodo`} />
      <div className="hstack" style={{ gap: 28, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="hstack" style={{ gap: 10 }}>
          <ArrowDown size={26} color="var(--down)" />
          <div><div className="kpi-val num">{rx} <span style={{ fontSize: 15, fontWeight: 550 }}>{rxU}</span></div><div className="kpi-lbl">Download ora</div></div>
        </div>
        <div className="sep" />
        <div className="hstack" style={{ gap: 10 }}>
          <ArrowUp size={26} color="var(--up)" />
          <div><div className="kpi-val num">{tx} <span style={{ fontSize: 15, fontWeight: 550 }}>{txU}</span></div><div className="kpi-lbl">Upload ora</div></div>
        </div>
      </div>
      <TimeChart height={150} times={times} format={fmtBps}
        series={[
          { key: 'rx', label: 'Download', color: 'var(--down)', values: d.traffic.series.map((p) => p[1]), area: true },
          { key: 'tx', label: 'Upload', color: 'var(--up)', values: d.traffic.series.map((p) => p[2]), area: true },
        ]} />
      <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--down)' }} />Download</span><span><i style={{ background: 'var(--up)' }} />Upload</span></div>
    </Card>
  );
}

function DevicesCard({ d }: { d: OverviewData }) {
  const [metric, setMetric] = useState<'total' | 'down' | 'up'>('total');
  const list = [...d.devices].sort((a, b) => b[metric] - a[metric]);
  return (
    <Card>
      <CardHead icon={Monitor} title="Dispositivi" href="#/devices" sub={`${d.deviceCount.online} online · ${d.deviceCount.total} visti nel periodo`}>
        <Seg value={metric} onChange={setMetric} options={[['total', 'Traffico'], ['down', 'Download'], ['up', 'Upload']]} />
      </CardHead>
      {list.length === 0 ? <Empty icon={Monitor}>Nessun traffico registrato ancora</Empty> : (
        <div className="rows">
          {list.map((x) => (
            <a key={x.id} href={`#/devices/${x.id}`} className="row-item" style={{ gridTemplateColumns: '40px minmax(0,1.3fr) 90px minmax(80px,1.4fr)' }}>
              <DeviceIcon kind={x.kind} color={seriesColor(x.id)} />
              <div style={{ minWidth: 0 }}>
                <div className="name">{x.name}</div>
                <div className="meta num">{x.ip}</div>
              </div>
              <div className="num" style={{ fontWeight: 600 }}>{fmtBytes(x[metric])}</div>
              <Sparkline values={x.spark} color={seriesColor(x.id)} height={40} label={`Traffico di ${x.name}`} />
            </a>
          ))}
        </div>
      )}
      <a href="#/devices" className="btn" style={{ width: '100%', justifyContent: 'space-between', marginTop: 12 }}>Vedi tutti i dispositivi <ArrowRight /></a>
    </Card>
  );
}

function ServicesCard({ d }: { d: OverviewData }) {
  return (
    <Card>
      <CardHead icon={Globe} title="Servizi più contattati" href="#/services" sub={`${fmtNum(d.dns.queries)} query DNS · ${fmtPct(d.dns.queries ? d.dns.blocked / d.dns.queries : 0, 1)} bloccate`} />
      {d.services.length === 0 ? <Empty>Nessuna query DNS ricevuta da AdGuard</Empty> : (
        <table className="tbl">
          <thead><tr><th>Dominio</th><th>Categoria</th><th className="r">Query</th><th className="r">Traffico</th><th style={{ width: '24%' }}>%</th></tr></thead>
          <tbody>
            {d.services.map((s) => (
              <tr key={s.base} className="click" onClick={() => { window.location.hash = `/services/${encodeURIComponent(s.base)}`; }}>
                <td><div className="hstack" style={{ gap: 10 }}><LetterAvatar text={s.base} color={hashColor(s.base)} size="sm" /><span className="name">{s.base}</span></div></td>
                <td className="muted">{s.category}</td>
                <td className="r num">{fmtNum(s.queries)}</td>
                <td className="r num muted">{s.up + s.down ? fmtBytes(s.up + s.down) : '—'}</td>
                <td><div className="hstack" style={{ gap: 10 }}><span className="num meta" style={{ width: 34 }}>{fmtPct(s.pct)}</span><div className="bar" style={{ flex: 1 }}><i style={{ width: `${Math.max(3, s.pct * 100 / Math.max(...d.services.map((x) => x.pct)))}%`, background: 'var(--s1)' }} /></div></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function Overview({ range, setRange }: PageProps) {
  const { data: d, error } = usePoll<OverviewData>(`/api/overview?range=${range}`, 15_000);
  return (
    <>
      <PageHead title="Panoramica" subtitle="Stato della tua rete domestica, traffico e attività recenti.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      {error && !d && <div className="banner warn"><ShieldAlert />Impossibile caricare i dati: {error}</div>}
      {!d ? (
        <div className="grid g-main"><Skeleton h={250} /><Skeleton h={250} /><Skeleton h={420} /><Skeleton h={420} /></div>
      ) : (
        <div className="stack">
          <SetupBanner configured={d.configured} />
          {d.geo.flaggedDevices > 0 && (
            <a href="#/map" className="banner warn" style={{ marginBottom: 0 }}>
              <ShieldAlert />
              <div>
                <b>{d.geo.flaggedDevices} {d.geo.flaggedDevices === 1 ? 'dispositivo ha' : 'dispositivi hanno'} inviato {fmtBytes(d.geo.flaggedUp)}</b> verso paesi o reti nella tua watchlist.{' '}
                <span style={{ textDecoration: 'underline' }}>Vedi dettagli sulla mappa</span>
              </div>
            </a>
          )}
          <div className="grid g-main">
            <InternetCard d={d} />
            <TrafficCard d={d} />
          </div>
          <div className="grid g-main">
            <DevicesCard d={d} />
            <Card>
              <CardHead icon={Waypoints} title="Mappa di rete" href="#/map" sub="Dispositivi più attivi e servizi più contattati" />
              {d.devices.length ? (
                <NetworkFlow devices={d.devices} services={d.services.map((s) => ({ base: s.base, queries: s.queries }))} others={d.map.otherServices} />
              ) : <Empty icon={Waypoints}>La mappa apparirà quando ci sarà traffico</Empty>}
              {d.geo.top.length > 0 && (
                <div className="hstack wrap" style={{ marginTop: 18, gap: 8 }}>
                  <span className="meta">Paesi principali:</span>
                  {d.geo.top.map((g) => <span key={g.cc} className="pill">{flag(g.cc)} {countryName(g.cc)} · {fmtBytes(g.up + g.down)}</span>)}
                </div>
              )}
            </Card>
          </div>
          <div className="grid g-wide">
            <ServicesCard d={d} />
            <Card>
              <CardHead icon={Clock} title="Attività recente" />
              <EventList events={d.events} compact />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
