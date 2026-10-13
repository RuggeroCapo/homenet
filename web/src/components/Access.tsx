import { CalendarClock, Gauge, Pause, Play, ShieldCheck, Users, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, fmtBytes, fmtTime, usePoll } from '../lib';
import type { Access, AccessStatus, BlockReason, CapPeriod, Device, DeviceWithTraffic, Schedule, Status as SysStatus } from '../types';
import { Card, CardHead, DeviceIcon, Seg, Status, useUi } from './ui';

/** Fired after access changes so the app-wide banner refreshes right away. */
export const ACCESS_CHANGED = 'homenet:access';

export const REASON: Record<BlockReason, string> = {
  manual: 'In pausa', schedule: 'Fascia oraria', cap: 'Limite dati raggiunto', lockdown: 'Solo alcuni dispositivi',
};

/** "alle 21:30", "domani alle 07:00", "a ven 16 ott, 07:00" (`far` = preposition for other days) */
export function fmtUntil(ts: number, far = 'a ') {
  const d = new Date(ts * 1000);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `alle ${fmtTime(ts)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `domani alle ${fmtTime(ts)}`;
  return far + d.toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function accessLabel(a: Access) {
  return `${a.reasons.map((r) => REASON[r]).join(' · ')} · ${a.until ? `fino ${fmtUntil(a.until)}` : 'fino alla riattivazione'}`;
}

const tomorrowMorning = () => {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(7, 0, 0, 0);
  return Math.floor(t.getTime() / 1000);
};
const PAUSES: Array<[string, () => number | null]> = [
  ['30 min', () => Math.floor(Date.now() / 1000) + 1800],
  ['1 ora', () => Math.floor(Date.now() / 1000) + 3600],
  ['2 ore', () => Math.floor(Date.now() / 1000) + 7200],
  ['Fino a domani', tomorrowMorning],
  ['Finché non riattivo', () => null],
];

const DAYS: Array<[number, string, string]> = [[1, 'L', 'lunedì'], [2, 'M', 'martedì'], [3, 'M', 'mercoledì'], [4, 'G', 'giovedì'], [5, 'V', 'venerdì'], [6, 'S', 'sabato'], [0, 'D', 'domenica']];
const PERIOD_LABEL: Record<CapPeriod, string> = { day: 'al giorno', week: 'a settimana', cycle: 'per ciclo di fatturazione' };

export function useAccessStatus() {
  return usePoll<SysStatus>('/api/status', 30_000).data?.access ?? null;
}

/** Router-side problems that make the controls useless; shown above them. */
function AccessWarning({ st }: { st: AccessStatus | null }) {
  if (!st) return null;
  if (st.pluginOk === false) return <div className="banner warn"><WifiOff /><div><b>Aggiorna il plugin del router</b> per usare pause, fasce orarie e limiti: riesegui <code>install.sh</code> (vedi README).</div></div>;
  if (st.error) return <div className="banner warn"><WifiOff /><div><b>Regole non applicate sul router:</b> {st.error}</div></div>;
  return null;
}

/** Device page card: pause / resume, weekly schedule, data cap, "essential" flag. */
export function AccessCard({ device: d, onChange, onLockdown }: { device: Device; onChange: () => Promise<void> | void; onLockdown: () => void }) {
  const a = d.access;
  const { toast } = useUi();
  const st = useAccessStatus();
  const [busy, setBusy] = useState(false);
  const call = async (path: string, body?: unknown, method = 'POST', ok = 'Fatto') => {
    setBusy(true);
    try { await api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); await onChange(); toast(ok); } catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); } finally { setBusy(false); }
  };
  const patch = (body: Record<string, unknown>, ok = 'Salvato') => call(`/api/devices/${d.id}`, body, 'PATCH', ok);

  if (!a.controllable) {
    return (
      <Card>
        <CardHead icon={ShieldCheck} title="Accesso a Internet" />
        <p className="meta" style={{ margin: 0 }}>Il MAC di questo dispositivo non è noto (visto solo tramite DNS o IP), quindi non può essere messo in pausa.</p>
      </Card>
    );
  }
  const own = a.reasons.filter((r) => r !== 'lockdown');
  return (
    <Card>
      <CardHead icon={ShieldCheck} title="Accesso a Internet" sub="La rete locale continua a funzionare anche in pausa" />
      <AccessWarning st={st} />
      <div className="stack" style={{ gap: 18 }}>
        <div className="between wrap" style={{ gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            {a.blocked ? <Status tone="err">Senza Internet</Status> : <Status tone="ok">Connesso a Internet</Status>}
            <div className="meta" style={{ marginTop: 4 }}>
              {a.blocked ? accessLabel(a) : a.overrideUntil ? `Riattivato a mano: regole sospese fino ${fmtUntil(a.overrideUntil)}` : 'Nessuna restrizione attiva'}
            </div>
          </div>
          {own.length > 0 && <button className="btn primary sm" disabled={busy} onClick={() => void call(`/api/devices/${d.id}/resume`, undefined, 'POST', 'Internet riattivato')}><Play />Riattiva ora</button>}
        </div>
        {own.length === 0 && (
          <div>
            <div className="meta" style={{ marginBottom: 8 }}>Metti in pausa</div>
            <div className="hstack wrap" style={{ gap: 8 }}>
              {PAUSES.map(([label, until]) => (
                <button key={label} className="btn sm" disabled={busy} onClick={() => void call(`/api/devices/${d.id}/pause`, { until: until() }, 'POST', `${d.name} in pausa`)}><Pause />{label}</button>
              ))}
            </div>
          </div>
        )}
        <div className="hstack wrap" style={{ gap: 8 }}>
          <button className="btn sm" disabled={busy} onClick={onLockdown}><Users />Internet solo a questo dispositivo…</button>
        </div>
        <div className="divider" />
        <ScheduleEditor value={a.schedule} active={a.scheduleActive} busy={busy} onSave={(schedule) => patch({ schedule }, 'Fascia oraria salvata')} />
        <div className="divider" />
        <CapEditor cap={a.cap} busy={busy} onSave={(cap) => patch({ cap }, cap ? 'Limite salvato' : 'Limite rimosso')} />
        <div className="divider" />
        <div className="between">
          <div><div style={{ fontWeight: 550 }}>Dispositivo essenziale</div><div className="meta">Resta connesso anche in modalità «solo alcuni dispositivi» (es. Umbrel, Home Assistant)</div></div>
          <button className={`switch ${a.essential ? 'on' : ''}`} role="switch" aria-checked={a.essential} aria-label="Dispositivo essenziale" disabled={busy} onClick={() => void patch({ essential: !a.essential })} />
        </div>
      </div>
    </Card>
  );
}

function ScheduleEditor({ value, active, busy, onSave }: { value: Schedule | null; active: boolean; busy: boolean; onSave: (s: Schedule) => void }) {
  const initial = value ?? { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], from: '23:00', to: '07:00' };
  const [s, setS] = useState<Schedule>(initial);
  useEffect(() => { setS(initial); }, [JSON.stringify(value)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  const toggleDay = (day: number) => setS({ ...s, days: s.days.includes(day) ? s.days.filter((x) => x !== day) : [...s.days, day] });
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="between">
        <div>
          <div className="hstack" style={{ gap: 6, fontWeight: 550 }}><CalendarClock size={16} />Fascia oraria senza Internet</div>
          <div className="meta">{active ? 'In corso adesso' : 'Ogni settimana nei giorni scelti, anche a cavallo della mezzanotte'}</div>
        </div>
        <button className={`switch ${s.enabled ? 'on' : ''}`} role="switch" aria-checked={s.enabled} aria-label="Fascia oraria attiva" onClick={() => setS({ ...s, enabled: !s.enabled })} />
      </div>
      {s.enabled && (
        <div className="hstack wrap" style={{ gap: 12 }}>
          <div className="seg" role="group" aria-label="Giorni">
            {DAYS.map(([day, l, full]) => (
              <button key={day} type="button" className={s.days.includes(day) ? 'on' : ''} aria-pressed={s.days.includes(day)} aria-label={full} title={full} onClick={() => toggleDay(day)}>{l}</button>
            ))}
          </div>
          <div className="hstack" style={{ gap: 8 }}>
            <input className="input" type="time" aria-label="Dalle" value={s.from} onChange={(e) => setS({ ...s, from: e.target.value })} style={{ width: 110 }} />
            <span className="meta">→</span>
            <input className="input" type="time" aria-label="Alle" value={s.to} onChange={(e) => setS({ ...s, to: e.target.value })} style={{ width: 110 }} />
          </div>
        </div>
      )}
      {dirty && (
        <div className="hstack" style={{ gap: 8 }}>
          <button className="btn primary sm" disabled={busy || (s.enabled && (!s.days.length || s.from === s.to))} onClick={() => onSave(s)}>Salva fascia oraria</button>
          <button className="btn sm" onClick={() => setS(initial)}>Annulla</button>
        </div>
      )}
    </div>
  );
}

function CapEditor({ cap, busy, onSave }: { cap: Access['cap']; busy: boolean; onSave: (c: { bytes: number; period: CapPeriod } | null) => void }) {
  const [gb, setGb] = useState(cap ? String(cap.bytes / 1e9) : '');
  const [period, setPeriod] = useState<CapPeriod>(cap?.period ?? 'day');
  useEffect(() => { setGb(cap ? String(cap.bytes / 1e9) : ''); setPeriod(cap?.period ?? 'day'); }, [cap?.bytes, cap?.period]);
  const value = Number(gb.replace(',', '.'));
  const valid = Number.isFinite(value) && value > 0;
  const dirty = valid && (!cap || Math.round(value * 1e9) !== cap.bytes || period !== cap.period);
  const pct = cap ? Math.min(1, cap.used / cap.bytes) : 0;
  const tone = pct >= 1 ? 'var(--err)' : pct >= 0.8 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <div className="hstack" style={{ gap: 6, fontWeight: 550 }}><Gauge size={16} />Limite dati</div>
        <div className="meta">Raggiunto il limite, il dispositivo resta senza Internet fino all'inizio del periodo successivo</div>
      </div>
      {cap && (
        <div>
          <div className="between" style={{ marginBottom: 6 }}>
            <span className="num" style={{ fontWeight: 600 }}>{fmtBytes(cap.used)} <span className="muted" style={{ fontWeight: 500 }}>di {fmtBytes(cap.bytes)} {PERIOD_LABEL[cap.period]}</span></span>
            <span className="meta">si azzera {fmtUntil(cap.end, '')}</span>
          </div>
          <div className="bar" style={{ height: 8 }} role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Dati usati">
            <i style={{ width: `${pct * 100}%`, background: tone }} />
          </div>
        </div>
      )}
      <div className="hstack wrap" style={{ gap: 8 }}>
        <input className="input" inputMode="decimal" placeholder="GB" aria-label="Limite in GB" value={gb} onChange={(e) => setGb(e.target.value)} style={{ width: 90 }} />
        <span className="meta">GB</span>
        <Seg label="Periodo" value={period} onChange={setPeriod} options={[['day', 'Giorno'], ['week', 'Settimana'], ['cycle', 'Ciclo']]} />
        {dirty && <button className="btn primary sm" disabled={busy} onClick={() => onSave({ bytes: Math.round(value * 1e9), period })}>Salva</button>}
        {cap && <button className="btn ghost sm" disabled={busy} onClick={() => onSave(null)}>Rimuovi</button>}
      </div>
    </div>
  );
}

const DURATIONS: Array<[string, string]> = [['30', '30 min'], ['60', '1 ora'], ['120', '2 ore'], ['240', '4 ore'], ['480', '8 ore']];

/** "Only these devices have internet": pick who stays online and for how long. */
export function LockdownDialog({ preselect, onClose }: { preselect: number[]; onClose: (changed: boolean) => void }) {
  const { data } = usePoll<DeviceWithTraffic[]>('/api/devices?range=24h', 60_000);
  const { toast } = useUi();
  const [sel, setSel] = useState<number[]>(preselect);
  const [minutes, setMinutes] = useState('60');
  const [busy, setBusy] = useState(false);
  const list = (data ?? []).filter((d) => d.access.controllable).sort((x, y) => Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
  const kept = list.filter((d) => d.access.essential || sel.includes(d.id));
  const cut = list.length - kept.length;
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(false); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  const start = async () => {
    setBusy(true);
    try {
      await api('/api/lockdown', { method: 'POST', body: JSON.stringify({ allow: sel, minutes: Number(minutes) }) });
      toast('Internet attivo solo per i dispositivi scelti');
      window.dispatchEvent(new Event(ACCESS_CHANGED));
      onClose(true);
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'err'); setBusy(false); }
  };
  return (
    <div className="backdrop" onClick={() => onClose(false)}>
      <div className="modal glass" role="dialog" aria-modal aria-labelledby="lockdown-title" onClick={(e) => e.stopPropagation()} style={{ width: 'min(520px, calc(100vw - 32px))' }}>
        <h3 id="lockdown-title">Internet solo per alcuni dispositivi</h3>
        <p style={{ marginBottom: 16 }}>Tutti gli altri perdono l'accesso a Internet finché non termini o scade il tempo. La rete locale continua a funzionare.</p>
        <div className="rows" style={{ maxHeight: 290, overflowY: 'auto', overflowX: 'hidden', marginBottom: 16 }}>
          {!data && <div className="skeleton" style={{ height: 200 }} />}
          {list.map((d) => {
            const locked = d.access.essential;
            const on = locked || sel.includes(d.id);
            return (
              <label key={d.id} className="row-item" style={{ gridTemplateColumns: '22px 36px minmax(0,1fr) auto', cursor: locked ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={on} disabled={locked} onChange={() => setSel(on ? sel.filter((x) => x !== d.id) : [...sel, d.id])} />
                <DeviceIcon kind={d.kind} size="sm" />
                <div className="ellipsis"><div className="name">{d.name}</div><div className="meta">{d.online ? 'Online' : 'Offline'}{d.ip ? ` · ${d.ip}` : ''}</div></div>
                {locked && <span className="pill">Essenziale</span>}
              </label>
            );
          })}
        </div>
        {data && !list.some((d) => d.access.essential) && (
          <div className="banner warn" style={{ marginBottom: 16 }}><WifiOff /><div>Nessun dispositivo è segnato come essenziale: anche Umbrel perderà Internet se non lo selezioni.</div></div>
        )}
        <div className="between wrap" style={{ gap: 12, marginBottom: 22 }}>
          <Seg label="Durata" value={minutes} onChange={setMinutes} options={DURATIONS} />
          <span className="meta">{cut} {cut === 1 ? 'dispositivo perde' : 'dispositivi perdono'} Internet</span>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => onClose(false)}>Annulla</button>
          <button className="btn danger" disabled={busy || !sel.length} onClick={() => void start()}>Attiva per {DURATIONS.find((x) => x[0] === minutes)?.[1]}</button>
        </div>
      </div>
    </div>
  );
}

/** App-wide banner while a lockdown is running. */
export function LockdownBanner({ st, onEnd }: { st: AccessStatus | null | undefined; onEnd: () => void }) {
  const { confirm, toast } = useUi();
  if (!st?.lockdown) return null;
  const l = st.lockdown;
  return (
    <div className="banner warn" role="status" style={{ alignItems: 'center' }}>
      <Users />
      <div style={{ flex: 1, minWidth: 0 }}><b>Internet solo per {l.names.join(', ')}</b> e i dispositivi essenziali · fino {fmtUntil(l.until)}</div>
      <button className="btn sm" onClick={async () => {
        if (!await confirm({ title: 'Ridare Internet a tutti?', body: 'Termina subito la modalità «solo alcuni dispositivi». Pause, fasce orarie e limiti dei singoli dispositivi restano attivi.', confirm: 'Termina ora' })) return;
        try { await api('/api/lockdown', { method: 'DELETE' }); toast('Internet di nuovo per tutti'); onEnd(); } catch (e) { toast(String(e), 'err'); }
      }}>Termina ora</button>
    </div>
  );
}
