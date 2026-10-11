import { ArrowDown, ArrowUp, CircleCheck, Clock, Database, Earth, Gauge, Globe, Monitor, Radar, ShieldAlert, Signal, Waypoints, Wifi, WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { type PageProps } from '../App';
import { NetworkFlow } from '../components/NetworkFlow';
import { LatencyBars, QuotaRing, ShareStrip, Sparkline, TimeChart, UpDownBar } from '../components/charts';
import { Card, CardHead, DeviceIcon, Empty, EventList, LetterAvatar, RangePicker, Seg, Skeleton, Stat, Stats } from '../components/ui';
import { RANGE_LABEL, countryName, flag, fmtBps, fmtBytes, fmtDate, fmtDuration, fmtNum, fmtPct, fmtTime, hashColor, seriesColor, splitUnit, usePoll } from '../lib';
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

/** Live value from the last 10 s poll; right after start-up fall back to the last per-minute average. */
function liveRate(d: OverviewData, i: 1 | 2) {
  return (i === 1 ? d.traffic.rx : d.traffic.tx) ?? [...d.traffic.series].reverse().find((p) => p[i] !== null)?.[i] ?? null;
}

function Header({ d, range, setRange }: { d: OverviewData } & PageProps) {
  const on = d.internet.online;
  const primary = d.wan.find((w) => w.up && w.isDefault) ?? d.wan.find((w) => w.up);
  const [rx, rxU] = splitUnit(fmtBps(liveRate(d, 1)));
  const [tx, txU] = splitUnit(fmtBps(liveRate(d, 2)));
  const via = primary ? [`via ${WAN_LABEL[primary.kind]}`, primary.kind === 'lte' && d.modem ? `${d.modem.operator ?? ''} ${d.modem.quality !== undefined ? `${d.modem.quality}%` : ''}`.trim() : null].filter(Boolean).join(' · ') : null;
  const total = d.traffic.totalDown + d.traffic.totalUp;
  const last = d.traffic.series.at(-1)?.[0];
  return (
    <section className="ov-head" aria-labelledby="ov-title">
      <div className="ov-eyebrow">
        <span className="meta"><span className={`dot ${on ? 'ok pulse' : 'err'}`} />Panoramica · aggiornato {last ? fmtTime(last) : '—'}</span>
        <RangePicker value={range} onChange={setRange} />
      </div>
      <div className="ov-title">
        <h1 id="ov-title">Internet <em className={on ? 'ok' : 'err'}>{on ? 'online' : 'offline'}</em></h1>
        <p>{on ? 'Connesso' : 'Disconnesso'} da {fmtDate(d.internet.since)}{via ? ` · ${via}` : ''}</p>
      </div>
      <Stats>
        <Stat value={rx} unit={rxU} label="Download ora" icon={ArrowDown} />
        <Stat value={tx} unit={txU} label="Upload ora" icon={ArrowUp} />
        <Stat value={d.deviceCount.online} unit={`/ ${d.deviceCount.total}`} label="Dispositivi online" icon={Monitor} />
      </Stats>
      {total > 0 && (
        <div className="ov-share">
          <ShareStrip total={total} format={(v) => fmtBytes(v)}
            items={d.devices.map((x) => ({ key: String(x.id), label: x.name, value: x.total, color: seriesColor(x.id), href: `#/devices/${x.id}` }))} />
        </div>
      )}
    </section>
  );
}

function ConnectionTile({ d }: { d: OverviewData }) {
  const lat = d.internet.latency;
  return (
    <Card className="a-conn">
      <CardHead icon={Gauge} title="Connessione" href="#/monitor" sub="Latenza verso i resolver pubblici" />
      <div className="conn-big">
        <div className="stat-val num" style={{ color: lat !== null && lat >= 400 ? 'var(--err)' : lat !== null && lat >= 150 ? 'var(--warn)' : undefined }}>{lat ?? '—'}</div>
        <span className="muted">ms ora</span>
      </div>
      <LatencyBars times={d.traffic.series.map((p) => p[0])} values={d.traffic.series.map((p) => p[3])} />
      <div className="conn-grid">
        <div><div className="kpi-val num">{fmtPct(d.internet.loss, 1)}</div><div className="kpi-lbl">Packet loss</div></div>
        <div><div className="kpi-val num">{fmtPct(d.internet.availability, 2)}</div><div className="kpi-lbl">Disponibilità</div></div>
        <div><div className="kpi-val num">{fmtDuration(d.internet.routerUptime)}</div><div className="kpi-lbl">Uptime router</div></div>
      </div>
      {d.wan.length > 0 && (
        <div className="hstack wrap" style={{ gap: 6, marginTop: 16 }}>
          {d.wan.map((w) => (
            <span key={w.iface} className={`pill ${w.up ? '' : 'err'}`} title={`Interfaccia ${w.iface}`}>
              {w.kind === 'wifi' ? (w.up ? <Wifi /> : <WifiOff />) : <Signal />}{WAN_LABEL[w.kind]} · {w.up ? (w.isDefault ? 'attiva' : 'pronta') : 'giù'}
            </span>
          ))}
          {d.modem && <a href="#/monitor" className="pill"><Signal />{d.modem.tech ?? 'LTE'} {d.modem.band ?? ''} · {d.modem.rsrp !== undefined ? `${d.modem.rsrp} dBm` : `${d.modem.quality ?? '—'}%`}</a>}
        </div>
      )}
    </Card>
  );
}

function TrafficTile({ d }: { d: OverviewData }) {
  const times = d.traffic.series.map((p) => p[0]);
  return (
    <Card className="a-traf">
      <CardHead icon={ArrowDown} title="Traffico WAN" sub={`${fmtBytes(d.traffic.totalDown)} scaricati · ${fmtBytes(d.traffic.totalUp)} inviati`}>
        <div className="legend"><span><i style={{ background: 'var(--down)' }} />Download</span><span><i style={{ background: 'var(--up)' }} />Upload</span></div>
      </CardHead>
      <TimeChart height={236} times={times} format={fmtBps}
        series={[
          { key: 'rx', label: 'Download', color: 'var(--down)', values: d.traffic.series.map((p) => p[1]), area: true },
          { key: 'tx', label: 'Upload', color: 'var(--up)', values: d.traffic.series.map((p) => p[2]), area: true },
        ]} />
    </Card>
  );
}

interface Attn { key: string; tone: 'warn' | 'err'; icon: typeof ShieldAlert; title: ReactNode; detail: string; href: string; side?: ReactNode }

function AttentionTile({ d }: { d: OverviewData }) {
  const items: Attn[] = [];
  if (!d.internet.online) items.push({ key: 'net', tone: 'err', icon: WifiOff, title: 'Internet non raggiungibile', detail: `Da ${fmtDate(d.internet.since)}`, href: '#/monitor' });
  for (const w of d.wan) if (!w.up) items.push({ key: `wan-${w.iface}`, tone: 'warn', icon: w.kind === 'wifi' ? WifiOff : Signal, title: `WAN ${WAN_LABEL[w.kind]} giù`, detail: `Interfaccia ${w.iface}`, href: '#/monitor' });
  for (const f of d.geo.flagged ?? []) {
    items.push({
      key: `geo-${f.id}`, tone: 'warn', icon: ShieldAlert, href: `#/devices/${f.id}`,
      title: f.name, detail: `Verso ${f.countries.map(countryName).join(', ') || 'reti in watchlist'}`,
      side: <span className="num" style={{ fontWeight: 600, color: 'oklch(0.89 0.1 80)' }}>↑ {fmtBytes(f.up)}</span>,
    });
  }
  if (!d.geo.flagged && d.geo.flaggedDevices > 0) items.push({ key: 'geo', tone: 'warn', icon: ShieldAlert, title: `${d.geo.flaggedDevices} dispositivi in watchlist`, detail: `${fmtBytes(d.geo.flaggedUp)} inviati`, href: '#/map' });
  const u = d.usage;
  if (u.quota && u.projected > u.quota) items.push({ key: 'quota', tone: u.used > u.quota ? 'err' : 'warn', icon: Database, title: 'Piano dati oltre la soglia', detail: `Stima ${fmtBytes(u.projected, 0)} su ${fmtBytes(u.quota, 0)}`, href: '#/monitor' });

  return (
    <Card className="a-alrt attn">
      <CardHead title="Da controllare" sub={items.length ? 'Situazioni attive in questo momento' : undefined}>
        <span className="attn-count" aria-label={`${items.length} elementi`}>{items.length}</span>
      </CardHead>
      {items.length === 0 ? (
        <div className="attn-calm">
          <span className="attn-ico ok"><CircleCheck strokeWidth={2} /></span>
          <div><div style={{ fontWeight: 600 }}>Tutto in ordine</div><div className="meta">Nessuna WAN giù e nessun traffico verso la watchlist nel periodo</div></div>
        </div>
      ) : (
        <div className="attn-list">
          {items.slice(0, 5).map((x) => (
            <a key={x.key} href={x.href} className="attn-item">
              <span className={`attn-ico ${x.tone}`}><x.icon strokeWidth={2} aria-hidden /></span>
              <div style={{ minWidth: 0 }}><div className="name">{x.title}</div><div className="meta ellipsis">{x.detail}</div></div>
              {x.side ?? <span className={`dot ${x.tone}`} aria-hidden />}
            </a>
          ))}
          {items.length > 5 && <a href="#/map" className="meta" style={{ padding: '6px 0 0' }}>e altri {items.length - 5}…</a>}
        </div>
      )}
    </Card>
  );
}

function DevicesTile({ d }: { d: OverviewData }) {
  const [metric, setMetric] = useState<'total' | 'down' | 'up'>('total');
  const list = [...d.devices].sort((a, b) => b[metric] - a[metric]);
  return (
    <Card className="a-devs">
      <CardHead icon={Monitor} title="Dispositivi" href="#/devices" sub={`${d.deviceCount.online} online · ${d.deviceCount.total} visti nel periodo`}>
        <Seg label="Metrica" value={metric} onChange={setMetric} options={[['total', 'Totale'], ['down', '↓', 'Download'], ['up', '↑', 'Upload']]} />
      </CardHead>
      {list.length === 0 ? <Empty icon={Monitor}>Nessun traffico registrato ancora</Empty> : (
        <div className="rows">
          {list.map((x) => (
            <a key={x.id} href={`#/devices/${x.id}`} className="row-item dev-row" style={{ gridTemplateColumns: '40px minmax(0,1.2fr) minmax(64px,auto) minmax(60px,1fr)' }}>
              <DeviceIcon kind={x.kind} color={seriesColor(x.id)} />
              <div style={{ minWidth: 0 }}>
                <div className="name">{x.name}</div>
                <div className="meta num">{x.ip}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontWeight: 600 }}>{fmtBytes(x[metric])}</div>
                {x.rateDown + x.rateUp > 8000 && <div className="meta num">{fmtBps(metric === 'up' ? x.rateUp : metric === 'down' ? x.rateDown : x.rateDown + x.rateUp)}</div>}
              </div>
              <Sparkline values={x.spark} color={seriesColor(x.id)} height={36} label={`Traffico di ${x.name}`} />
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

function QuotaTile({ d }: { d: OverviewData }) {
  const u = d.usage;
  const daysLeft = Math.max(0, Math.ceil((u.end - Date.now() / 1000) / 86400));
  const over = u.quota ? u.projected > u.quota : false;
  const [val, unit] = splitUnit(fmtBytes(u.used));
  return (
    <Card className="a-quot">
      <CardHead title={u.kind === 'lte' ? 'Dati LTE' : 'Dati WAN'} href="#/monitor" sub={`${daysLeft} giorni al rinnovo`} />
      {u.used === 0 && u.daily.length === 0 ? <Empty icon={Database}>Il contatore partirà con il primo giorno di raccolta</Empty> : (
        <>
          <QuotaRing used={u.used} quota={u.quota} projected={u.projected} start={u.start} end={u.end}>
            <div className="stat-val num">{val}<small>{unit}</small></div>
            <div className="meta">{u.quota ? `di ${fmtBytes(u.quota, 0)}` : `di ~${fmtBytes(u.projected, 0)} stimati`}</div>
          </QuotaRing>
          <div className="between" style={{ marginTop: 8 }}>
            <div><div className="kpi-lbl" style={{ marginTop: 0 }}>Stima a fine ciclo</div><div className="num" style={{ fontWeight: 600, color: over ? 'var(--warn)' : undefined }}>{fmtBytes(u.projected, 0)}{over ? ' · oltre il piano' : ''}</div></div>
            <a className="btn sm" href="#/settings">Piano</a>
          </div>
        </>
      )}
    </Card>
  );
}

function ServicesTile({ d }: { d: OverviewData }) {
  const maxPct = Math.max(...d.services.map((x) => x.pct), 0.0001);
  return (
    <Card className="a-srvc">
      <CardHead icon={Globe} title="Servizi più contattati" href="#/services" sub={`${fmtNum(d.dns.queries)} query DNS · ${fmtPct(d.dns.queries ? d.dns.blocked / d.dns.queries : 0, 1)} bloccate`} />
      {d.services.length === 0 ? <Empty>Nessuna query DNS ricevuta da AdGuard</Empty> : (
        <table className="tbl">
          <thead><tr><th>Dominio</th><th className="hide-sm">Categoria</th><th className="r">Query</th><th className="r hide-sm">Traffico</th><th style={{ width: '26%' }}>Quota</th></tr></thead>
          <tbody>
            {d.services.map((s) => (
              <tr key={s.base} className="click" onClick={() => { window.location.hash = `/services/${encodeURIComponent(s.base)}`; }}>
                <td><a href={`#/services/${encodeURIComponent(s.base)}`} className="hstack" style={{ gap: 10, minWidth: 0 }} onClick={(e) => e.stopPropagation()}><LetterAvatar text={s.base} color={hashColor(s.base)} size="sm" /><span className="name">{s.base}</span></a></td>
                <td className="muted hide-sm">{s.category}</td>
                <td className="r num">{fmtNum(s.queries)}</td>
                <td className="r num muted hide-sm">{s.up + s.down ? fmtBytes(s.up + s.down) : '—'}</td>
                <td><div className="hstack" style={{ gap: 10 }}><span className="num meta" style={{ width: 32 }}>{fmtPct(s.pct)}</span><div className="bar" style={{ flex: 1, minWidth: 40 }}><i style={{ width: `${Math.max(3, (s.pct / maxPct) * 100)}%`, background: 'var(--s1)' }} /></div></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CountriesTile({ d }: { d: OverviewData }) {
  const max = Math.max(1, ...d.geo.top.map((g) => g.up + g.down));
  return (
    <Card className="a-ctry">
      <CardHead icon={Earth} title="Dove va il traffico" href="#/map" sub="Paesi dei server contattati" />
      {d.geo.top.length === 0 ? <Empty icon={Earth}>Nessuna destinazione geolocalizzata nel periodo</Empty> : (
        <div className="rows">
          {d.geo.top.map((g) => (
            <a key={g.cc} href="#/map" className="row-item" style={{ gridTemplateColumns: '26px minmax(0,1fr) minmax(56px,0.9fr) auto' }}>
              <span style={{ fontSize: 19 }} aria-hidden>{flag(g.cc)}</span>
              <span className="name">{countryName(g.cc)}{g.cc === d.geo.homeCountry && <span className="meta"> · casa</span>}</span>
              <UpDownBar up={g.up} down={g.down} max={max} />
              <span className="num" style={{ fontSize: 13, textAlign: 'right' }}>{fmtBytes(g.up + g.down)}</span>
            </a>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Overview({ range, setRange }: PageProps) {
  const { data: d, error } = usePoll<OverviewData>(`/api/overview?range=${range}`, 15_000);
  if (!d) {
    return (
      <>
        <div className="ov-head"><div className="ov-title"><h1>Panoramica</h1><p>{error ? `Impossibile caricare i dati: ${error}` : `Caricamento · ${RANGE_LABEL[range]}`}</p></div></div>
        <div className="bento" aria-busy="true">
          {['a-conn', 'a-traf', 'a-alrt', 'a-devs', 'a-quot', 'a-map', 'a-evts', 'a-srvc', 'a-ctry'].map((a) => <div key={a} className={a}><Skeleton h={a === 'a-traf' || a === 'a-conn' ? 330 : 280} /></div>)}
        </div>
      </>
    );
  }
  return (
    <>
      {error && <div className="banner warn"><ShieldAlert />Dati non aggiornati: {error}</div>}
      <SetupBanner configured={d.configured} />
      <Header d={d} range={range} setRange={setRange} />
      <div className="bento">
        <ConnectionTile d={d} />
        <AttentionTile d={d} />
        <TrafficTile d={d} />
        <DevicesTile d={d} />
        <QuotaTile d={d} />
        <Card className="a-map">
          <CardHead icon={Waypoints} title="Mappa di rete" href="#/map" sub="Dispositivi più attivi e servizi più contattati" />
          {d.devices.length ? (
            <NetworkFlow devices={d.devices} services={d.services.map((s) => ({ base: s.base, queries: s.queries }))} others={d.map.otherServices} />
          ) : <Empty icon={Waypoints}>La mappa apparirà quando ci sarà traffico</Empty>}
        </Card>
        <Card className="a-evts">
          <CardHead icon={Clock} title="Attività recente" href="#/events" />
          <EventList events={d.events} compact />
        </Card>
        <ServicesTile d={d} />
        <CountriesTile d={d} />
      </div>
    </>
  );
}
