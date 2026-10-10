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
}

export class AdGuardClient implements AdGuardApi {
  constructor(private baseUrl: string, private username: string, private password: string) {}

  private async get(path: string) {
    const headers: Record<string, string> = {};
    if (this.username) headers.authorization = 'Basic ' + Buffer.from(`${this.username}:${this.password}`).toString('base64');
    const res = await fetch(this.baseUrl.replace(/\/+$/, '') + path, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) throw new Error('AdGuard: authentication failed');
    if (!res.ok) throw new Error(`AdGuard HTTP ${res.status}`);
    return res.json();
  }

  querylog(olderThan?: string, limit = 500) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (olderThan) q.set('older_than', olderThan);
    return this.get(`/control/querylog?${q}`);
  }

  status() {
    return this.get('/control/status');
  }
}

export const isBlocked = (reason: string) => reason.startsWith('Filtered') && reason !== 'FilteredSafeSearch';
