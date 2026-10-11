import { Database } from 'lucide-react';
import { fmtBytes, fmtPct } from '../lib';
import type { DataUsage } from '../types';
import { BarChart } from './charts';
import { Card, CardHead, Empty } from './ui';

const dayLabel = (d: string) => String(Number(d.slice(8, 10)));
const fullDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const date = (ts: number) => new Date(ts * 1000).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

export function UsageCard({ u }: { u: DataUsage }) {
  const pct = u.quota ? u.used / u.quota : null;
  const projPct = u.quota ? u.projected / u.quota : null;
  const tone = projPct === null ? 'var(--s1)' : projPct > 1 ? 'var(--err)' : projPct > 0.85 ? 'var(--warn)' : 'var(--ok)';
  const daysLeft = Math.max(0, Math.ceil((u.end - Date.now() / 1000) / 86400));
  return (
    <Card>
      <CardHead icon={Database} title={u.kind === 'lte' ? 'Consumo dati LTE' : 'Consumo dati WAN'} sub={`Ciclo ${date(u.start)} – ${date(u.end)} · ${daysLeft} giorni rimanenti`}>
        <a className="btn sm" href="#/settings">Piano dati</a>
      </CardHead>
      {u.daily.length === 0 ? <Empty icon={Database}>I contatori appariranno dopo il primo giorno di raccolta</Empty> : (
        <>
          <div className="hstack wrap" style={{ gap: 28, marginBottom: 14, alignItems: 'flex-end' }}>
            <div>
              <div className="big num">{fmtBytes(u.used)}{u.quota && <span className="muted" style={{ fontSize: 16, fontWeight: 500 }}> di {fmtBytes(u.quota, 0)}</span>}</div>
              <div className="kpi-lbl">usati nel ciclo · ↓ {fmtBytes(u.rx)} ↑ {fmtBytes(u.tx)}</div>
            </div>
            <div>
              <div className="kpi-val num" style={{ color: projPct !== null && projPct > 0.85 ? tone : undefined }}>{fmtBytes(u.projected)}</div>
              <div className="kpi-lbl">stima a fine ciclo{projPct !== null ? ` (${fmtPct(projPct)})` : ''}</div>
            </div>
          </div>
          {pct !== null && (
            <div className="bar" style={{ height: 8, marginBottom: 18 }} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${Math.min(100, pct * 100)}%`, background: tone }} />
            </div>
          )}
          <div className="meta" style={{ marginBottom: 6 }}>Ultimi 30 giorni (oggi in corso)</div>
          <BarChart labels={u.daily.map((d) => dayLabel(d.day))} values={u.daily.map((d) => d.rx + d.tx)} format={(v) => fmtBytes(v)}
            tooltipLabel={(i) => fullDay(u.daily[i].day)} highlightLast height={130} />
        </>
      )}
    </Card>
  );
}
