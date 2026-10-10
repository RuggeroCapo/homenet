import { Monitor, ShieldAlert, Wifi } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHead, type PageProps } from '../App';
import { Sparkline } from '../components/charts';
import { Card, DeviceIcon, Empty, KINDS, RangePicker, Seg, Skeleton, Status } from '../components/ui';
import { countryName, fmtAgo, fmtBytes, fmtNum, seriesColor, usePoll } from '../lib';
import type { DeviceWithTraffic } from '../types';

export function signalTone(s: number | null | undefined): 'ok' | 'warn' | 'err' | 'off' {
  if (s === null || s === undefined) return 'off';
  return s >= -60 ? 'ok' : s >= -72 ? 'warn' : 'err';
}

export function Devices({ range, setRange }: PageProps) {
  const { data } = usePoll<DeviceWithTraffic[]>(`/api/devices?range=${range}`, 30_000);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'flagged'>('all');
  const list = useMemo(() => (data ?? []).filter((d) => {
    if (filter === 'online' && !d.online) return false;
    if (filter === 'flagged' && !d.flagged) return false;
    const t = q.trim().toLowerCase();
    return !t || [d.name, d.ip, d.mac, d.hostname].some((x) => x?.toLowerCase().includes(t));
  }), [data, q, filter]);
  const flaggedCount = (data ?? []).filter((d) => d.flagged).length;

  return (
    <>
      <PageHead title="Dispositivi" subtitle="Tutti i dispositivi visti sulla rete, con traffico e destinazioni.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      <Card>
        <div className="between wrap" style={{ marginBottom: 16 }}>
          <Seg value={filter} onChange={setFilter} options={[['all', `Tutti${data ? ` (${data.length})` : ''}`], ['online', 'Online'], ['flagged', `In watchlist${flaggedCount ? ` (${flaggedCount})` : ''}`]]} />
          <input className="input" placeholder="Filtra per nome, IP o MAC" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        </div>
        {!data ? <Skeleton h={400} /> : list.length === 0 ? <Empty icon={Monitor}>Nessun dispositivo</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dispositivo</th><th>Stato</th><th>Wi-Fi</th><th className="r">Download</th><th className="r">Upload</th>
                  <th style={{ width: 160 }}>Andamento</th><th className="r">Query DNS</th><th>Destinazioni</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="click" onClick={() => { window.location.hash = `/devices/${d.id}`; }}>
                    <td>
                      <div className="hstack">
                        <DeviceIcon kind={d.kind} color={seriesColor(d.id)} />
                        <div style={{ minWidth: 0 }}>
                          <div className="name">{d.name}</div>
                          <div className="meta num">{d.ip}{d.mac ? ` · ${d.mac}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>{d.online ? <Status tone="ok">Online</Status> : <Status tone="off">{fmtAgo(d.lastSeen)}</Status>}</td>
                    <td>{d.wifiSignal !== null ? <Status tone={signalTone(d.wifiSignal)}><Wifi size={14} /> {d.wifiSignal} dBm</Status> : <span className="faint">{d.online ? 'Cavo' : '—'}</span>}</td>
                    <td className="r num">{fmtBytes(d.down)}</td>
                    <td className="r num">{fmtBytes(d.up)}</td>
                    <td><Sparkline values={d.spark} color={seriesColor(d.id)} height={32} label={`Traffico di ${d.name}`} /></td>
                    <td className="r num">{fmtNum(d.queries ?? 0)}{d.blocked ? <div className="meta">{fmtNum(d.blocked)} bloccate</div> : null}</td>
                    <td>
                      {d.flagged ? (
                        <span className="pill err" title="Traffico verso paesi/reti in watchlist"><ShieldAlert />{d.flagged.countries.map(countryName).join(', ') || 'Rete in watchlist'} · {fmtBytes(d.flagged.up)} ↑</span>
                      ) : <span className="meta">{d.countries ? `${d.countries} paesi` : '—'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="meta" style={{ marginTop: 16 }}>Tipi riconosciuti automaticamente dal nome: {Object.values(KINDS).map((k) => k.label).slice(0, 8).join(', ')}… Puoi correggerli nella pagina del dispositivo.</p>
    </>
  );
}
