import { geoCentroid, geoNaturalEarth1, geoPath } from 'd3-geo';
import type * as d3 from 'd3-geo';
import countries from 'i18n-iso-countries';
import { useMemo, useState } from 'react';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import { countryName, fmtBytes } from '../lib';
import { useWidth } from './charts';

interface CountryStat { cc: string | null; up: number; down: number; devices?: number }

const SPHERE = { type: 'Sphere' } as unknown as d3.GeoPermissibleObjects;

type Feat = GeoJSON.Feature<GeoJSON.Geometry, { name: string }> & { cc: string | null };

const FEATURES: Feat[] = (() => {
  const topo = world as unknown as Parameters<typeof feature>[0];
  const fc = feature(topo, (topo as unknown as { objects: { countries: Parameters<typeof feature>[1] } }).objects.countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.Geometry, { name: string }>;
  return fc.features
    .filter((f) => String(f.id) !== '010')
    .map((f) => ({ ...f, cc: countries.numericToAlpha2(String(f.id).padStart(3, '0')) ?? null }));
})();

export function WorldMap({ data, home, watch, selected, onSelect, height: maxH = 440 }: {
  data: CountryStat[]; home: string; watch: string[]; selected?: string | null; onSelect?: (cc: string | null) => void; height?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const height = w ? Math.min(maxH, Math.round(w * 0.52)) : maxH;
  const [hover, setHover] = useState<{ cc: string; x: number; y: number } | null>(null);
  const byCc = useMemo(() => new Map(data.filter((d) => d.cc).map((d) => [d.cc!, d])), [data]);
  const max = Math.max(1, ...data.map((d) => d.up + d.down));

  const { path, projection } = useMemo(() => {
    const projection = geoNaturalEarth1().fitExtent([[8, 8], [Math.max(w, 10) - 8, height - 8]], SPHERE as never);
    return { projection, path: geoPath(projection) };
  }, [w, height]);

  const centroids = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const f of FEATURES) if (f.cc) { const p = projection(geoCentroid(f)); if (p) m.set(f.cc, p as [number, number]); }
    return m;
  }, [projection]);

  const homeP = centroids.get(home);
  const arcs = data.filter((d) => d.cc && d.cc !== home && centroids.has(d.cc)).slice(0, 10);

  const fill = (cc: string | null) => {
    const d = cc ? byCc.get(cc) : undefined;
    if (!d) return 'rgba(255,255,255,0.07)';
    const t = Math.log1p(d.up + d.down) / Math.log1p(max);
    return `color-mix(in srgb, #3987e5 ${Math.round(20 + t * 70)}%, #232733)`;
  };

  const hd = hover ? byCc.get(hover.cc) : undefined;
  return (
    <div ref={ref} className="chart" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="Mappa del traffico per paese" onMouseLeave={() => setHover(null)}>
          <path d={path(SPHERE) ?? ''} fill="rgba(255,255,255,0.015)" stroke="rgba(255,255,255,0.06)" />
          {FEATURES.map((f, i) => {
            const flagged = !!f.cc && watch.includes(f.cc) && byCc.has(f.cc);
            const isSel = selected && f.cc === selected;
            return (
              <path key={i} d={path(f) ?? ''} fill={fill(f.cc)}
                stroke={flagged ? 'var(--err)' : isSel ? '#fff' : 'rgba(21,24,32,0.9)'} strokeWidth={flagged || isSel ? 1.5 : 0.6}
                style={{ cursor: f.cc && byCc.has(f.cc) ? 'pointer' : 'default', transition: 'fill 200ms' }}
                onMouseMove={(e) => {
                  if (!f.cc) return;
                  const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHover({ cc: f.cc, x: e.clientX - r.left, y: e.clientY - r.top });
                }}
                onClick={() => onSelect?.(f.cc && byCc.has(f.cc) ? (selected === f.cc ? null : f.cc) : null)} />
            );
          })}
          {homeP && arcs.map((d) => {
            const p = centroids.get(d.cc!)!;
            const mx = (homeP[0] + p[0]) / 2, my = (homeP[1] + p[1]) / 2 - Math.abs(p[0] - homeP[0]) * 0.25 - 10;
            const flagged = watch.includes(d.cc!);
            const wgt = 1 + 2.5 * (Math.log1p(d.up + d.down) / Math.log1p(max));
            return (
              <g key={d.cc} pointerEvents="none">
                <path d={`M${homeP[0]},${homeP[1]} Q${mx},${my} ${p[0]},${p[1]}`} fill="none" stroke={flagged ? 'var(--err)' : '#9cc3ff'} strokeOpacity={flagged ? 0.9 : 0.55} strokeWidth={wgt} strokeDasharray={flagged ? '5 4' : undefined} />
                <circle cx={p[0]} cy={p[1]} r={4} fill={flagged ? 'var(--err)' : '#9cc3ff'} stroke="var(--bg)" strokeWidth={2} />
              </g>
            );
          })}
          {homeP && (
            <g pointerEvents="none">
              <circle cx={homeP[0]} cy={homeP[1]} r={10} fill="rgba(91,124,255,.25)" />
              <circle cx={homeP[0]} cy={homeP[1]} r={5} fill="#fff" stroke="var(--primary-solid)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hover && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 14, w - 200), top: Math.max(hover.y - 10, 0) }}>
          <div className="t">{countryName(hover.cc)}{watch.includes(hover.cc) ? ' · in watchlist' : ''}</div>
          {hd ? (
            <>
              <div className="v"><i style={{ background: 'var(--down)' }} />Download<span style={{ marginLeft: 'auto', paddingLeft: 12 }}>{fmtBytes(hd.down)}</span></div>
              <div className="v"><i style={{ background: 'var(--up)' }} />Upload<span style={{ marginLeft: 'auto', paddingLeft: 12 }}>{fmtBytes(hd.up)}</span></div>
              {hd.devices !== undefined && <div className="v">Dispositivi<span style={{ marginLeft: 'auto' }}>{hd.devices}</span></div>}
            </>
          ) : <div className="v">Nessun traffico</div>}
        </div>
      )}
    </div>
  );
}
