import { Earth, Network, ShieldAlert, ShieldCheck, Waypoints } from 'lucide-react';
import { useState } from 'react';
import { PageHead, type PageProps } from '../App';
import { NetworkFlow } from '../components/NetworkFlow';
import { UpDownBar } from '../components/charts';
import { WorldMap } from '../components/WorldMap';
import { Card, CardHead, DeviceIcon, Empty, RangePicker, Skeleton } from '../components/ui';
import { countryName, flag, fmtBytes, fmtNum, fmtWhen, seriesColor, usePoll } from '../lib';
import type { DeviceWithTraffic, Overview } from '../types';

interface GeoData {
  homeCountry: string;
  watchlist: { countries: string[]; asnKeywords: string[]; minBytes: number };
  countries: Array<{ cc: string | null; up: number; down: number; devices: number; conns: number }>;
  asns: Array<{ asn: number | null; org: string | null; cc: string | null; up: number; down: number; devices: number }>;
  flagged: Array<{ id: number; name: string; kind: string; cc: string | null; asn: number | null; org: string | null; up: number; down: number; conns: number; ips: number; domains: string[]; last: number }>;
  devices: Array<{ id: number; name: string; kind: string; total: number; up: number; countries: Array<{ cc: string; up: number; down: number }> }>;
  geo: { loaded: boolean; built: string | null };
}

