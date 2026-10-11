// Automatic recovery: restart WAN / modem, then reboot the router (or power-cycle it through Home Assistant).
import { kvGet, kvSet } from '../db.js';
import { addEvent } from '../events.js';
import { getSettings } from '../settings.js';
import { state } from '../state.js';
import type { RouterCollector } from './router.js';

export async function haPowerCycle() {
  const { url, token } = getSettings().homeassistant;
  const { entityId } = getSettings().watchdog.ha;
  if (!url || !token || !entityId) throw new Error('Home Assistant non configurato');
  const call = async (service: 'turn_off' | 'turn_on') => {
    const domain = entityId.split('.')[0];
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/services/${domain}/${service}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ entity_id: entityId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Home Assistant HTTP ${res.status}`);
  };
  await call('turn_off');
  await new Promise((r) => setTimeout(r, 15_000));
  await call('turn_on');
}

const ACTION_LABEL: Record<string, string> = {
  restart_wan: 'Riavvio connessione WAN',
  modem_reset: 'Reset modem LTE',
  reboot: 'Riavvio router',
  power_cycle: 'Spegni/riaccendi router (Home Assistant)',
};

export async function runAction(router: RouterCollector | null, action: string, source: 'manual' | 'watchdog') {
  const label = ACTION_LABEL[action] ?? action;
  try {
    if (action === 'power_cycle') await haPowerCycle();
    else {
      if (!router) throw new Error('Router non configurato');
      await router.action(action as 'reboot' | 'restart_wan' | 'modem_reset');
    }
    state.watchdog.lastAction = { ts: Math.floor(Date.now() / 1000), action };
    addEvent('action', source === 'watchdog' ? 'warning' : 'info', label, source === 'watchdog' ? 'Avviato automaticamente dal watchdog' : 'Avviato manualmente');
    if (action === 'reboot' || action === 'power_cycle') {
      const list = kvGet<number[]>('reboots', []).filter((t) => t > Date.now() / 1000 - 6 * 3600);
      list.push(Math.floor(Date.now() / 1000));
      kvSet('reboots', list);
    }
  } catch (e) {
    addEvent('action', 'error', `${label} non riuscito`, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export class Watchdog {
  private offlineSince: number | null = null;
  private step = 0; // 0 idle, 1 first action done, 2 reboot done, 3 gave up
  private stepAt = 0;
  private busy = false;

  constructor(private getRouter: () => RouterCollector | null) {}

  async tick(online: boolean) {
    const now = Math.floor(Date.now() / 1000);
    const s = getSettings().watchdog;
    if (online) {
      this.offlineSince = null;
      this.step = 0;
      state.watchdog.step = 0;
      return;
    }
    this.offlineSince ??= now;
    if (!s.enabled || this.busy) return;
    this.busy = true;
    try {
      const downFor = now - this.offlineSince;
      if (this.step === 0 && downFor >= s.downMinutes * 60) {
        if (state.routerOk && s.firstAction !== 'none') {
          this.advance(1, now);
          await runAction(this.getRouter(), s.firstAction, 'watchdog').catch(() => undefined);
          return;
        }
        this.advance(1, now - s.escalateMinutes * 60);
      }
      if (this.step === 1 && now - this.stepAt >= s.escalateMinutes * 60) {
        const recent = kvGet<number[]>('reboots', []).filter((t) => t > now - 6 * 3600);
        if (recent.length >= s.maxRebootsPer6h) {
          addEvent('watchdog', 'error', 'Watchdog in pausa', `Raggiunto il limite di ${s.maxRebootsPer6h} riavvii in 6 ore`);
          this.advance(3, now);
          return;
        }
        let action: string | null = null;
        if (state.routerOk) action = 'reboot';
        else if (s.ha.enabled) action = 'power_cycle';
        if (!action) {
          addEvent('watchdog', 'error', 'Router non raggiungibile', 'Impossibile riavviarlo: abilita lo spegnimento tramite Home Assistant');
          this.advance(3, now);
          return;
        }
        this.advance(2, now);
        await runAction(this.getRouter(), action, 'watchdog').catch(() => undefined);
        return;
      }
      // still offline 10 minutes after a reboot: start a new cycle (bounded by maxRebootsPer6h)
      if (this.step === 2 && now - this.stepAt >= 600) {
        this.offlineSince = now;
        this.advance(0, now);
      }
      if (this.step === 3 && now - this.stepAt >= 3600) this.advance(1, now - s.escalateMinutes * 60);
    } finally {
      this.busy = false;
    }
  }

  private advance(step: number, at: number) {
    this.step = step;
    this.stepAt = at;
    state.watchdog.step = step;
  }
}
