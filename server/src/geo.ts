// Offline IP → country / ASN lookups using the free DB-IP "lite" databases (CC BY 4.0).
// Files are downloaded once into DATA_DIR/geo and refreshed monthly (~15 MB total).
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Reader } from 'maxmind';
import { DATA_DIR, db } from './db.js';
import { log } from './log.js';

const GEO_DIR = path.join(DATA_DIR, 'geo');
const FILES = { country: 'dbip-country-lite', asn: 'dbip-asn-lite' } as const;

let countryReader: Reader<any> | null = null;
let asnReader: Reader<any> | null = null;
let builtAt: string | null = null;

export interface GeoInfo { cc: string | null; asn: number | null; org: string | null }

const cache = new Map<string, GeoInfo>();
const demoTable = new Map<string, GeoInfo>();
const upsertAsn = db.prepare('INSERT INTO asns (asn, org) VALUES (?, ?) ON CONFLICT(asn) DO UPDATE SET org = excluded.org');
const knownAsn = new Set<number>();

export function registerDemoGeo(ip: string, info: GeoInfo) {
  demoTable.set(ip, info);
}

export function lookup(ip: string): GeoInfo {
  let g = cache.get(ip);
  if (g) return g;
  g = demoTable.get(ip) ?? { cc: null, asn: null, org: null };
  if (!demoTable.has(ip)) {
    try {
      const c = countryReader?.get(ip);
      g.cc = c?.country?.iso_code ?? c?.registered_country?.iso_code ?? null;
      const a = asnReader?.get(ip);
      g.asn = a?.autonomous_system_number ?? null;
      g.org = a?.autonomous_system_organization ?? null;
    } catch { /* invalid address */ }
  }
  if (g.asn && !knownAsn.has(g.asn)) { knownAsn.add(g.asn); upsertAsn.run(g.asn, g.org); }
  if (cache.size > 20_000) cache.clear();
  cache.set(ip, g);
  return g;
}

export function geoStatus() {
  return { loaded: !!countryReader, asn: !!asnReader, built: builtAt };
}

function month(offset: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function download(name: string, dest: string) {
  for (const offset of [0, 1]) {
    const url = `https://download.db-ip.com/free/${name}-${month(offset)}.mmdb.gz`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok || !res.body) continue;
    const tmp = dest + '.tmp';
    await pipeline(Readable.fromWeb(res.body as any), createGunzip(), fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
    log.info(`geo: downloaded ${name} (${month(offset)})`);
    return;
  }
  throw new Error(`geo: could not download ${name}`);
}

function open() {
  const c = path.join(GEO_DIR, FILES.country + '.mmdb');
  const a = path.join(GEO_DIR, FILES.asn + '.mmdb');
  if (fs.existsSync(c)) {
    countryReader = new Reader(fs.readFileSync(c));
    builtAt = new Date(countryReader.metadata.buildEpoch).toISOString().slice(0, 10);
  }
  if (fs.existsSync(a)) asnReader = new Reader(fs.readFileSync(a));
  cache.clear();
}

/** Opens local DBs and refreshes them in the background when missing or older than 32 days. */
export async function initGeo() {
  fs.mkdirSync(GEO_DIR, { recursive: true });
  open();
  for (const name of Object.values(FILES)) {
    const dest = path.join(GEO_DIR, name + '.mmdb');
    const stale = !fs.existsSync(dest) || Date.now() - fs.statSync(dest).mtimeMs > 32 * 86400_000;
    if (!stale) continue;
    try {
      await download(name, dest);
    } catch (e) {
      log.warn(String(e));
    }
  }
  open();
}
