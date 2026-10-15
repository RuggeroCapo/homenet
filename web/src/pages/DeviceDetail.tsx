import { Activity, ArrowDown, ArrowUp, Ban, Bell, ChevronLeft, Clock, Globe, MapPin, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type PageProps } from '../App';
import { ACCESS_CHANGED, AccessCard, accessLabel, LockdownDialog } from '../components/Access';
import { TimeChart, UpDownBar } from '../components/charts';
import { DestinationsCard, WindowChip } from '../components/Destinations';
import { Card, CardHead, DeviceIcon, Empty, EventList, KINDS, RangePicker, Skeleton, Stat, Stats, Status, useUi } from '../components/ui';
import { api, countryName, flag, fmtAgo, fmtBytes, fmtDate, fmtNum, seriesColor, splitUnit, usePoll } from '../lib';
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

export function DeviceDetail({ id, range, setRange }: PageProps & { id: number }) {
  const { data, reload } = usePoll<Detail>(`/api/devices/${id}?range=${range}`, 30_000);
  const { confirm, toast } = useUi();
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState('');
  // hour-aligned window picked on the chart; destinations are stored per hour
  const [win, setWin] = useState<[number, number] | null>(null);
  useEffect(() => setWin(null), [range, id]);
  const [lockdown, setLockdown] = useState(false);
  useEffect(() => {
    const on = () => void reload();
    window.addEventListener(ACCESS_CHANGED, on);
    return () => window.removeEventListener(ACCESS_CHANGED, on);
  }, [reload]);
  useEffect(() => { if (data) setAlias(data.device.alias ?? ''); }, [data?.device.alias]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body: Record<string, unknown>) => {
    try { await api(`/api/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }); await reload(); toast('Salvato'); } catch (e) { toast(String(e), 'err'); }
  };

  if (!data) return <><a href="#/devices" className="back"><ChevronLeft size={16} />Dispositivi</a><Skeleton h={500} /></>;
  const d = data.device;
  const color = seriesColor(d.id);
  const maxCountry = Math.max(1, ...data.countries.map((c) => c.up + c.down));
  const flagged = data.destinations.filter((x) => x.flagged);
  const [down, downU] = splitUnit(fmtBytes(data.totals.down));
  const [up, upU] = splitUnit(fmtBytes(data.totals.up));

  return (
    <>
      <a href="#/devices" className="back"><ChevronLeft size={16} />Dispositivi</a>
      <header className="page-head">
        <div className="hstack" style={{ gap: 16, minWidth: 0, alignItems: 'center' }}>
          <DeviceIcon kind={d.kind} color={color} size="lg" />
          <div style={{ minWidth: 0 }}>
            {editing ? (
              <form className="hstack wrap" style={{ gap: 8, marginBottom: 6 }} onSubmit={(e) => { e.preventDefault(); setEditing(false); void patch({ alias }); }}>
                <input className="input" autoFocus value={alias} placeholder={d.hostname ?? 'Nome'} aria-label="Nome del dispositivo" onChange={(e) => setAlias(e.target.value)} />
                <button className="btn primary sm" type="submit">Salva</button>
                <button className="btn sm" type="button" onClick={() => setEditing(false)}>Annulla</button>
              </form>
            ) : (
              <h1 className="hstack" style={{ gap: 6 }}>
                <span className="ellipsis">{d.name}</span>
                <button className="btn ghost sm icon-btn" onClick={() => setEditing(true)} aria-label="Rinomina" title="Rinomina"><Pencil /></button>
              </h1>
            )}
            <div className="hstack wrap" style={{ gap: '4px 14px' }}>
              {d.online ? <Status tone="ok">Online</Status> : <Status tone="off">Visto {fmtAgo(d.lastSeen)}</Status>}
              {d.access.blocked && <span className="pill err" title={accessLabel(d.access)}><Ban />Senza Internet</span>}
              {d.wifiSignal !== null && <Status tone={signalTone(d.wifiSignal)}>Wi-Fi {d.wifiSignal} dBm</Status>}
              <span className="meta num">{[d.ip, d.mac, d.hostname && d.hostname !== d.name ? d.hostname : null].filter(Boolean).join(' · ')}</span>
              <span className="meta">Visto la prima volta {fmtDate(d.firstSeen)}</span>
            </div>
          </div>
        </div>
        <div className="head-tools">
          <select className="select pill" value={d.kind} onChange={(e) => void patch({ kind: e.target.value })} aria-label="Tipo dispositivo">
            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>
      <Stats>
        <Stat value={down} unit={downU} label="Download" icon={ArrowDown} />
        <Stat value={up} unit={upU} label="Upload" icon={ArrowUp} />
        <Stat value={fmtNum(data.domains.reduce((a, x) => a + x.queries, 0))} label="Query DNS" icon={Globe} />
        <Stat value={data.countries.filter((c) => c.cc).length} label="Paesi contattati" icon={MapPin} />
      </Stats>
      <div className="stack">
        {flagged.length > 0 && (
          <div className="banner warn" style={{ marginBottom: 0 }}>
            <ShieldAlert />
            <div><b>Traffico verso destinazioni in watchlist:</b> {fmtBytes(flagged.reduce((a, x) => a + x.up, 0))} inviati a {flagged.length} indirizzi ({[...new Set(flagged.map((x) => x.org ?? countryName(x.cc)))].slice(0, 3).join(', ')}).</div>
          </div>
        )}
        <div className="grid g-wide">
          <Card>
            <CardHead icon={Activity} title="Traffico nel tempo" sub="Clicca o trascina sul grafico per vedere le destinazioni di quel momento">
              {win ? <WindowChip win={win} onClear={() => setWin(null)} /> : (
                <div className="legend"><span><i style={{ background: 'var(--down)' }} />Download</span><span><i style={{ background: 'var(--up)' }} />Upload</span></div>
              )}
            </CardHead>
            <TimeChart height={220} times={data.series.map((p) => p[0])} format={(v) => fmtBytes(v)} selection={win}
              onSelect={(a, b) => setWin([a - (a % 3600), Math.ceil(b / 3600) * 3600])}
              series={[
                { key: 'down', label: 'Download', color: 'var(--down)', values: data.series.map((p) => p[1]), area: true },
                { key: 'up', label: 'Upload', color: 'var(--up)', values: data.series.map((p) => p[2]), area: true },
              ]} />
          </Card>
          <div className="stack">
            <AccessCard device={d} onChange={reload} onLockdown={() => setLockdown(true)} />
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

        <DestinationsCard deviceId={d.id} range={range} win={win} onClearWin={() => setWin(null)} domains={data.domains} />

        <Card>
          <CardHead icon={Clock} title="Eventi del dispositivo" />
          <EventList events={data.events} />
        </Card>
      </div>
      {lockdown && <LockdownDialog preselect={[d.id]} onClose={(changed) => { setLockdown(false); if (changed) void reload(); }} />}
    </>
  );
}
