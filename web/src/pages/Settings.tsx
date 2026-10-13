import { Bell, Database, Globe, House, Plug, Router, Save, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { PageHead } from '../App';
import { Card, CardHead, Skeleton, Status, useUi } from '../components/ui';
import { api, countryName, fmtAgo, fmtBytes, usePoll } from '../lib';
import type { Status as StatusData } from '../types';

interface SettingsData {
  router: { url: string; username: string; password: string; has_password?: boolean };
  adguard: { url: string; username: string; password: string; has_password?: boolean };
  retentionDays: number;
  homeCountry: string;
  probeTargets: string[];
  watchdog: { enabled: boolean; downMinutes: number; firstAction: string; escalateMinutes: number; maxRebootsPer6h: number; ha: { enabled: boolean; entityId: string } };
  homeassistant: { url: string; token: string; has_token?: boolean };
  dataPlan: { cycleDay: number; quotaGb: number };
  notify: {
    ntfy: { enabled: boolean; url: string; token: string; has_token?: boolean };
    telegram: { enabled: boolean; botToken: string; chatId: string; has_botToken?: boolean };
    ha: { enabled: boolean; service: string };
    types: { internet: boolean; geo: boolean; newDevice: boolean; deviceOffline: boolean; watchdog: boolean; access: boolean };
  };
  watchlist: { countries: string[]; asnKeywords: string[]; minBytes: number };
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>;
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="between">
      <div><div style={{ fontWeight: 550 }}>{label}</div>{hint && <div className="meta">{hint}</div>}</div>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
    </div>
  );
}

const COLLECTOR_LABEL: Record<string, string> = {
  'router.info': 'Router · stato', 'router.hosts': 'Router · dispositivi', 'router.wifi': 'Router · Wi-Fi', 'router.conntrack': 'Router · connessioni',
  'router.modem': 'Router · modem', 'router.sms': 'Router · SMS', adguard: 'AdGuard Home',
};

