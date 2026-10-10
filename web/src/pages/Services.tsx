import { ChevronLeft, Globe, Monitor, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHead, type PageProps } from '../App';
import { ShareBar } from '../components/charts';
import { Card, CardHead, DeviceIcon, Empty, LetterAvatar, RangePicker, Skeleton } from '../components/ui';
import { countryName, flag, fmtBytes, fmtNum, fmtPct, hashColor, seriesColor, usePoll } from '../lib';
import type { Service } from '../types';
import { SetupBanner } from './Overview';

export function Services({ range, setRange }: PageProps) {
  const { data } = usePoll<Service[]>(`/api/services?range=${range}`, 60_000);
  const { data: status } = usePoll<{ configured: { router: boolean; adguard: boolean } }>('/api/status', 60_000);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useMemo(() => [...new Set((data ?? []).map((s) => s.category))].sort(), [data]);
  const list = (data ?? []).filter((s) => (!q || s.base.includes(q.toLowerCase())) && (!cat || s.category === cat));
  const maxQ = Math.max(1, ...list.map((s) => s.queries));
  const totalBlocked = (data ?? []).reduce((a, s) => a + s.blocked, 0);
  const total = (data ?? []).reduce((a, s) => a + s.queries, 0);

  return (
    <>
      <PageHead title="Servizi e Domini" subtitle="Domini richiesti dai dispositivi (AdGuard Home) e traffico associato.">
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      {status && <SetupBanner configured={status.configured} />}
      <div className="grid g-3" style={{ marginBottom: 20 }}>
        <Card><div className="kpi-lbl">Query DNS</div><div className="big num" style={{ marginTop: 6 }}>{fmtNum(total)}</div></Card>
        <Card><div className="kpi-lbl">Bloccate da AdGuard</div><div className="big num" style={{ marginTop: 6 }}>{fmtNum(totalBlocked)} <span className="muted" style={{ fontSize: 16 }}>{fmtPct(total ? totalBlocked / total : 0, 1)}</span></div></Card>
        <Card><div className="kpi-lbl">Servizi distinti</div><div className="big num" style={{ marginTop: 6 }}>{fmtNum(data?.length ?? 0)}</div></Card>
      </div>
      <Card>
        <div className="between wrap" style={{ marginBottom: 16 }}>
          <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            <option value="">Tutte le categorie</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="input" placeholder="Filtra dominio" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        </div>
        {!data ? <Skeleton h={400} /> : list.length === 0 ? <Empty icon={Globe}>Nessun dominio</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Dominio</th><th>Categoria</th><th className="r">Query</th><th className="r">Bloccate</th><th className="r">Dispositivi</th><th className="r">Traffico</th><th style={{ width: '18%' }}>Quota query</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.base} className="click" onClick={() => { window.location.hash = `/services/${encodeURIComponent(s.base)}`; }}>
                    <td><div className="hstack" style={{ gap: 10 }}><LetterAvatar text={s.base} color={hashColor(s.base)} size="sm" /><span className="name">{s.base}</span></div></td>
                    <td className="muted">{s.category}</td>
                    <td className="r num">{fmtNum(s.queries)}</td>
                    <td className="r num">{s.blocked ? <span className="pill err">{fmtNum(s.blocked)}</span> : <span className="faint">—</span>}</td>
                    <td className="r num">{s.devices}</td>
                    <td className="r num muted">{s.up + s.down ? fmtBytes(s.up + s.down) : '—'}</td>
                    <td><div className="hstack" style={{ gap: 10 }}><span className="meta num" style={{ width: 38 }}>{fmtPct(s.pct, 1)}</span><div style={{ flex: 1 }}><ShareBar value={s.queries} max={maxQ} /></div></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

interface ServiceDetailData {
  base: string; category: string;
  devices: Array<{ id: number; name: string; kind: string; queries: number; blocked: number }>;
  subdomains: Array<{ name: string; queries: number; blocked: number }>;
  ips: Array<{ ip: string; cc: string | null; org: string | null; up: number; down: number }>;
}

export function ServiceDetail({ base, range, setRange }: PageProps & { base: string }) {
  const { data } = usePoll<ServiceDetailData>(`/api/services/${encodeURIComponent(base)}?range=${range}`, 60_000);
  return (
    <>
      <a href="#/services" className="back"><ChevronLeft size={16} />Servizi e Domini</a>
      <PageHead title={base} subtitle={data?.category}>
        <RangePicker value={range} onChange={setRange} />
      </PageHead>
      {!data ? <Skeleton h={400} /> : (
        <div className="grid g-2">
          <Card>
            <CardHead icon={Monitor} title="Dispositivi che lo usano" />
            {data.devices.length === 0 ? <Empty>Nessun dispositivo</Empty> : (
              <div className="rows">
                {data.devices.map((d) => (
                  <a key={d.id} href={`#/devices/${d.id}`} className="row-item" style={{ gridTemplateColumns: '40px 1fr auto' }}>
                    <DeviceIcon kind={d.kind} color={seriesColor(d.id)} />
                    <span className="name">{d.name}</span>
                    <span className="num">{fmtNum(d.queries)} query{d.blocked ? <span className="meta"> · {fmtNum(d.blocked)} bloccate</span> : null}</span>
                  </a>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHead icon={Globe} title="Sottodomini" />
            {data.subdomains.length === 0 ? <Empty>Nessun dato</Empty> : (
              <table className="tbl">
                <thead><tr><th>Nome</th><th className="r">Query</th><th className="r">Bloccate</th></tr></thead>
                <tbody>{data.subdomains.map((s) => <tr key={s.name}><td className="name">{s.name}</td><td className="r num">{fmtNum(s.queries)}</td><td className="r num">{s.blocked ? <span className="pill err">{fmtNum(s.blocked)}</span> : '—'}</td></tr>)}</tbody>
              </table>
            )}
          </Card>
          <Card className="span-2">
            <CardHead icon={Server} title="Server contattati" sub="Indirizzi IP associati al dominio tramite le risposte DNS" />
            {data.ips.length === 0 ? <Empty>Nessun traffico associato (il router non è collegato o il dominio non ha generato connessioni)</Empty> : (
              <table className="tbl">
                <thead><tr><th>IP</th><th>Paese</th><th>Rete</th><th className="r">Download</th><th className="r">Upload</th></tr></thead>
                <tbody>{data.ips.map((x) => <tr key={x.ip}><td className="num">{x.ip}</td><td>{flag(x.cc)} {countryName(x.cc)}</td><td className="muted">{x.org ?? '—'}</td><td className="r num">{fmtBytes(x.down)}</td><td className="r num">{fmtBytes(x.up)}</td></tr>)}</tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
