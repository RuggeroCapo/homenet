import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function smoothPath(pts: Array<[number, number]>) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

/** Single-series sparkline; color identifies the entity. */
export function Sparkline({ values, color, height = 44, label }: { values: number[]; color: string; height?: number; label?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const id = useId().replace(/:/g, '');
  const max = Math.max(1, ...values);
  const pts: Array<[number, number]> = values.map((v, i) => [values.length > 1 ? (i / (values.length - 1)) * w : 0, height - 2 - (v / max) * (height - 6)]);
  const line = smoothPath(pts);
  return (
    <div ref={ref} className="chart" style={{ height }} role="img" aria-label={label}>
      {w > 0 && values.length > 1 && (
        <svg width={w} height={height}>
          <defs>
            <linearGradient id={`sg${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.45" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#sg${id})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

export interface Series { key: string; label: string; color: string; values: Array<number | null>; area?: boolean }

/**
 * Time chart with one y-axis, recessive grid, crosshair + tooltip on hover.
 * All series must share the same unit (no dual axes).
 */
export function TimeChart({ times, series, height = 220, format, yMin, yMax, invert, axisFormat, showAxis = true, hideZeroBase }: {
  times: number[]; series: Series[]; height?: number; format: (v: number) => string; axisFormat?: (v: number) => string;
  yMin?: number; yMax?: number; invert?: boolean; showAxis?: boolean; hideZeroBase?: boolean;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, '');
  const padL = showAxis ? 52 : 0, padR = 8, padT = 10, padB = showAxis ? 24 : 4;
  const iw = Math.max(1, w - padL - padR), ih = height - padT - padB;

  const { lo, hi, ticks } = useMemo(() => {
    const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
    let lo = yMin ?? Math.min(0, ...vals);
    let hi = yMax ?? Math.max(...vals, lo + 1);
    if (yMin === undefined && !hideZeroBase && lo > 0) lo = 0;
    if (yMin === undefined && vals.length && hideZeroBase) lo = Math.min(...vals);
    if (hi === lo) hi = lo + 1;
    const span = hi - lo;
    const step = niceStep(span / 4);
    if (yMax === undefined) hi = Math.ceil(hi / step) * step;
    if (yMin === undefined) lo = Math.floor(lo / step) * step;
    const ticks: number[] = [];
    for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t);
    return { lo, hi, ticks };
  }, [series, yMin, yMax, hideZeroBase]);

  const x = (i: number) => padL + (times.length > 1 ? (i / (times.length - 1)) * iw : iw / 2);
  const y = (v: number) => {
    const r = (v - lo) / (hi - lo);
    return padT + (invert ? r : 1 - r) * ih;
  };

  const paths = series.map((s) => {
    const segs: Array<Array<[number, number]>> = [];
    let cur: Array<[number, number]> = [];
    s.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { if (cur.length) segs.push(cur); cur = []; return; }
      cur.push([x(i), y(v)]);
    });
    if (cur.length) segs.push(cur);
    return { s, segs };
  });

  const xTicks = useMemo(() => {
    if (times.length < 2) return [];
    const n = Math.max(2, Math.min(7, Math.floor(iw / 110)));
    const span = times[times.length - 1] - times[0];
    const out: Array<{ i: number; label: string }> = [];
    for (let k = 0; k < n; k++) {
      const i = Math.round((k / (n - 1)) * (times.length - 1));
      const d = new Date(times[i] * 1000);
      out.push({ i, label: span > 2 * 86400 ? d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) });
    }
    return out;
  }, [times, iw]);

  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - r.left - padL;
    const i = Math.round((px / iw) * (times.length - 1));
    setHover(i >= 0 && i < times.length ? i : null);
  };

  const af = axisFormat ?? format;
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
          aria-label={series.map((s) => s.label).join(', ')}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`g${id}${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.35" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {showAxis && ticks.map((t) => (
            <g key={t} className="axis">
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={padL - 10} y={y(t) + 4} textAnchor="end">{af(t)}</text>
            </g>
          ))}
          {showAxis && xTicks.map((t, k) => (
            <text key={k} className="axis" x={x(t.i)} y={height - 4} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'} style={{ fill: 'var(--text-3)', fontSize: 11 }}>{t.label}</text>
          ))}
          {paths.map(({ s, segs }) => segs.map((seg, k) => {
            const d = smoothPath(seg);
            return (
              <g key={s.key + k}>
                {s.area && seg.length > 1 && <path d={`${d} L${seg[seg.length - 1][0]},${padT + ih} L${seg[0][0]},${padT + ih} Z`} fill={`url(#g${id}${s.key})`} />}
                <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          }))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} stroke="rgba(255,255,255,.35)" strokeDasharray="3 3" />
              {series.map((s) => {
                const v = s.values[hover];
                return v === null || v === undefined ? null : <circle key={s.key} cx={x(hover)} cy={y(v)} r={4.5} fill={s.color} stroke="var(--bg)" strokeWidth={2} />;
              })}
            </g>
          )}
          <rect x={padL} y={0} width={iw} height={height} fill="transparent" />
        </svg>
      )}
      {hover !== null && w > 0 && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover) + 12, 0), w - 170), top: 4 }}>
          <div className="t">{new Date(times[hover] * 1000).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          {series.map((s) => (
            <div className="v" key={s.key}><i style={{ background: s.color }} />{s.label}<span style={{ marginLeft: 'auto', paddingLeft: 12 }}>{s.values[hover] === null ? '—' : format(s.values[hover] as number)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Horizontal share bar (magnitude, single hue). */
export function ShareBar({ value, max, color = 'var(--s1)' }: { value: number; max: number; color?: string }) {
  return <div className="bar"><i style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%`, background: color }} /></div>;
}

/** Stacked up/down bar with a 2px surface gap between segments. */
export function UpDownBar({ up, down, max }: { up: number; down: number; max: number }) {
  const tw = max ? ((up + down) / max) * 100 : 0;
  const upShare = up + down ? up / (up + down) : 0;
  return (
    <div className="bar" style={{ background: 'rgba(255,255,255,.06)' }} title={`↓ ${down} · ↑ ${up}`}>
      <div style={{ display: 'flex', width: `${Math.max(tw, 2)}%`, height: '100%', gap: 2 }}>
        <i style={{ flex: 1 - upShare, background: 'var(--down)', borderRadius: 999 }} />
        {upShare > 0.01 && <i style={{ flex: upShare, background: 'var(--up)', borderRadius: 999 }} />}
      </div>
    </div>
  );
}

export function Gauge({ value, label, children }: { value: number | null | undefined; label: string; children?: ReactNode }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const tone = value === null || value === undefined ? 'rgba(255,255,255,.2)' : v >= 60 ? 'var(--ok)' : v >= 35 ? 'var(--warn)' : 'var(--err)';
  const r = 40, c = Math.PI * r;
  return (
    <div style={{ position: 'relative', width: 120, height: 72 }} role="img" aria-label={`${label}: ${value ?? 'n/d'}%`}>
      <svg width={120} height={72} viewBox="0 0 100 60">
        <path d="M10,52 A40,40 0 0 1 90,52" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth={8} strokeLinecap="round" />
        <path d="M10,52 A40,40 0 0 1 90,52" fill="none" stroke={tone} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div style={{ position: 'absolute', inset: '26px 0 0', textAlign: 'center' }}>{children}</div>
    </div>
  );
}

/** Single-series bar chart with per-bar hover tooltip (4px rounded tops, 2px gaps). */
export function BarChart({ labels, values, color = 'var(--s1)', height = 140, format, tooltipLabel, highlightLast }: {
  labels: string[]; values: number[]; color?: string; height?: number; format: (v: number) => string; tooltipLabel?: (i: number) => string; highlightLast?: boolean;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padB = 20, padT = 6;
  const max = Math.max(1, ...values);
  const n = values.length;
  const bw = n ? Math.max(2, w / n - 2) : 0;
  const ih = height - padB - padT;
  return (
    <div ref={ref} className="chart" style={{ height }} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="Grafico a barre">
          <line x1={0} x2={w} y1={padT + ih + 0.5} y2={padT + ih + 0.5} stroke="var(--grid)" />
          {values.map((v, i) => {
            const h = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
            const x = i * (w / n) + 1;
            const last = highlightLast && i === n - 1;
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={x - 1} y={0} width={w / n} height={height} fill="transparent" />
                <path d={roundedTop(x, padT + ih - h, bw, h, Math.min(4, bw / 2, h))} fill={color} opacity={hover === null || hover === i ? (last ? 0.55 : 1) : 0.45} />
              </g>
            );
          })}
          {labels.map((l, i) => (i % Math.ceil(n / Math.max(1, Math.floor(w / 46))) === 0 ? (
            <text key={i} x={i * (w / n) + bw / 2 + 1} y={height - 4} textAnchor="middle" style={{ fill: 'var(--text-3)', fontSize: 11 }}>{l}</text>
          ) : null))}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <div className="tooltip" style={{ left: Math.min(Math.max(hover * (w / n) - 40, 0), w - 150), top: 0 }}>
          <div className="t">{tooltipLabel ? tooltipLabel(hover) : labels[hover]}</div>
          <div className="v"><i style={{ background: color }} />{format(values[hover])}</div>
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Latency as thin columns, one per time bucket; the newest bucket is highlighted. Colour encodes state only. */
export function LatencyBars({ times, values, warnAt = 150, errAt = 400 }: { times: number[]; values: Array<number | null>; warnAt?: number; errAt?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = Math.max(6, Math.min(36, Math.floor(w / 18)));
  const buckets = useMemo(() => {
    if (!values.length) return [];
    const size = Math.max(1, Math.ceil(values.length / n));
    const out: Array<{ t0: number; t1: number; v: number | null }> = [];
    for (let i = 0; i < values.length; i += size) {
      const vs = values.slice(i, i + size).filter((v): v is number => v !== null && Number.isFinite(v));
      out.push({ t0: times[i], t1: times[Math.min(i + size, times.length) - 1], v: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null });
    }
    return out;
  }, [values, times, n]);
  const max = Math.max(100, ...buckets.map((b) => b.v ?? 0));
  const fmtT = (t: number) => new Date(t * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const last = buckets.length - 1;
  return (
    <div ref={ref}>
      <div className="lat" role="img" aria-label={`Latenza nel periodo, ultimo valore ${buckets[last]?.v !== null && buckets[last] ? Math.round(buckets[last].v!) : 'n/d'} ms`}>
        {buckets.map((b, i) => {
          const tone = b.v === null ? 'none' : b.v >= errAt ? 'err' : b.v >= warnAt ? 'warn' : '';
          return (
            <div key={i} className={`lat-col ${i === last ? 'now' : ''}`} title={`${fmtT(b.t0)} · ${b.v === null ? 'nessun dato' : `${Math.round(b.v)} ms`}`}>
              <div className="track">
                <div className={`b ${tone}`} style={{ height: `${b.v === null ? 6 : Math.max(4, Math.sqrt(b.v / max) * 100)}%` }}>
                  {i === last && b.v !== null && <span className="lat-bubble">{Math.round(b.v)} ms</span>}
                </div>
              </div>
              <span className="d" />
            </div>
          );
        })}
      </div>
      {buckets.length > 1 && (
        <div className="lat-scale num">
          <span>{new Date(buckets[0].t0 * 1000).toLocaleString('it-IT', times[times.length - 1] - times[0] > 2 * 86400 ? { day: 'numeric', month: 'short' } : { hour: '2-digit', minute: '2-digit' })}</span>
          <span>ora</span>
        </div>
      )}
    </div>
  );
}

/** Ring gauge for the data plan: outer ticks are the days of the billing cycle, the arc is the share of the quota used. */
export function QuotaRing({ used, quota, projected, start, end, children }: {
  used: number; quota: number | null; projected: number; start: number; end: number; children?: ReactNode;
}) {
  const days = Math.max(1, Math.round((end - start) / 86400));
  const elapsed = Math.min(days, Math.max(0, (Date.now() / 1000 - start) / 86400));
  const a0 = 225, sweep = 270;
  const pt = (r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)];
  };
  const arc = (r: number, from: number, to: number) => {
    const [x0, y0] = pt(r, from), [x1, y1] = pt(r, to);
    return `M${x0},${y0} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1},${y1}`;
  };
  // without a plan, the arc compares usage with the end-of-cycle estimate
  const ref = quota ?? Math.max(projected, used, 1);
  const frac = Math.min(1, used / ref);
  const projFrac = quota ? projected / quota : 0;
  const tone = !quota ? 'var(--accent)' : projFrac > 1 ? 'var(--err)' : projFrac > 0.85 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="ring">
      <svg viewBox="0 0 200 200" role="img" aria-label={quota ? `Usati ${Math.round(frac * 100)}% del piano dati` : 'Consumo dati nel ciclo'}>
        {Array.from({ length: days }, (_, i) => {
          const deg = a0 + (i / Math.max(1, days - 1)) * sweep;
          const [x0, y0] = pt(96, deg), [x1, y1] = pt(88, deg);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={i < elapsed ? 'var(--text-2)' : 'var(--grid)'} strokeWidth={1.6} strokeLinecap="round" />;
        })}
        <path d={arc(74, a0, a0 + sweep)} fill="none" stroke="var(--surface-2)" strokeWidth={12} strokeLinecap="round" />
        {frac > 0 && <path d={arc(74, a0, a0 + Math.max(1, frac * sweep))} fill="none" stroke={quota ? tone : 'var(--text-2)'} strokeWidth={12} strokeLinecap="round" />}
        {quota && projFrac > frac && projFrac <= 1.25 && (() => {
          const [x, y] = pt(74, a0 + Math.min(1, projFrac) * sweep);
          return <circle cx={x} cy={y} r={4} fill="var(--win-solid)" stroke={tone} strokeWidth={2} />;
        })()}
      </svg>
      <div className="ring-c">{children}</div>
    </div>
  );
}

export interface ShareItem { key: string; label: string; value: number; color?: string; href?: string }

/** Segmented share bar: labelled pills sized by share, smallest entries folded into a hatched "Altri" segment. */
export function ShareStrip({ items, total, max: maxWide = 4, format }: { items: ShareItem[]; total: number; max?: number; format: (v: number) => string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const max = w && w < 560 ? 2 : maxWide;
  if (total <= 0) return null;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const shown = sorted.filter((x, i) => i < max && x.value / total >= 0.06);
  const rest = total - shown.reduce((a, x) => a + x.value, 0);
  const segs = [...shown.map((x, i) => ({ ...x, cls: `l${i}` })), ...(rest / total >= 0.02 ? [{ key: '_rest', label: 'Altri', value: rest, cls: 'rest', color: undefined, href: '#/devices' }] : [])];
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  return (
    <div ref={ref} className="share" role="list" aria-label="Ripartizione del traffico">
      {segs.map((s) => {
        const body = (
          <>
            <span className="lbl">{s.color && <i style={{ background: s.color }} />}{s.label}</span>
            <span className="fill">{pct(s.value)}</span>
          </>
        );
        const style = { flex: `${Math.max(s.value / total, 0.07)} 1 0` };
        const title = `${s.label}: ${format(s.value)} (${pct(s.value)})`;
        return s.href
          ? <a key={s.key} role="listitem" href={s.href} className={`share-seg ${s.cls}`} style={style} title={title}>{body}</a>
          : <div key={s.key} role="listitem" className={`share-seg ${s.cls}`} style={style} title={title}>{body}</div>;
      })}
    </div>
  );
}