export function NetworkMap({ range, setRange }: PageProps) {
  const initialDevice = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('device');
  const [device, setDevice] = useState<string>(initialDevice ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = usePoll<GeoData>(`/api/geo?range=${range}${device ? `&device=${device}` : ''}`, 60_000);
  const { data: devices } = usePoll<DeviceWithTraffic[]>(`/api/devices?range=${range}`, 120_000);
  const { data: ov } = usePoll<Overview>(`/api/overview?range=${range}`, 60_000);

  const countries = (data?.countries ?? []).filter((c) => c.cc);
  const maxC = Math.max(1, ...countries.map((c) => c.up + c.down));
  const shownDevices = (data?.devices ?? []).filter((d) => !selected || d.countries.some((c) => c.cc === selected));
  const maxA = Math.max(1, ...(data?.asns ?? []).map((a) => a.up + a.down));

  return (
    <>
      <PageHead title="Mappa di rete" subtitle="Dove vanno i dati dei tuoi dispositivi: paesi, reti e destinazioni sospette.">
        <select className="select" value={device} onChange={(e) => { setDevice(e.target.value); setSelected(null); }} aria-label="Dispositivo">
          <option value="">Tutti i dispositivi</option>
          {(devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      {!data ? <Skeleton h={500} /> : (
        <div className="stack">
          {!data.geo.loaded && <div className="banner warn"><ShieldAlert />Il database GeoIP non è ancora disponibile (download in corso o rete assente): i paesi appariranno a breve.</div>}
          <div className="grid g-wide">
            <Card>
              <CardHead icon={Earth} title="Traffico per paese" sub={selected ? `Filtro: ${countryName(selected)} — clicca di nuovo per rimuoverlo` : 'Clicca un paese per vedere quali dispositivi lo contattano'}>
                <div className="legend">
                  <span><i style={{ background: 'color-mix(in srgb, #3987e5 30%, #232733)' }} />Poco</span>
                  <span><i style={{ background: '#3987e5' }} />Molto</span>
                  <span><i style={{ background: 'transparent', border: '1.5px solid var(--err)' }} />In watchlist</span>
                </div>
              </CardHead>
              <WorldMap data={countries} home={data.homeCountry} watch={data.watchlist.countries} selected={selected} onSelect={setSelected} />
              <p className="meta" style={{ margin: '8px 0 0' }}>La posizione indica dove si trova il server, non necessariamente l'azienda che lo gestisce: controlla anche la rete (ASN). IP geolocation by <a href="https://db-ip.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>DB-IP</a>.</p>
            </Card>
            <Card>
              <CardHead icon={Network} title="Paesi" sub={`${countries.length} paesi contattati`} />
              {countries.length === 0 ? <Empty>Nessun dato</Empty> : (
                <div className="rows" style={{ maxHeight: 470, overflowY: 'auto', paddingRight: 4 }}>
                  {countries.map((c) => {
                    const watched = data.watchlist.countries.includes(c.cc!);
                    return (
                      <div key={c.cc} className="row-item click" onClick={() => setSelected(selected === c.cc ? null : c.cc)}
                        style={{ gridTemplateColumns: '28px minmax(0,1fr) 90px 76px', background: selected === c.cc ? 'rgba(255,255,255,.06)' : undefined }}>
                        <span style={{ fontSize: 20 }}>{flag(c.cc)}</span>
                        <div className="ellipsis">
                          <div className="name hstack" style={{ gap: 6 }}>{countryName(c.cc)}{watched && <ShieldAlert size={14} color="var(--err)" aria-label="In watchlist" />}</div>
                          <div className="meta">{c.devices} dispositivi · {fmtNum(c.conns)} connessioni</div>
                        </div>
                        <UpDownBar up={c.up} down={c.down} max={maxC} />
                        <div className="num" style={{ textAlign: 'right', fontSize: 13 }}>{fmtBytes(c.up + c.down)}<div className="meta">↑ {fmtBytes(c.up)}</div></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <Card>
            <CardHead icon={data.flagged.length ? ShieldAlert : ShieldCheck} title="Destinazioni in watchlist"
              sub={`Paesi: ${data.watchlist.countries.map(countryName).join(', ') || 'nessuno'} · Reti contenenti: ${data.watchlist.asnKeywords.slice(0, 5).join(', ')}${data.watchlist.asnKeywords.length > 5 ? '…' : ''}`}>
              <a className="btn sm" href="#/settings">Modifica watchlist</a>
            </CardHead>
            {data.flagged.length === 0 ? <Empty icon={ShieldCheck}>Nessun dispositivo ha contattato destinazioni in watchlist nel periodo</Empty> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Dispositivo</th><th>Destinazione</th><th>Domini</th><th className="r">Upload</th><th className="r">Download</th><th className="r">Ultimo</th></tr></thead>
                  <tbody>
                    {data.flagged.map((f, i) => (
                      <tr key={i} className="click" onClick={() => { window.location.hash = `/devices/${f.id}`; }}>
                        <td><div className="hstack"><DeviceIcon kind={f.kind} size="sm" color={seriesColor(f.id)} /><span className="name">{f.name}</span></div></td>
                        <td><div>{flag(f.cc)} {countryName(f.cc)}</div><div className="meta ellipsis" style={{ maxWidth: 280 }}>{f.org ?? '—'}{f.asn ? ` · AS${f.asn}` : ''} · {f.ips} IP</div></td>
                        <td className="meta" style={{ maxWidth: 260 }}>{f.domains.length ? f.domains.join(', ') : <span className="faint">nessun DNS (IP diretto)</span>}</td>
                        <td className="r num" style={{ color: '#ffa3a8', fontWeight: 600 }}>{fmtBytes(f.up)}</td>
                        <td className="r num">{fmtBytes(f.down)}</td>
                        <td className="r meta">{fmtWhen(Math.min(f.last + 3600, Math.floor(Date.now() / 1000)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid g-2">
            <Card>
              <CardHead icon={Waypoints} title="Chi parla con chi" sub={selected ? `Dispositivi che contattano ${countryName(selected)}` : 'Paesi principali per ogni dispositivo'} />
              {shownDevices.length === 0 ? <Empty>Nessun dato</Empty> : (
                <div className="rows">
                  {shownDevices.map((d) => (
                    <a key={d.id} href={`#/devices/${d.id}`} className="row-item" style={{ gridTemplateColumns: '32px minmax(110px, 0.8fr) minmax(0, 2fr)' }}>
                      <DeviceIcon kind={d.kind} size="sm" color={seriesColor(d.id)} />
                      <div className="ellipsis"><div className="name">{d.name}</div><div className="meta">{fmtBytes(d.total)}</div></div>
                      <div className="hstack wrap" style={{ gap: 6 }}>
                        {d.countries.slice(0, 5).map((c) => (
                          <span key={c.cc} className={`pill ${data.watchlist.countries.includes(c.cc) ? 'err' : ''}`} title={`↓ ${fmtBytes(c.down)} · ↑ ${fmtBytes(c.up)}`}>{flag(c.cc)} {c.cc} · {fmtBytes(c.up + c.down, 0)}</span>
                        ))}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </Card>
            <Card>
              <CardHead icon={Network} title="Reti principali (ASN)" sub="Aziende proprietarie degli indirizzi contattati" />
              {(data.asns ?? []).length === 0 ? <Empty>Nessun dato</Empty> : (
                <div className="rows">
                  {data.asns.slice(0, 12).map((a, i) => (
                    <div key={i} className="row-item" style={{ gridTemplateColumns: '28px minmax(0,1fr) 90px 70px' }}>
                      <span style={{ fontSize: 18 }}>{flag(a.cc)}</span>
                      <div className="ellipsis"><div className="name">{a.org ?? 'Sconosciuta'}</div><div className="meta">{a.asn ? `AS${a.asn}` : ''} · {a.devices} dispositivi</div></div>
                      <UpDownBar up={a.up} down={a.down} max={maxA} />
                      <div className="num" style={{ textAlign: 'right', fontSize: 13 }}>{fmtBytes(a.up + a.down)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {ov && ov.devices.length > 0 && !device && (
            <Card>
              <CardHead icon={Waypoints} title="Flusso dispositivi → servizi" sub="Dispositivi con più traffico e servizi più richiesti via DNS" />
              <NetworkFlow devices={ov.devices} services={ov.services.map((s) => ({ base: s.base, queries: s.queries }))} others={ov.map.otherServices} />
            </Card>
          )}
        </div>
      )}
    </>
  );
}
