import { Activity, Globe, LayoutDashboard, Monitor, Search as SearchIcon, Settings as SettingsIcon, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DeviceIcon, LetterAvatar, UiProvider } from './components/ui';
import { api, fmtTime, hashColor, usePoll, useHashRoute, useStoredState, type Range } from './lib';
import { DeviceDetail } from './pages/DeviceDetail';
import { Events } from './pages/Events';
import { Devices } from './pages/Devices';
import { Monitor as MonitorPage } from './pages/Monitor';
import { NetworkMap } from './pages/NetworkMap';
import { Overview } from './pages/Overview';
import { ServiceDetail, Services } from './pages/Services';
import { Settings } from './pages/Settings';
import type { Device, Status } from './types';

const NAV = [
  { href: '#/', match: (r: string) => r === '/', label: 'Panoramica', icon: LayoutDashboard },
  { href: '#/devices', match: (r: string) => r.startsWith('/devices'), label: 'Dispositivi', icon: Monitor },
  { href: '#/services', match: (r: string) => r.startsWith('/services'), label: 'Servizi e Domini', icon: Globe },
  { href: '#/map', match: (r: string) => r.startsWith('/map'), label: 'Mappa di rete', icon: Waypoints },
  { href: '#/monitor', match: (r: string) => r.startsWith('/monitor'), label: 'Monitoraggio', icon: Activity },
  { href: '#/settings', match: (r: string) => r.startsWith('/settings'), label: 'Impostazioni', icon: SettingsIcon },
];

export interface PageProps { range: Range; setRange: (r: Range) => void }

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="head-tools">
        {children}
        <GlobalSearch />
      </div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ devices: Device[]; services: Array<{ base: string; queries: number }> } | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => { api<typeof res>(`/api/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes(null)); }, 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const on = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  const go = () => { setOpen(false); setQ(''); };
  return (
    <div className="search" ref={boxRef}>
      <SearchIcon />
      <input className="input" placeholder="Cerca dispositivo, dominio o servizio…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} aria-label="Cerca" />
      {open && res && (res.devices.length > 0 || res.services.length > 0) && (
        <div className="search-pop glass">
          {res.devices.length > 0 && <div className="lbl">Dispositivi</div>}
          {res.devices.map((d) => (
            <a key={d.id} href={`#/devices/${d.id}`} onClick={go}><DeviceIcon kind={d.kind} size="sm" /><div><div className="name">{d.name}</div><div className="meta">{d.ip}</div></div></a>
          ))}
          {res.services.length > 0 && <div className="lbl">Servizi</div>}
          {res.services.map((s) => (
            <a key={s.base} href={`#/services/${encodeURIComponent(s.base)}`} onClick={go}><LetterAvatar text={s.base} color={hashColor(s.base)} size="sm" /><div className="name">{s.base}</div></a>
          ))}
        </div>
      )}
    </div>
  );
}

function SystemStatus() {
  const { data } = usePoll<Status>('/api/status', 30_000);
  if (!data) return null;
  const problems = Object.entries(data.collectors).filter(([, c]) => !c.ok);
  const last = Math.max(0, ...Object.values(data.collectors).map((c) => c.lastOk ?? 0));
  const unconfigured = !data.configured.router || !data.configured.adguard;
  return (
    <a href="#/settings" className="glass card" style={{ display: 'block', padding: 16, borderRadius: 16, boxShadow: 'none' }}>
      <div className="status" style={{ fontSize: 13 }}>
        <span className={`dot ${problems.length ? 'err' : unconfigured ? 'warn' : 'ok'}`} />
        {problems.length ? `${problems.length} servizi con errori` : unconfigured ? 'Configurazione incompleta' : 'Tutti i sistemi operativi'}
      </div>
      <div className="meta" style={{ marginTop: 10 }}>
        {data.demo ? 'Modalità demo · ' : ''}Ultimo aggiornamento<br />{last ? `oggi, ${fmtTime(last / 1000)}` : '—'}
      </div>
    </a>
  );
}

export default function App() {
  const route = useHashRoute();
  const [range, setRange] = useStoredState<Range>('homenet.range', '24h');
  const props = { range, setRange };
  let page: ReactNode;
  const m = route.match(/^\/devices\/(\d+)/);
  const s = route.match(/^\/services\/(.+)/);
  if (m) page = <DeviceDetail id={Number(m[1])} {...props} />;
  else if (route.startsWith('/devices')) page = <Devices {...props} />;
  else if (s) page = <ServiceDetail base={decodeURIComponent(s[1])} {...props} />;
  else if (route.startsWith('/services')) page = <Services {...props} />;
  else if (route.startsWith('/map')) page = <NetworkMap {...props} />;
  else if (route.startsWith('/monitor')) page = <MonitorPage {...props} />;
  else if (route.startsWith('/settings')) page = <Settings />;
  else if (route.startsWith('/events')) page = <Events />;
  else page = <Overview {...props} />;

  return (
    <UiProvider>
      <div className="shell">
        <aside className="sidebar">
          <a href="#/" className="brand"><img src="/favicon.svg" alt="" /><span>HomeNet</span></a>
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={n.match(route) ? 'active' : ''}><n.icon strokeWidth={1.8} /><span>{n.label}</span></a>
            ))}
          </nav>
          <div className="sidebar-foot"><SystemStatus /></div>
        </aside>
        <main className="main">{page}</main>
      </div>
    </UiProvider>
  );
}
