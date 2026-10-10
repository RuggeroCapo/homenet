import {
  Ban, Cable, Cctv, CircleCheck, CircleHelp, Cpu, Gamepad2, House, Info, Laptop, Monitor, Plus, Power, Printer,
  Router, Server, ShieldAlert, Smartphone, Speaker, Tablet, TriangleAlert, Tv, WifiOff, type LucideIcon,
} from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { RANGE_LABEL, fmtWhen, type Range } from '../lib';
import type { EventRow } from '../types';

export const KINDS: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  laptop: { icon: Laptop, label: 'Laptop', color: 'var(--s1)' },
  desktop: { icon: Monitor, label: 'Computer', color: 'var(--s1)' },
  phone: { icon: Smartphone, label: 'Smartphone', color: 'var(--s7)' },
  tablet: { icon: Tablet, label: 'Tablet', color: 'var(--s7)' },
  tv: { icon: Tv, label: 'TV / Streaming', color: 'var(--s5)' },
  console: { icon: Gamepad2, label: 'Console', color: 'var(--s3)' },
  homeassistant: { icon: House, label: 'Home Assistant', color: 'var(--s4)' },
  camera: { icon: Cctv, label: 'Telecamera', color: 'var(--s8)' },
  speaker: { icon: Speaker, label: 'Speaker / Hub', color: 'var(--s2)' },
  server: { icon: Server, label: 'Server / NAS', color: 'var(--s3)' },
  printer: { icon: Printer, label: 'Stampante', color: 'var(--s2)' },
  iot: { icon: Cpu, label: 'Smart home / IoT', color: 'var(--s4)' },
  router: { icon: Router, label: 'Rete', color: 'var(--s1)' },
  unknown: { icon: CircleHelp, label: 'Sconosciuto', color: 'rgba(255,255,255,.5)' },
};

export function DeviceIcon({ kind, size = 'md', color }: { kind: string; size?: 'sm' | 'md'; color?: string }) {
  const k = KINDS[kind] ?? KINDS.unknown;
  const Icon = k.icon;
  const c = color ?? k.color;
  return (
    <span className={`avatar ${size === 'sm' ? 'sm' : ''}`} style={{ background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c }} aria-label={k.label} title={k.label}>
      <Icon strokeWidth={1.8} />
    </span>
  );
}

export function LetterAvatar({ text, color, size = 'md' }: { text: string; color: string; size?: 'sm' | 'md' }) {
  return (
    <span className={`avatar ${size === 'sm' ? 'sm' : ''}`} style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
      <span className="letter">{text.slice(0, 1).toUpperCase()}</span>
    </span>
  );
}

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return <section className={`glass card ${className}`} style={style}>{children}</section>;
}

export function CardHead({ icon: Icon, title, href, sub, children }: { icon?: LucideIcon; title: ReactNode; href?: string; sub?: ReactNode; children?: ReactNode }) {
  const t = (
    <>
      {Icon && <Icon strokeWidth={1.8} />}
      <span>{title}</span>
    </>
  );
  return (
    <div className="card-head">
      <div>
        <div className="card-title">{href ? <a href={href}>{t}<span className="faint" aria-hidden>›</span></a> : t}</div>
        {sub && <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>}
      </div>
      {children && <div className="hstack wrap">{children}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as Range)} aria-label="Intervallo di tempo">
      {(Object.keys(RANGE_LABEL) as Range[]).map((r) => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
    </select>
  );
}

export function Status({ tone, children }: { tone: 'ok' | 'warn' | 'err' | 'off'; children: ReactNode }) {
  return <span className="status"><span className={`dot ${tone}`} />{children}</span>;
}

export function Empty({ icon: Icon = Info, children }: { icon?: LucideIcon; children: ReactNode }) {
  return <div className="empty"><Icon strokeWidth={1.6} /><div>{children}</div></div>;
}

export function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

// ---------- events ----------

function eventIcon(e: EventRow): LucideIcon {
  switch (e.type) {
    case 'new_device': return Plus;
    case 'geo_alert': return ShieldAlert;
    case 'internet_down': case 'wan_down': return WifiOff;
    case 'device_offline': return Ban;
    case 'router_boot': case 'action': return Power;
    case 'wan_up': return Cable;
    default: return e.severity === 'success' ? CircleCheck : e.severity === 'error' || e.severity === 'warning' ? TriangleAlert : Info;
  }
}

export function EventList({ events, compact }: { events: EventRow[]; compact?: boolean }) {
  if (!events.length) return <Empty>Nessun evento nel periodo</Empty>;
  return (
    <div className="timeline">
      {events.map((e) => {
        const Icon = eventIcon(e);
        return (
          <div key={e.id} className="ev" style={compact ? { gridTemplateColumns: '36px 60px 1fr' } : undefined}>
            <span className={`ev-icon ${e.severity}`}><Icon strokeWidth={2} /></span>
            <span className="meta num">{fmtWhen(e.ts)}</span>
            <div style={{ minWidth: 0 }}>
              <div className={`ev-title ${e.severity}`} style={{ fontWeight: 550 }}>
                {e.device_id ? <a href={`#/devices/${e.device_id}`}>{e.title}</a> : e.title}
              </div>
              {e.detail && <div className="meta ellipsis">{e.detail}</div>}
            </div>
            {!compact && <span className="pill">{e.severity === 'error' ? 'Critico' : e.severity === 'warning' ? 'Attenzione' : e.severity === 'success' ? 'Risolto' : 'Info'}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- confirm + toast ----------

interface ConfirmOpts { title: string; body: string; confirm: string; danger?: boolean }
const UiCtx = createContext<{ confirm: (o: ConfirmOpts) => Promise<boolean>; toast: (msg: string, tone?: 'ok' | 'err') => void }>({
  confirm: async () => false, toast: () => undefined,
});
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [dlg, setDlg] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'ok' | 'err' } | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setDlg({ ...o, resolve })), []);
  const showToast = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 4000);
  }, []);
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null); };
  return (
    <UiCtx.Provider value={{ confirm, toast: showToast }}>
      {children}
      {dlg && (
        <div className="backdrop" onClick={() => close(false)}>
          <div className="modal glass" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
            <h3>{dlg.title}</h3>
            <p>{dlg.body}</p>
            <div className="actions">
              <button className="btn" onClick={() => close(false)}>Annulla</button>
              <button className={`btn ${dlg.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>{dlg.confirm}</button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast glass" role="status">
          <span className={`dot ${toast.tone === 'ok' ? 'ok' : 'err'}`} />{toast.msg}
        </div>
      )}
    </UiCtx.Provider>
  );
}

export function Kpi({ value, label, accent }: { value: ReactNode; label: string; accent?: string }) {
  return (
    <div>
      <div className="kpi-val num" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="kpi-lbl">{label}</div>
    </div>
  );
}

export function rangeLabel(r: Range) { return RANGE_LABEL[r]; }
