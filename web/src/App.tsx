import { Activity, Bell, Globe, LayoutDashboard, Monitor, Search as SearchIcon, Settings as SettingsIcon, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ACCESS_CHANGED, LockdownBanner } from './components/Access';
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
  { href: '#/services', match: (r: string) => r.startsWith('/services'), label: 'Servizi', icon: Globe },
  { href: '#/map', match: (r: string) => r.startsWith('/map'), label: 'Mappa', icon: Waypoints },
  { href: '#/monitor', match: (r: string) => r.startsWith('/monitor'), label: 'Monitoraggio', icon: Activity },
  { href: '#/events', match: (r: string) => r.startsWith('/events'), label: 'Eventi', icon: Bell },
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
      {children && <div className="head-tools">{children}</div>}
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ devices: Device[]; services: Array<{ base: string; queries: number }> } | null>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => { setOpen(false); setSheet(false); inputRef.current?.blur(); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSheet(true); requestAnimationFrame(() => inputRef.current?.focus()); }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => { api<typeof res>(`/api/search?q=${encodeURIComponent(q)}`).then(setRes).catch(() => setRes(null)); }, 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const on = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setSheet(false); } };
    document.addEventListener('mousedown', on);
    return () => document.removeEventListener('mousedown', on);
  }, []);
  const go = () => { close(); setQ(''); };
  const empty = res && res.devices.length === 0 && res.services.length === 0;
  return (
    <div className={`search ${sheet ? 'open' : ''}`} ref={boxRef}>
      <button type="button" className="chip-btn search-toggle" aria-label="Cerca" onClick={() => { setSheet(true); requestAnimationFrame(() => inputRef.current?.focus()); }}><SearchIcon /></button>
      <div className="search-field">
        <SearchIcon aria-hidden />
        <input ref={inputRef} className="input" type="search" placeholder="Cerca…" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} aria-label="Cerca dispositivi, domini e servizi" />
        {!q && <kbd>⌘K</kbd>}
      </div>
      {open && res && (
        <div className="search-pop glass">
          {empty && <div className="none">Nessun risultato per «{q}»</div>}
          {res.devices.length > 0 && <div className="lbl">Dispositivi</div>}
          {res.devices.map((d) => (
            <a key={d.id} href={`#/devices/${d.id}`} onClick={go}><DeviceIcon kind={d.kind} size="sm" /><div style={{ minWidth: 0 }}><div className="name">{d.name}</div><div className="meta num">{d.ip}</div></div></a>
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

function useSystem() {
  const { data, reload } = usePoll<Status>('/api/status', 30_000);
  useEffect(() => {
    window.addEventListener(ACCESS_CHANGED, reload);
    return () => window.removeEventListener(ACCESS_CHANGED, reload);
  }, [reload]);
  if (!data) return null;
  const problems = Object.entries(data.collectors).filter(([, c]) => !c.ok);
  const last = Math.max(0, ...Object.values(data.collectors).map((c) => c.lastOk ?? 0));
  const unconfigured = !data.configured.router || !data.configured.adguard;
  const tone = problems.length ? 'err' : unconfigured ? 'warn' : 'ok';
  const label = problems.length ? `${problems.length} ${problems.length === 1 ? 'collettore' : 'collettori'} in errore` : unconfigured ? 'Configurazione incompleta' : 'Sistemi operativi';
  return { data, tone, label, last, reload };
}

function SystemChip({ sys }: { sys: ReturnType<typeof useSystem> }) {
  if (!sys) return null;
  const detail = `${sys.label}${sys.data.demo ? ' · modalità demo' : ''} · aggiornato ${sys.last ? fmtTime(sys.last / 1000) : '—'}`;
  return (
    <a href="#/settings" className="chip-btn sys-chip" title={detail} aria-label={detail}>
      <span className={`dot ${sys.tone}${sys.tone === 'ok' ? ' pulse' : ''}`} />
      <span className="lbl lbl-wide">{sys.label}</span>
      {sys.data.demo && <span className="lbl lbl-wide faint">· demo</span>}
    </a>
  );
}

function useScrolled() {
  useEffect(() => {
    const on = () => document.documentElement.classList.toggle('scrolled', window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
}

export default function App() {
  const route = useHashRoute();
  const [range, setRange] = useStoredState<Range>('homenet.range', '24h');
  const props = { range, setRange };
  const sys = useSystem();
  useScrolled();
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
      <div className="window">
        <header className="appbar">
          <a href="#/" className="brand" aria-label="HomeNet, panoramica"><img src="/favicon.svg" alt="" /><span>HomeNet</span></a>
          <nav className="nav" aria-label="Navigazione principale">
            {NAV.map((n) => {
              const on = n.match(route);
              return (
                <a key={n.href} href={n.href} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined} title={n.label} aria-label={n.label}>
                  <n.icon strokeWidth={1.9} aria-hidden /><span>{n.label}</span>
                </a>
              );
            })}
          </nav>
          <div className="appbar-tools">
            <GlobalSearch />
            <SystemChip sys={sys} />
          </div>
        </header>
        <main className="main" key={route.split('?')[0]}>
          <LockdownBanner st={sys?.data.access} onEnd={() => { void sys?.reload(); window.dispatchEvent(new Event(ACCESS_CHANGED)); }} />
          {page}
        </main>
      </div>
    </UiProvider>
  );
}
