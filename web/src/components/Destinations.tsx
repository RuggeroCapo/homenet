import { ArrowDown, ArrowUp, ChevronRight, Download, ExternalLink, Globe, ShieldAlert, Waypoints, X } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { countryName, flag, fmtBytes, fmtDate, fmtNum, usePoll } from '../lib';
import { TimeChart, UpDownBar } from './charts';
import { Card, CardHead, DeviceIcon, Empty, Seg, Skeleton } from './ui';

export interface DestGroup {
  key: string; kind: 'service' | 'network' | 'ip' | 'other'; label: string;
  up: number; down: number; conns: number; ips: number;
  cc: string | null; ccs: number; asn: number | null; org: string | null;
  ports: string[]; base: string | null; ip: string | null; domain: string | null; flagged: boolean;
}

interface DestDetail {
  group: DestGroup;
  series: Array<[number, number, number]>;
  step: number;
  ports: Array<{ proto: number; port: number; up: number; down: number; conns: number }>;
  addresses: Array<{ ip: string; cc: string | null; org: string | null; up: number; down: number; conns: number; domain: string | null }>;
  domains: Array<{ name: string; up: number; down: number }>;
  devices: Array<{ id: number; name: string; kind: string; up: number; down: number }>;
  firstSeen: number | null; lastSeen: number | null;
}

export interface DnsDomain { name: string; base: string; queries: number; blocked: number; category: string }

const PORT_NAME: Record<string, string> = { '443': 'HTTPS', '80': 'HTTP', '53': 'DNS', '853': 'DoT', '123': 'NTP', '1883': 'MQTT', '8883': 'MQTT/TLS', '554': 'RTSP', '3478': 'STUN', '5228': 'Google Push', '5223': 'Apple Push', '22': 'SSH', '993': 'IMAPS', '587': 'SMTP', '51820': 'WireGuard', '1194': 'OpenVPN', '8333': 'Bitcoin', '9735': 'Lightning', '6881': 'BitTorrent' };
const PROTO_NAME: Record<number, string> = { 6: 'TCP', 17: 'UDP', 1: 'ICMP', 58: 'ICMPv6', 132: 'SCTP', 47: 'GRE' };
const portLabel = (p: string) => PORT_NAME[p] ?? p;

/** "15 ott, 17:00–18:00" or "14 ott 22:00 – 15 ott 02:00". */
export function fmtWindow([a, b]: [number, number]) {
  const da = new Date(a * 1000), db = new Date(b * 1000);
  const hm = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const dm = (d: Date) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const sameDay = new Date(b * 1000 - 1).toDateString() === da.toDateString();
  return sameDay ? `${dm(da)}, ${hm(da)}–${hm(db)}` : `${dm(da)} ${hm(da)} – ${dm(db)} ${hm(db)}`;
}

export function WindowChip({ win, onClear }: { win: [number, number]; onClear: () => void }) {
  return (
    <button type="button" className="pill sel" onClick={onClear} title="Togli il filtro orario">
      {fmtWindow(win)}<X aria-label="Togli il filtro" />
    </button>
  );
}

function groupMeta(g: DestGroup) {
  switch (g.kind) {
    case 'service': return `${g.ips === 1 ? '1 indirizzo' : `${fmtNum(g.ips)} indirizzi`}${g.org ? ` · ${g.org}` : ''}`;
    case 'network': return `${g.ips === 1 ? g.ip ?? '1 indirizzo' : `${fmtNum(g.ips)} indirizzi`} senza nome a dominio`;
    case 'other': return 'Molte destinazioni diverse, raggruppate per paese';
    default: return g.domain ? g.ip : null;
  }
}

