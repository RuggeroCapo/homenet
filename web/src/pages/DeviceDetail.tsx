import { ArrowDown, ArrowUp, Bell, ChevronLeft, Clock, Globe, MapPin, Pencil, ShieldAlert, Trash2, Waypoints } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHead, type PageProps } from '../App';
import { TimeChart, UpDownBar } from '../components/charts';
import { Card, CardHead, DeviceIcon, Empty, EventList, KINDS, Kpi, RangePicker, Seg, Skeleton, Status, useUi } from '../components/ui';
import { api, countryName, flag, fmtAgo, fmtBytes, fmtDate, fmtNum, seriesColor, usePoll } from '../lib';
import type { Destination, Device, EventRow } from '../types';
import { signalTone } from './Devices';

interface Detail {
  device: Device;
  totals: { up: number; down: number };
  series: Array<[number, number, number]>;
  destinations: Destination[];
  countries: Array<{ cc: string | null; up: number; down: number; ips: number }>;
  domains: Array<{ name: string; base: string; queries: number; blocked: number; category: string }>;
  events: EventRow[];
}

const PROTO_PORT: Record<string, string> = { '443': 'HTTPS', '80': 'HTTP', '53': 'DNS', '853': 'DoT', '123': 'NTP', '1883': 'MQTT', '8883': 'MQTT/TLS', '554': 'RTSP', '3478': 'STUN', '5228': 'Google Push', '5223': 'Apple Push' };

