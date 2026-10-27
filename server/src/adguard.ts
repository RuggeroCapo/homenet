// Minimal AdGuard Home API client (only what HomeNet needs).

export interface QueryLogEntry {
  time: string;
  client: string;
  question: { name: string; type: string };
  answer?: Array<{ type: string; value: string; ttl?: number }> | null;
  reason: string;
  client_info?: { name?: string } | null;
}

export interface AdGuardApi {
  querylog(olderThan?: string, limit?: number): Promise<{ data: QueryLogEntry[]; oldest?: string }>;
  status(): Promise<{ version?: string; running?: boolean; protection_enabled?: boolean }>;
  /** Custom filtering rules ("Filtri → Regole personalizzate"). */
  userRules(): Promise<string[]>;
  setUserRules(rules: string[]): Promise<void>;
}

export class AdGuardClient implements AdGuardApi {
  constructor(private baseUrl: string, private username: string, private password: string) {}

  private async request(path: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (this.username) headers.authorization = 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64');
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(this.baseUrl.replace(/\/+$/, '') + path, {
      method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) throw new Error('AdGuard: authentication failed');
    if (!res.ok) throw new Error(`AdGuard HTTP ${res.status}`);
    return body === undefined ? res.json() : undefined;
  }

  private get(path: string) {
    return this.request(path);
  }

  querylog(olderThan?: string, limit = 500) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (olderThan) q.set('older_than', olderThan);
    return this.get(`/control/querylog?${q}`);
  }

  status() {
    return this.get('/control/status');
  }

  async userRules() {
    return ((await this.get('/control/filtering/status')) as { user_rules?: string[] | null }).user_rules ?? [];
  }

  async setUserRules(rules: string[]) {
    await this.request('/control/filtering/set_rules', { rules });
  }
}

/** AdGuard rule that blocks a domain and all its subdomains for every client. */
export const blockRule = (base: string) => `||${base}^`;

/** Domains blocked by HomeNet-style rules (`||domain^`) among the custom rules. */
export const blockedBases = (rules: string[]) =>
  rules.map((r) => /^\|\|([a-z0-9.-]+)\^$/i.exec(r.trim())?.[1]?.toLowerCase()).filter((b): b is string => !!b);

export const isBlocked = (reason: string) => reason.startsWith('Filtered') && reason !== 'FilteredSafeSearch';