export function DestinationsCard({ deviceId, range, win, onClearWin, domains }: {
  deviceId: number; range: string; win: [number, number] | null; onClearWin: () => void; domains: DnsDomain[];
}) {
  const [tab, setTab] = useState<'dest' | 'dns'>('dest');
  const [by, setBy] = useState<'service' | 'ip'>('service');
  const [open, setOpen] = useState<string | null>(null);
  const qs = `range=${range}&by=${by}${win ? `&from=${win[0]}&to=${win[1]}` : ''}`;
  const { data } = usePoll<{ groups: DestGroup[] }>(`/api/devices/${deviceId}/destinations?${qs}`, 30_000);
  useEffect(() => setOpen(null), [by, deviceId]);
  const groups = data?.groups ?? null;
  const max = Math.max(1, ...(groups ?? []).map((x) => x.up + x.down));

  return (
    <Card>
      <CardHead icon={tab === 'dest' ? Waypoints : Globe} title={tab === 'dest' ? 'Destinazioni' : 'Domini richiesti (DNS)'}
        sub={tab === 'dest'
          ? (win ? 'Solo il traffico nella fascia oraria scelta sul grafico' : 'Chi ha ricevuto il traffico: apri una riga per vedere quando, su quali porte e con quali indirizzi')
          : 'Query DNS registrate da AdGuard Home'}>
        {tab === 'dest' && win && <WindowChip win={win} onClear={onClearWin} />}
        {tab === 'dest' && <Seg value={by} onChange={setBy} label="Raggruppa" options={[['service', 'Per servizio', 'Raggruppa per dominio o rete'], ['ip', 'Per indirizzo', 'Un indirizzo IP per riga']]} />}
        <Seg value={tab} onChange={setTab} options={[['dest', `Destinazioni${groups ? ` (${groups.length})` : ''}`], ['dns', `Domini (${domains.length})`]]} />
        <a className="btn sm" href={`/api/export/destinations.csv?range=${range}&device=${deviceId}`} download><Download />CSV</a>
      </CardHead>
      {tab === 'dns' ? <DnsTable domains={domains} /> : groups === null ? <Skeleton h={240} /> : groups.length === 0 ? (
        <Empty>{win ? 'Nessuna connessione in questa fascia oraria' : 'Nessuna connessione registrata'}</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl dest">
            <thead><tr><th>Destinazione</th><th>Paese</th><th>Rete (ASN)</th><th>Porte</th><th className="r"><ArrowDown size={12} /> Download</th><th className="r"><ArrowUp size={12} /> Upload</th><th style={{ width: 130 }} /></tr></thead>
            <tbody>
              {groups.map((x) => {
                const isOpen = open === x.key;
                const meta = groupMeta(x);
                return (
                  <Fragment key={x.key}>
                    <tr className={`click ${isOpen ? 'open' : ''}`} onClick={() => setOpen(isOpen ? null : x.key)} aria-expanded={isOpen}>
                      <td>
                        <div className="hstack" style={{ gap: 8 }}>
                          <ChevronRight size={16} className="chev" aria-hidden />
                          {x.flagged && <ShieldAlert size={16} color="var(--err)" aria-label="In watchlist" />}
                          <div style={{ minWidth: 0 }}>
                            <div className="name">{x.label}</div>
                            {meta && <div className="meta ellipsis" style={{ maxWidth: 360 }}>{meta}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{flag(x.cc)} {countryName(x.cc)}{x.ccs > 1 && <span className="faint"> +{x.ccs - 1}</span>}</td>
                      <td className="muted ellipsis" style={{ maxWidth: 240 }} title={x.org ?? ''}>{x.org ?? '—'}{x.asn ? <span className="faint"> · AS{x.asn}</span> : null}</td>
                      <td className="meta">{x.ports.slice(0, 3).map(portLabel).join(', ')}{x.ports.length > 3 && ` +${x.ports.length - 3}`}</td>
                      <td className="r num">{fmtBytes(x.down)}</td>
                      <td className="r num" style={x.flagged ? { color: '#ffa3a8', fontWeight: 600 } : undefined}>{fmtBytes(x.up)}</td>
                      <td><UpDownBar up={x.up} down={x.down} max={max} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="dest-x"><td colSpan={7}><DestPanel deviceId={deviceId} qs={qs} group={x} win={win} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DestPanel({ deviceId, qs, group, win }: { deviceId: number; qs: string; group: DestGroup; win: [number, number] | null }) {
  const { data, error } = usePoll<DestDetail>(`/api/devices/${deviceId}/destinations/detail?${qs}&key=${encodeURIComponent(group.key)}`, 60_000);
  if (error) return <div className="dx"><Empty>{error}</Empty></div>;
  if (!data) return <div className="dx"><Skeleton h={180} /></div>;
  const daily = data.step >= 86400;
  const hidden = group.ips - Math.min(8, data.addresses.length);
  return (
    <div className="dx">
      <div className="dx-main">
        <div className="between" style={{ marginBottom: 8 }}>
          <div className="dx-title">Quando {daily ? '(per giorno)' : '(per ora)'}</div>
          <div className="legend"><span><i style={{ background: 'var(--down)' }} />Download</span><span><i style={{ background: 'var(--up)' }} />Upload</span></div>
        </div>
        <TimeChart height={150} times={data.series.map((p) => p[0])} format={(v) => fmtBytes(v)} selection={win}
          series={[
            { key: 'down', label: 'Download', color: 'var(--down)', values: data.series.map((p) => p[1]), area: true },
            { key: 'up', label: 'Upload', color: 'var(--up)', values: data.series.map((p) => p[2]), area: true },
          ]} />
        <div className="meta" style={{ marginTop: 10 }}>
          {data.firstSeen !== null && data.lastSeen !== null && <div>Contattato la prima volta nell'ora delle {fmtDate(data.firstSeen)}, l'ultima nell'ora delle {fmtDate(data.lastSeen)}.</div>}
          <div>{fmtNum(group.conns)} connessioni aperte {win ? 'nella fascia scelta' : 'nel periodo'}.</div>
        </div>
        {group.base && (
          <a className="btn sm" style={{ marginTop: 14 }} href={`#/services/${encodeURIComponent(group.base)}`}><ExternalLink />Apri il servizio {group.base}</a>
        )}
      </div>
      <div className="dx-side">
        <section>
          <div className="dx-title">Porte e protocolli</div>
          {data.ports.map((p) => (
            <div key={`${p.proto}/${p.port}`} className="dx-row">
              <div className="ellipsis"><span className="name">{portLabel(String(p.port))}</span> <span className="faint">{PROTO_NAME[p.proto] ?? p.proto} {p.port || ''}</span></div>
              <span className="meta num">{fmtNum(p.conns)} conn.</span>
              <span className="num r">{fmtBytes(p.up + p.down)}</span>
            </div>
          ))}
        </section>
        {data.addresses.length > 0 && (
          <section>
            <div className="dx-title">Indirizzi</div>
            {data.addresses.slice(0, 8).map((a) => (
              <div key={a.ip} className="dx-row">
                <div className="ellipsis" title={a.org ?? ''}>{flag(a.cc)} <span className="num">{a.ip.startsWith('*') ? `Altri in ${countryName(a.cc)}` : a.ip}</span>{a.domain && <span className="faint"> · {a.domain}</span>}</div>
                <span className="meta num">{fmtNum(a.conns)} conn.</span>
                <span className="num r">{fmtBytes(a.up + a.down)}</span>
              </div>
            ))}
            {hidden > 0 && <div className="meta" style={{ paddingTop: 6 }}>e altri {fmtNum(hidden)} indirizzi</div>}
          </section>
        )}
        {data.domains.length > 0 && (
          <section>
            <div className="dx-title">Nomi a dominio</div>
            <div className="hstack wrap" style={{ gap: 6 }}>
              {data.domains.map((d) => <span key={d.name} className="pill" title={fmtBytes(d.up + d.down)}>{d.name}</span>)}
            </div>
          </section>
        )}
        <section>
          <div className="dx-title">Altri dispositivi verso {group.kind === 'service' ? 'questo servizio' : group.kind === 'network' ? 'questa rete' : 'questo indirizzo'}</div>
          {data.devices.length === 0 ? <div className="meta">Nessuno: solo questo dispositivo {win ? 'in questa fascia' : 'nel periodo'}.</div> : data.devices.map((d) => (
            <a key={d.id} href={`#/devices/${d.id}`} className="dx-row link">
              <div className="hstack ellipsis" style={{ gap: 8 }}><DeviceIcon kind={d.kind} size="sm" /><span className="name">{d.name}</span></div>
              <span />
              <span className="num r">{fmtBytes(d.up + d.down)}</span>
            </a>
          ))}
        </section>
      </div>
    </div>
  );
}

function DnsTable({ domains }: { domains: DnsDomain[] }) {
  if (domains.length === 0) return <Empty>Nessuna query DNS registrata per questo dispositivo</Empty>;
  return (
    <table className="tbl">
      <thead><tr><th>Dominio</th><th>Categoria</th><th className="r">Query</th><th className="r">Bloccate</th></tr></thead>
      <tbody>
        {domains.map((x) => (
          <tr key={x.name} className="click" onClick={() => { window.location.hash = `/services/${encodeURIComponent(x.base)}`; }}>
            <td className="name">{x.name}</td>
            <td className="muted">{x.category}</td>
            <td className="r num">{fmtNum(x.queries)}</td>
            <td className="r num">{x.blocked ? <span className="pill err">{fmtNum(x.blocked)}</span> : <span className="faint">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