export function DeviceDetail({ id, range, setRange }: PageProps & { id: number }) {
  const { data, reload } = usePoll<Detail>(`/api/devices/${id}?range=${range}`, 30_000);
  const { confirm, toast } = useUi();
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');
  const [tab, setTab] = useState<'dest' | 'dns'>('dest');
  useEffect(() => { if (data) setAlias(data.device.alias ?? ''); }, [data?.device.alias]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body: Record<string, unknown>) => {
    try { await api(`/api/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await reload(); toast('Salvato'); } catch (e) { toast(String(e), 'err'); }
  };

  if (!data) return <><a href="#/devices" className="back"><ChevronLeft size={16} />Dispositivi</a><Skeleton h={500} /></>;
  const d = data.device;
  const color = seriesColor(d.id);
  const maxCountry = Math.max(1, ...data.countries.map((c) => c.up + c.down));
  const flagged = data.destinations.filter((x) => x.flagged);
  const maxDest = Math.max(1, ...data.destinations.map((x) => x.up + x.down));

  return (
    <>
      <a href="#/devices" className="back"><ChevronLeft size={16} />Dispositivi</a>
      <PageHead title={d.name} subtitle={<span className="num">{[d.ip, d.mac, d.hostname && d.hostname !== d.name ? d.hostname : null].filter(Boolean).join(' · ')}</span>}>
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <div className="stack">
        {flagged.length > 0 && (
          <div className="banner warn" style={{ marginBottom: 0 }}>
            <ShieldAlert />
            <div><b>Traffico verso destinazioni in watchlist:</b> {fmtBytes(flagged.reduce((a, x) => a + x.up, 0))} inviati a {flagged.length} indirizzi ({[...new Set(flagged.map((x) => x.org ?? countryName(x.cc)))].slice(0, 3).join(', ')}).</div>
          </div>
        )}
        <div className="grid g-wide">
          <Card>
            <div className="hstack" style={{ gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <DeviceIcon kind={d.kind} color={color} />
              <div style={{ flex: 1, minWidth: 200 }}>
                {editing ? (
                  <form className="hstack" onSubmit={(e) => { e.preventDefault(); setEditing(false); void patch({ alias }); }}>
                    <input className="input" autoFocus value={alias} placeholder={d.hostname ?? 'Nome'} onChange={(e) => setAlias(e.target.value)} />
                    <button className="btn primary sm" type="submit">Salva</button>
                    <button className="btn sm" type="button" onClick={() => setEditing(false)}>Annulla</button>
                  </form>
                ) : (
                  <div className="hstack" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 18 }}>{d.name}</span>
                    <button className="btn ghost sm icon-btn" onClick={() => setEditing(true)} aria-label="Rinomina"><Pencil /></button>
                  </div>
                )}
                <div className="hstack wrap" style={{ gap: 12, marginTop: 6 }}>
                  {d.online ? <Status tone="ok">Online</Status> : <Status tone="off">Visto {fmtAgo(d.lastSeen)}</Status>}
                  {d.wifiSignal !== null && <Status tone={signalTone(d.wifiSignal)}>Wi-Fi {d.wifiSignal} dBm</Status>}
                  <span className="meta">Primo avvistamento {fmtDate(d.firstSeen)}</span>
                </div>
              </div>
              <select className="select" value={d.kind} onChange={(e) => void patch({ kind: e.target.value })} aria-label="Tipo dispositivo">
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="grid g-4" style={{ marginBottom: 20 }}>
              <Kpi value={fmtBytes(data.totals.down)} label="Download" accent="var(--down)" />
              <Kpi value={fmtBytes(data.totals.up)} label="Upload" accent="var(--up)" />
              <Kpi value={fmtNum(data.domains.reduce((a, x) => a + x.queries, 0))} label="Query DNS" />
              <Kpi value={data.countries.filter((c) => c.cc).length} label="Paesi contattati" />
            </div>
            <TimeChart height={200} times={data.series.map((p) => p[0])} format={(v) => fmtBytes(v)}
              series={[
                { key: 'down', label: 'Download', color: 'var(--down)', values: data.series.map((p) => p[1]), area: true },
                { key: 'up', label: 'Upload', color: 'var(--up)', values: data.series.map((p) => p[2]), area: true },
              ]} />
            <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--down)' }} />Download</span><span><i style={{ background: 'var(--up)' }} />Upload</span><span className="faint">per intervallo</span></div>
          </Card>
          <div className="stack">
            <Card>
              <CardHead icon={MapPin} title="Dove va il traffico" href={`#/map?device=${d.id}`} />
              {data.countries.length === 0 ? <Empty>Nessun traffico registrato</Empty> : (
                <div className="rows">
                  {data.countries.slice(0, 8).map((c) => (
                    <div key={c.cc ?? 'xx'} className="row-item" style={{ gridTemplateColumns: '28px minmax(0,1fr) 120px 80px' }}>
                      <span style={{ fontSize: 20 }}>{flag(c.cc)}</span>
                      <div className="ellipsis"><div className="name">{countryName(c.cc)}</div><div className="meta">{c.ips} indirizzi</div></div>
                      <UpDownBar up={c.up} down={c.down} max={maxCountry} />
                      <div className="num r" style={{ textAlign: 'right', fontSize: 13 }}>{fmtBytes(c.up + c.down)}<div className="meta">↑ {fmtBytes(c.up)}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <CardHead icon={Bell} title="Notifiche" />
              <div className="between">
                <div><div style={{ fontWeight: 550 }}>Avvisami se va offline</div><div className="meta">Crea un evento quando il dispositivo si disconnette o torna online</div></div>
                <button className={`switch ${d.notifyOffline ? 'on' : ''}`} role="switch" aria-checked={d.notifyOffline} onClick={() => void patch({ notifyOffline: !d.notifyOffline })} />
              </div>
              <button className="btn danger sm" style={{ marginTop: 20 }} onClick={async () => {
                if (await confirm({ title: 'Eliminare il dispositivo?', body: 'Verranno cancellati anche lo storico di traffico e DNS. Se il dispositivo è ancora in rete ricomparirà come nuovo.', confirm: 'Elimina', danger: true })) {
                  await api(`/api/devices/${id}`, { method: 'DELETE' });
                  window.location.hash = '/devices';
                }
              }}><Trash2 />Elimina dispositivo</button>
            </Card>
          </div>
        </div>

        <Card>
          <CardHead icon={tab === 'dest' ? Waypoints : Globe} title={tab === 'dest' ? 'Destinazioni' : 'Domini richiesti (DNS)'}
            sub={tab === 'dest' ? 'Indirizzi IP contattati, con paese, rete proprietaria e dominio risolto' : 'Query DNS registrate da AdGuard Home'}>
            <Seg value={tab} onChange={setTab} options={[['dest', `Destinazioni (${data.destinations.length})`], ['dns', `Domini (${data.domains.length})`]]} />
          </CardHead>
          {tab === 'dest' ? (data.destinations.length === 0 ? <Empty>Nessuna connessione registrata</Empty> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>Destinazione</th><th>Paese</th><th>Rete (ASN)</th><th>Porte</th><th className="r"><ArrowDown size={12} /> Download</th><th className="r"><ArrowUp size={12} /> Upload</th><th style={{ width: 130 }} /></tr></thead>
                <tbody>
                  {data.destinations.map((x) => (
                    <tr key={x.ip}>
                      <td>
                        <div className="hstack" style={{ gap: 8 }}>
                          {x.flagged && <ShieldAlert size={16} color="var(--err)" aria-label="In watchlist" />}
                          <div style={{ minWidth: 0 }}>
                            <div className="name">{x.domain ?? (x.ip.startsWith('*') ? 'Altri indirizzi' : x.ip)}</div>
                            {x.domain && <div className="meta num">{x.ip}</div>}
                            {x.ip.startsWith('*') && <div className="meta">Molte destinazioni diverse, raggruppate per paese</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{flag(x.cc)} {countryName(x.cc)}</td>
                      <td className="muted ellipsis" style={{ maxWidth: 240 }} title={x.org ?? ''}>{x.org ?? '—'}{x.asn ? <span className="faint"> · AS{x.asn}</span> : null}</td>
                      <td className="meta">{(x.ports ?? '').split(',').slice(0, 3).map((p) => PROTO_PORT[p] ?? p).join(', ')}</td>
                      <td className="r num">{fmtBytes(x.down)}</td>
                      <td className="r num" style={x.flagged ? { color: '#ffa3a8', fontWeight: 600 } : undefined}>{fmtBytes(x.up)}</td>
                      <td><UpDownBar up={x.up} down={x.down} max={maxDest} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : (data.domains.length === 0 ? <Empty>Nessuna query DNS registrata per questo dispositivo</Empty> : (
            <table className="tbl">
              <thead><tr><th>Dominio</th><th>Categoria</th><th className="r">Query</th><th className="r">Bloccate</th></tr></thead>
              <tbody>
                {data.domains.map((x) => (
                  <tr key={x.name} className="click" onClick={() => { window.location.hash = `/services/${encodeURIComponent(x.base)}`; }}>
                    <td className="name">{x.name}</td>
                    <td className="muted">{x.category}</td>
                    <td className="r num">{fmtNum(x.queries)}</td>
                    <td className="r num">{x.blocked ? <span className="pill err">{fmtNum(x.blocked)}</span> : <span className="faint">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </Card>

        <Card>
          <CardHead icon={Clock} title="Eventi del dispositivo" />
          <EventList events={data.events} />
        </Card>
      </div>
    </>
  );
}
