'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { getStoredServerId, useServerSelection } from '../../../lib/server-selection';

type Poi = { name: string; hasPreview: boolean };
type Catalog = { indexedAt: string | null; count: number; truncated: boolean; items: Poi[] };
type Run = { data?: { available?: boolean; imageBase64?: string; mimeType?: string }; errorMessage?: string };
const button = (color: string): React.CSSProperties => ({ background: color, color: 'white', border: 0, borderRadius: 6, padding: '.55rem .75rem', fontWeight: 700, cursor: 'pointer' });

export default function PoiSearchPage() {
  const orgId = getStoredOrgId();
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [server, setServer] = useState<ServerInstance | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({ indexedAt: null, count: 0, truncated: false, items: [] });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ name: string; url: string | null } | null>(null);
  const selectServer = useServerSelection(servers, server?.id || '', id => setServer(servers.find(row => row.id === id) || null));

  const wait = useCallback(async (id: string): Promise<Run> => {
    for (let i = 0; i < 480; i++) {
      const run = await api.get<{ status: string; result: Run | null } | null>(`/api/orgs/${orgId}/jobs/runs/${id}`);
      if (run?.status === 'success') return run.result || {};
      if (run?.status === 'failed') throw new Error(run.result?.errorMessage || 'Agent job failed');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Agent job timed out');
  }, [orgId]);
  const load = useCallback(async (target?: ServerInstance) => {
    const selected = target || server;
    if (!orgId || !selected) return;
    setBusy(true); setMessage(''); setPreview(null);
    try { setCatalog(await api.get<Catalog>(`/api/orgs/${orgId}/poi-catalog?serverInstanceId=${encodeURIComponent(selected.id)}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load POI catalogue'); }
    finally { setBusy(false); }
  }, [orgId, server]);
  useEffect(() => { if (!orgId) return; api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`).then(rows => { const preferred = rows.filter(row => row.gameType === 'minecraft'); const game = preferred.length ? preferred : rows.filter(row => row.gameType === '7dtd'); setServers(game); const selected = game.find(row => row.id === getStoredServerId()) || game[0] || null; setServer(selected); }).catch(error => setMessage(error instanceof Error ? error.message : 'Could not load servers')); }, [orgId]);
  useEffect(() => { if (server) void load(server); }, [server?.id]);
  const filtered = useMemo(() => { const q = search.trim().toLocaleLowerCase(); return q ? catalog.items.filter(item => item.name.toLocaleLowerCase().includes(q)) : catalog.items; }, [catalog.items, search]);
  async function index() {
    if (!orgId || !server) return;
    setBusy(true); setMessage('Indexing POI names and previews from the selected server…'); setPreview(null);
    try { const queued = await api.post<{ jobRunId: string }>(`/api/orgs/${orgId}/jobs`, { serverInstanceId: server.id, type: 'POI_CATALOG', payload: {} }); await wait(queued.jobRunId); await load(server); setMessage('POI catalogue updated.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'POI indexing failed'); }
    finally { setBusy(false); }
  }
  async function openPreview(item: Poi) {
    if (!orgId || !server || !item.hasPreview) return;
    setBusy(true); setMessage(`Loading ${item.name} preview…`);
    try { const queued = await api.post<{ jobRunId: string }>(`/api/orgs/${orgId}/jobs`, { serverInstanceId: server.id, type: 'POI_PREVIEW', payload: { name: item.name } }); const result = await wait(queued.jobRunId); const data = result.data; setPreview({ name: item.name, url: data?.available && data.imageBase64 ? `data:${data.mimeType || 'image/jpeg'};base64,${data.imageBase64}` : null }); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load POI preview'); }
    finally { setBusy(false); }
  }
  return <div style={{ maxWidth: 1320, margin: '0 auto' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}><div><h1 style={{ margin: 0, color: '#f1f5f9' }}>POI Search</h1><p style={{ color: '#94a3b8', margin: '5px 0 0' }}>Search native 7 Days to Die prefab names and view their in-game preview images.</p></div><div style={{ display: 'flex', gap: 8, alignItems: 'start' }}><select aria-label="Server" value={server?.id || ''} onChange={event => { const next = servers.find(row => row.id === event.target.value); selectServer(event.target.value); if (next) void load(next); }} disabled={busy} style={{ background: '#111118', color: '#e2e8f0', border: '1px solid #252532', borderRadius: 6, padding: '.55rem' }}>{servers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select><button onClick={() => void index()} disabled={busy || !server} style={button('#4f46e5')}>{busy ? 'Working…' : catalog.indexedAt ? 'Re-index' : 'Index POIs'}</button></div></div>
    {message && <p style={{ color: '#fbbf24' }}>{message}</p>}
    {!catalog.indexedAt && !busy && <div style={{ background: '#111118', border: '1px solid #37305c', borderRadius: 9, padding: 18, color: '#cbd5e1' }}>This server has not been indexed yet. Click <strong>Index POIs</strong> to read its installed game files.</div>}
    {catalog.indexedAt && <><div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}><input aria-label="Search POIs" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search POI name…" style={{ flex: '1 1 280px', background: '#111118', color: '#e2e8f0', border: '1px solid #252532', borderRadius: 6, padding: '.6rem .7rem' }}/><small style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{filtered.length} of {catalog.count}</small></div>
      {preview && <section style={{ background: '#111118', border: '1px solid #37305c', borderRadius: 10, padding: 14, marginBottom: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{preview.name}</strong><button onClick={() => setPreview(null)} style={button('#334155')}>Close</button></div>{preview.url ? <img src={preview.url} alt={`${preview.name} preview`} style={{ display: 'block', maxWidth: '100%', marginTop: 12, borderRadius: 6, imageRendering: 'auto' }} /> : <p style={{ color: '#94a3b8' }}>No preview image is bundled for this prefab.</p>}</section>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(205px,1fr))', gap: 10 }}>{filtered.slice(0, 200).map(item => <article key={item.name} style={{ background: '#111118', border: '1px solid #292936', borderRadius: 8, padding: 12 }}><strong style={{ color: '#e2e8f0', overflowWrap: 'anywhere' }}>{item.name}</strong><div style={{ marginTop: 10 }}>{item.hasPreview ? <button disabled={busy} onClick={() => void openPreview(item)} style={button('#2563eb')}>View preview</button> : <small style={{ color: '#64748b' }}>Preview unavailable</small>}</div></article>)}</div>
      {filtered.length > 200 && <p style={{ color: '#94a3b8' }}>Showing the first 200 matches. Refine your search to narrow results.</p>}</>}
  </div>;
}
