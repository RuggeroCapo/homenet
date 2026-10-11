import { ChevronLeft, Clock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { PageHead } from '../App';
import { Card, CardHead, EventList, Seg, Skeleton } from '../components/ui';
import { api } from '../lib';
import type { EventRow } from '../types';

type Group = '' | 'internet' | 'devices' | 'geo' | 'router';
const PAGE = 50;

export function Events() {
  const [group, setGroup] = useState<Group>('');
  const [severity, setSeverity] = useState('');
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (before?: EventRow) => {
    setBusy(true);
    const q = new URLSearchParams({ limit: String(PAGE) });
    if (group) q.set('group', group);
    if (severity) q.set('severity', severity);
    if (before) q.set('before', `${before.ts}:${before.id}`);
    try {
      const page = await api<EventRow[]>(`/api/events?${q}`);
      setRows((r) => (before && r ? [...r, ...page] : page));
      setMore(page.length === PAGE);
    } finally {
      setBusy(false);
    }
  }, [group, severity]);

  useEffect(() => { setRows(null); void load(); }, [load]);

  return (
    <>
      <a href="#/" className="back"><ChevronLeft size={16} />Panoramica</a>
      <PageHead title="Eventi" subtitle="Registro di connettività, dispositivi, avvisi della watchlist e azioni sul router." />
      <Card>
        <CardHead icon={Clock} title="Registro eventi">
          <Seg value={group} onChange={setGroup} options={[['', 'Tutti'], ['internet', 'Internet'], ['devices', 'Dispositivi'], ['geo', 'Watchlist'], ['router', 'Router']]} />
          <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Gravità">
            <option value="">Tutte le gravità</option>
            <option value="error">Critico</option>
            <option value="warning">Attenzione</option>
            <option value="success">Risolto</option>
            <option value="info">Info</option>
          </select>
        </CardHead>
        {!rows ? <Skeleton h={300} /> : <EventList events={rows} />}
        {more && rows && (
          <button className="btn" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={() => void load(rows[rows.length - 1])}>
            {busy ? 'Caricamento…' : 'Carica eventi precedenti'}
          </button>
        )}
      </Card>
    </>
  );
}