export function Settings() {
  const { data, reload } = usePoll<SettingsData>('/api/settings', 600_000);
  const { data: status } = usePoll<StatusData>('/api/status', 15_000);
  const [s, setS] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<Record<string, { ok: boolean; message: string } | 'busy'>>({});
  const { toast } = useUi();
  useEffect(() => { if (data && !s) setS(data); }, [data, s]);
  if (!s) return <><PageHead title="Impostazioni" /><Skeleton h={500} /></>;

  const dirty = !!data && JSON.stringify(s) !== JSON.stringify(data);
  const set = <K extends keyof SettingsData>(k: K, v: Partial<SettingsData[K]>) => setS({ ...s, [k]: typeof v === 'object' && !Array.isArray(v) ? { ...(s[k] as object), ...v } : v });
  const save = async () => {
    setSaving(true);
    try {
      const fresh = await api<SettingsData>('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
      setS(fresh);
      void reload();
      toast('Impostazioni salvate, i collettori si riavviano');
    } catch (e) { toast(String(e), 'err'); } finally { setSaving(false); }
  };
  const runTest = async (target: 'router' | 'adguard') => {
    setTest({ ...test, [target]: 'busy' });
    const body = target === 'router' ? { target, ...s.router } : { target, ...s.adguard };
    const res = await api<{ ok: boolean; message: string }>('/api/settings/test', { method: 'POST', body: JSON.stringify(body) }).catch((e) => ({ ok: false, message: String(e) }));
    setTest((t) => ({ ...t, [target]: res }));
  };
  const sendTest = async () => {
    setTest((t) => ({ ...t, notify: 'busy' }));
    const res = await api<{ ok: boolean; message: string }>('/api/notify/test', { method: 'POST' }).catch((e) => ({ ok: false, message: String(e) }));
    setTest((t) => ({ ...t, notify: res }));
  };
  const TestResult = ({ k }: { k: string }) => {
    const r = test[k];
    if (!r) return null;
    if (r === 'busy') return <span className="meta">Verifica in corso…</span>;
    return <Status tone={r.ok ? 'ok' : 'err'}>{r.message}</Status>;
  };

  return (
    <>
      <PageHead title="Impostazioni" subtitle="Collegamenti, watchdog, watchlist e conservazione dei dati." />
      {(dirty || saving) && (
        <div className="savebar glass" role="region" aria-label="Modifiche non salvate">
          <span className="status"><span className="dot warn" />Modifiche non salvate</span>
          <button className="btn sm ghost" onClick={() => data && setS(data)} disabled={saving}>Annulla</button>
          <button className="btn primary" onClick={save} disabled={saving}><Save />{saving ? 'Salvataggio…' : 'Salva'}</button>
        </div>
      )}
      {status?.demo && <div className="banner info"><Plug /><div>Modalità demo attiva (DEMO=1): router e AdGuard sono simulati, le impostazioni di connessione vengono ignorate.</div></div>}
      <div className="grid g-2">
        <Card>
          <CardHead icon={Router} title="Router OpenWrt" sub="Richiede il plugin HomeNet sul router (cartella router/ del progetto)" />
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Indirizzo del router"><input className="input" value={s.router.url} onChange={(e) => set('router', { url: e.target.value })} placeholder="http://192.168.1.1" /></Field>
            <div className="grid g-2" style={{ gap: 14 }}>
              <Field label="Utente RPC"><input className="input" value={s.router.username} onChange={(e) => set('router', { username: e.target.value })} /></Field>
              <Field label="Password"><input className="input" type="password" value={s.router.password} placeholder={s.router.has_password ? '•••••• (salvata)' : ''} onChange={(e) => set('router', { password: e.target.value })} /></Field>
            </div>
            <div className="hstack wrap"><button className="btn sm" onClick={() => runTest('router')}>Verifica connessione</button><TestResult k="router" /></div>
            <pre className="inset meta" style={{ padding: 12, margin: 0, overflowX: 'auto', fontSize: 12 }}>{`scp -O router/* root@192.168.1.1:/tmp/\nssh root@192.168.1.1 sh /tmp/install.sh 'password-scelta'`}</pre>
          </div>
        </Card>

        <Card>
          <CardHead icon={ShieldCheck} title="AdGuard Home" sub="Per sapere quali domini contatta ogni dispositivo" />
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Indirizzo di AdGuard Home" hint="Su Umbrel AdGuard usa la rete host: http://host.docker.internal:8095 oppure http://umbrel.local:8095">
              <input className="input" value={s.adguard.url} onChange={(e) => set('adguard', { url: e.target.value })} />
            </Field>
            <div className="grid g-2" style={{ gap: 14 }}>
              <Field label="Utente"><input className="input" value={s.adguard.username} onChange={(e) => set('adguard', { username: e.target.value })} /></Field>
              <Field label="Password"><input className="input" type="password" value={s.adguard.password} placeholder={s.adguard.has_password ? '•••••• (salvata)' : ''} onChange={(e) => set('adguard', { password: e.target.value })} /></Field>
            </div>
            <div className="hstack wrap"><button className="btn sm" onClick={() => runTest('adguard')}>Verifica connessione</button><TestResult k="adguard" /></div>
            <div className="meta">Per avere le statistiche per dispositivo, il DHCP del router deve annunciare l'IP di Umbrel come DNS (opzione 6). Se il router inoltra le query ad AdGuard, tutte risulteranno provenire dal router.</div>
          </div>
        </Card>

        <Card>
          <CardHead icon={ShieldCheck} title="Watchdog" sub="Ripristino automatico quando internet non risponde" />
          <div className="stack" style={{ gap: 16 }}>
            <Toggle on={s.watchdog.enabled} onChange={(v) => set('watchdog', { enabled: v })} label="Watchdog automatico" hint="Disattivato di default: abilitalo dopo aver verificato le azioni manuali" />
            <div className="grid g-2" style={{ gap: 14 }}>
              <Field label="Offline da almeno (minuti)"><input className="input" type="number" min={1} value={s.watchdog.downMinutes} onChange={(e) => set('watchdog', { downMinutes: Number(e.target.value) })} /></Field>
              <Field label="Prima azione">
                <select className="select" value={s.watchdog.firstAction} onChange={(e) => set('watchdog', { firstAction: e.target.value })}>
                  <option value="restart_wan">Riavvia connessione WAN</option>
                  <option value="modem_reset">Reset modem LTE</option>
                  <option value="none">Nessuna (vai al riavvio)</option>
                </select>
              </Field>
              <Field label="Poi riavvia il router dopo (minuti)"><input className="input" type="number" min={1} value={s.watchdog.escalateMinutes} onChange={(e) => set('watchdog', { escalateMinutes: Number(e.target.value) })} /></Field>
              <Field label="Massimo riavvii ogni 6 ore"><input className="input" type="number" min={0} value={s.watchdog.maxRebootsPer6h} onChange={(e) => set('watchdog', { maxRebootsPer6h: Number(e.target.value) })} /></Field>
            </div>
            <div className="inset stack" style={{ padding: 14, gap: 12 }}>
              <Toggle on={s.watchdog.ha.enabled} onChange={(v) => set('watchdog', { ha: { ...s.watchdog.ha, enabled: v } })} label="Ultima risorsa: presa smart via Home Assistant" hint="Se il router è bloccato e non risponde, spegne e riaccende la presa" />
              {s.watchdog.ha.enabled && (
                <Field label="Entità della presa (switch)" hint="Connessione a Home Assistant configurata nella sezione Home Assistant qui sotto">
                  <input className="input" value={s.watchdog.ha.entityId} onChange={(e) => set('watchdog', { ha: { ...s.watchdog.ha, entityId: e.target.value } })} />
                </Field>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead icon={Bell} title="Notifiche push" sub="Avvisi sul telefono; se internet è giù vengono inviati appena torna" />
          <div className="stack" style={{ gap: 16 }}>
            <div className="inset stack" style={{ padding: 14, gap: 12 }}>
              <Toggle on={s.notify.ntfy.enabled} onChange={(v) => set('notify', { ntfy: { ...s.notify.ntfy, enabled: v } })} label="ntfy" hint="App gratuita (ntfy.sh) o server ntfy su Umbrel" />
              {s.notify.ntfy.enabled && (
                <div className="grid g-2" style={{ gap: 14 }}>
                  <Field label="URL del topic"><input className="input" value={s.notify.ntfy.url} onChange={(e) => set('notify', { ntfy: { ...s.notify.ntfy, url: e.target.value } })} /></Field>
                  <Field label="Token (opzionale)"><input className="input" type="password" value={s.notify.ntfy.token} placeholder={s.notify.ntfy.has_token ? '•••••• (salvato)' : ''} onChange={(e) => set('notify', { ntfy: { ...s.notify.ntfy, token: e.target.value } })} /></Field>
                </div>
              )}
            </div>
            <div className="inset stack" style={{ padding: 14, gap: 12 }}>
              <Toggle on={s.notify.telegram.enabled} onChange={(v) => set('notify', { telegram: { ...s.notify.telegram, enabled: v } })} label="Telegram" hint="Crea un bot con @BotFather e scrivigli un messaggio" />
              {s.notify.telegram.enabled && (
                <div className="grid g-2" style={{ gap: 14 }}>
                  <Field label="Token del bot"><input className="input" type="password" value={s.notify.telegram.botToken} placeholder={s.notify.telegram.has_botToken ? '•••••• (salvato)' : ''} onChange={(e) => set('notify', { telegram: { ...s.notify.telegram, botToken: e.target.value } })} /></Field>
                  <Field label="Chat ID"><input className="input" value={s.notify.telegram.chatId} onChange={(e) => set('notify', { telegram: { ...s.notify.telegram, chatId: e.target.value } })} /></Field>
                </div>
              )}
            </div>
            <div className="inset stack" style={{ padding: 14, gap: 12 }}>
              <Toggle on={s.notify.ha.enabled} onChange={(v) => set('notify', { ha: { ...s.notify.ha, enabled: v } })} label="App Home Assistant" hint="Usa il servizio notify della app companion" />
              {s.notify.ha.enabled && (
                <Field label="Servizio notify" hint="es. mobile_app_iphone_di_marco (senza «notify.»)"><input className="input" value={s.notify.ha.service} onChange={(e) => set('notify', { ha: { ...s.notify.ha, service: e.target.value } })} /></Field>
              )}
            </div>
            <div>
              <div className="field"><label>Cosa notificare</label></div>
              <div className="hstack wrap" style={{ gap: 8, marginTop: 8 }}>
                {([['internet', 'Internet / WAN'], ['geo', 'Traffico in watchlist'], ['newDevice', 'Nuovi dispositivi'], ['deviceOffline', 'Dispositivi offline'], ['watchdog', 'Azioni e riavvii'], ['access', 'Limiti dati e «solo alcuni»']] as const).map(([k, l]) => (
                  <button key={k} className={`btn sm ${s.notify.types[k] ? 'primary' : ''}`} aria-pressed={s.notify.types[k]} onClick={() => set('notify', { types: { ...s.notify.types, [k]: !s.notify.types[k] } })}>{l}</button>
                ))}
              </div>
            </div>
            <div className="hstack wrap"><button className="btn sm" onClick={sendTest}>Invia notifica di prova</button><TestResult k="notify" /><span className="meta">Salva prima di provare</span></div>
          </div>
        </Card>

        <Card>
          <CardHead icon={House} title="Home Assistant" sub="Usato per la presa smart del watchdog e per le notifiche" />
          <div className="stack" style={{ gap: 14 }}>
            <Field label="URL"><input className="input" value={s.homeassistant.url} onChange={(e) => set('homeassistant', { url: e.target.value })} /></Field>
            <Field label="Token di accesso a lunga durata" hint="Profilo → Sicurezza → Token di accesso a lunga durata">
              <input className="input" type="password" value={s.homeassistant.token} placeholder={s.homeassistant.has_token ? '•••••• (salvato)' : ''} onChange={(e) => set('homeassistant', { token: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHead icon={ShieldAlert} title="Watchlist" sub="Genera un avviso quando un dispositivo invia dati verso queste destinazioni" />
          <div className="stack" style={{ gap: 14 }}>
            <Field label="Paesi (codici ISO separati da virgola)" hint={s.watchlist.countries.map(countryName).join(', ')}>
              <input className="input" value={s.watchlist.countries.join(', ')} onChange={(e) => set('watchlist', { countries: e.target.value.split(',').map((x) => x.trim().toUpperCase()) })} />
            </Field>
            <Field label="Reti (parole chiave nel nome dell'ASN)" hint="Utile quando un'azienda cinese usa server in Europa: es. alibaba, tencent, huawei">
              <input className="input" value={s.watchlist.asnKeywords.join(', ')} onChange={(e) => set('watchlist', { asnKeywords: e.target.value.split(',').map((x) => x.trim()) })} />
            </Field>
            <Field label="Soglia giornaliera per l'avviso (KB per dispositivo)">
              <input className="input" type="number" min={0} value={Math.round(s.watchlist.minBytes / 1000)} onChange={(e) => set('watchlist', { minBytes: Number(e.target.value) * 1000 })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHead icon={Database} title="Dati e risorse" />
          <div className="stack" style={{ gap: 14 }}>
            <div className="grid g-2" style={{ gap: 14 }}>
              <Field label="Conservazione dati" hint="Più giorni = database più grande">
                <select className="select" value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: Number(e.target.value) })}>
                  {[3, 7, 15, 30].map((d) => <option key={d} value={d}>{d} giorni</option>)}
                </select>
              </Field>
              <Field label="Paese di casa (per la mappa)">
                <input className="input" value={s.homeCountry} maxLength={2} onChange={(e) => setS({ ...s, homeCountry: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <div className="grid g-2" style={{ gap: 14 }}>
              <Field label="Piano dati: giorno di rinnovo" hint="Giorno del mese in cui riparte il conteggio">
                <input className="input" type="number" min={1} max={28} value={s.dataPlan.cycleDay} onChange={(e) => set('dataPlan', { cycleDay: Number(e.target.value) })} />
              </Field>
              <Field label="Giga inclusi al mese" hint="0 = illimitato / non mostrare la soglia">
                <input className="input" type="number" min={0} value={s.dataPlan.quotaGb} onChange={(e) => set('dataPlan', { quotaGb: Number(e.target.value) })} />
              </Field>
            </div>
            {status && (
              <div className="grid g-3" style={{ gap: 12 }}>
                <div className="inset" style={{ padding: 12 }}><div className="kpi-lbl" style={{ marginTop: 0 }}>Database</div><div className="kpi-val num">{fmtBytes(status.dbSize)}</div></div>
                <div className="inset" style={{ padding: 12 }}><div className="kpi-lbl" style={{ marginTop: 0 }}>Memoria app</div><div className="kpi-val num">{fmtBytes(status.rss)}</div></div>
                <div className="inset" style={{ padding: 12 }}><div className="kpi-lbl" style={{ marginTop: 0 }}>GeoIP</div><div className="kpi-val num" style={{ fontSize: 16 }}>{status.geo.built ?? 'non scaricato'}</div></div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHead icon={Globe} title="Stato dei collettori" sub={status ? `HomeNet ${status.version}` : undefined} />
          {status && Object.keys(status.collectors).length === 0 && <div className="meta">Nessun collettore attivo: configura router e AdGuard.</div>}
          <div className="rows">
            {status && Object.entries(status.collectors).sort().map(([k, c]) => (
              <div key={k} className="row-item" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <div className="ellipsis">
                  <div className="name">{COLLECTOR_LABEL[k] ?? k}</div>
                  {!c.ok && c.lastError && <div className="meta" style={{ color: '#ffa3a8', whiteSpace: 'normal' }}>{c.lastError}</div>}
                </div>
                <Status tone={c.ok ? 'ok' : 'err'}>{c.ok ? (c.lastOk ? fmtAgo(c.lastOk / 1000) : 'OK') : 'Errore'}</Status>
              </div>
            ))}
          </div>
          {status && status.conntrackTruncated > 0 && <div className="meta" style={{ marginTop: 10 }}>Attenzione: {status.conntrackTruncated} connessioni scartate all'ultimo ciclo (aumenta CONNTRACK_MAX sul router).</div>}
        </Card>
      </div>
    </>
  );
}
