import { Globe, Router as RouterIcon } from 'lucide-react';
import { fmtBytes, fmtNum, hashColor, seriesColor } from '../lib';
import type { DeviceWithTraffic } from '../types';
import { useWidth } from './charts';
import { DeviceIcon, LetterAvatar } from './ui';

export interface FlowService { base: string; queries: number }

/** Devices → router → internet → services, drawn as a flow map. */
export function NetworkFlow({ devices, services, others, routerLabel }: { devices: DeviceWithTraffic[]; services: FlowService[]; others: number; routerLabel?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const rowH = 64;
  const rightItems = services.length + (others > 0 ? 1 : 0);
  const n = Math.max(devices.length, rightItems, 3);
  const height = n * rowH;
  const nodeW = Math.min(190, Math.max(140, w * 0.24));
  const rX = w / 2 - 20, rY = height / 2;
  const gX = rX + 78;
  const sx = w - nodeW;
  const yAt = (i: number, count: number) => (height - count * rowH) / 2 + i * rowH + rowH / 2;
  const maxBytes = Math.max(1, ...devices.map((d) => d.total));
  const maxQ = Math.max(1, ...services.map((s) => s.queries));
  const compact = w < 440;

  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {w > 0 && !compact && (
        <>
          <svg width={w} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
            {devices.map((d, i) => {
              const y = yAt(i, devices.length);
              const x0 = nodeW + 4;
              const cx = (x0 + rX - 34) / 2;
              return (
                <g key={d.id}>
                  <path d={`M${x0},${y} C${cx},${y} ${cx},${rY} ${rX - 34},${rY}`} fill="none" stroke={seriesColor(d.id)} strokeOpacity={0.85} strokeWidth={1.2 + 2.6 * (d.total / maxBytes)} />
                  <circle cx={x0} cy={y} r={3.5} fill={seriesColor(d.id)} />
                </g>
              );
            })}
            <line x1={rX + 34} x2={gX - 16} y1={rY} y2={rY} stroke="rgba(156,195,255,.6)" strokeDasharray="3 4" strokeWidth={1.5} />
            {[...services, ...(others > 0 ? [{ base: '', queries: 0 }] : [])].map((s, i) => {
              const y = yAt(i, rightItems);
              const x1 = sx - 4;
              const cx = (gX + 16 + x1) / 2;
              return (
                <g key={s.base || 'others'}>
                  <path d={`M${gX + 16},${rY} C${cx},${rY} ${cx},${y} ${x1},${y}`} fill="none" stroke={s.base ? hashColor(s.base) : 'rgba(255,255,255,.35)'} strokeOpacity={0.7}
                    strokeWidth={s.base ? 1 + 2 * (s.queries / maxQ) : 1} strokeDasharray="4 4" />
                  <circle cx={x1} cy={y} r={3.5} fill={s.base ? hashColor(s.base) : 'rgba(255,255,255,.5)'} />
                </g>
              );
            })}
          </svg>
          <div style={{ position: 'absolute', left: rX - 34, top: rY - 34, width: 68, textAlign: 'center' }}>
            <div style={{ width: 68, height: 68, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle, rgba(91,124,255,.35), rgba(91,124,255,.08))', border: '1.5px solid rgba(124,140,255,.7)', boxShadow: '0 0 30px rgba(91,124,255,.35)' }}>
              <RouterIcon size={28} strokeWidth={1.8} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>Router</div>
            {routerLabel && <div className="meta" style={{ whiteSpace: 'nowrap', marginLeft: -30, marginRight: -30 }}>{routerLabel}</div>}
          </div>
          <div style={{ position: 'absolute', left: gX - 16, top: rY - 16, width: 32, height: 32, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.08)', border: '1px solid var(--border)' }} title="Internet">
            <Globe size={17} strokeWidth={1.8} />
          </div>
        </>
      )}
      {w > 0 && devices.map((d, i) => (
        <a key={d.id} href={`#/devices/${d.id}`} className="inset hstack" style={{ position: 'absolute', left: 0, top: yAt(i, devices.length) - 26, width: compact ? '48%' : nodeW, height: 52, padding: '0 10px', gap: 10 }}>
          <DeviceIcon kind={d.kind} size="sm" color={seriesColor(d.id)} />
          <div style={{ minWidth: 0 }}>
            <div className="name" style={{ fontSize: 13 }}>{d.name}</div>
            <div className="meta num">{fmtBytes(d.total)}</div>
          </div>
        </a>
      ))}
      {w > 0 && services.map((s, i) => (
        <a key={s.base} href={`#/services/${encodeURIComponent(s.base)}`} className="inset hstack" style={{ position: 'absolute', right: 0, top: yAt(i, rightItems) - 26, width: compact ? '48%' : nodeW, height: 52, padding: '0 10px', gap: 10 }}>
          <LetterAvatar text={s.base} color={hashColor(s.base)} size="sm" />
          <div style={{ minWidth: 0 }}>
            <div className="name" style={{ fontSize: 13 }}>{s.base}</div>
            <div className="meta num">{fmtNum(s.queries)} query</div>
          </div>
        </a>
      ))}
      {w > 0 && others > 0 && (
        <a href="#/services" className="inset hstack" style={{ position: 'absolute', right: 0, top: yAt(services.length, rightItems) - 26, width: compact ? '48%' : nodeW, height: 52, padding: '0 10px', gap: 10 }}>
          <span className="avatar sm" style={{ background: 'rgba(255,255,255,.07)' }}>···</span>
          <div style={{ minWidth: 0 }}>
            <div className="name" style={{ fontSize: 13 }}>Altri {others} servizi</div>
            <div className="meta">Visualizza tutti</div>
          </div>
        </a>
      )}
    </div>
  );
}
