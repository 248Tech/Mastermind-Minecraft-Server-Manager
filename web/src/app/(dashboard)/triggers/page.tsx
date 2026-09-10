'use client';
import { useCallback, useState } from 'react';
import { api, TriggerCatalog, TriggerFireRecord, TriggerRecord, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { getStoredServerId } from '../../../lib/server-selection';
import { usePoll } from '../../../hooks/useRealtime';

const card: React.CSSProperties = {
  background: '#111118', borderRadius: 10, padding: '1.5rem',
  border: '1px solid #1e1e2a', marginBottom: '1rem',
};
const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.875rem', borderRadius: 7, border: '1px solid #252532',
  fontSize: '0.875rem', background: '#0d0d14', color: '#f1f5f9',
  width: '100%', outline: 'none',
};
const btnSmall: React.CSSProperties = {
  padding: '0.25rem 0.625rem', background: 'transparent', color: '#94a3b8',
  border: '1px solid #252532', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem',
};
const btnDangerSmall: React.CSSProperties = { ...btnSmall, color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' };
const thStyle: React.CSSProperties = {
  padding: '0.625rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600,
  color: '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase',
  background: '#0d0d14', borderBottom: '1px solid #1e1e2a',
};
const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem', fontSize: '0.875rem', borderBottom: '1px solid #1a1a24', color: '#e2e8f0',
};

const emptyCatalog: TriggerCatalog = { events: [], actions: [{ type: 'grant_items', label: 'Grant items' }] };

function eventSummary(trigger: TriggerRecord) {
  const level = Number(trigger.eventConfig?.level);
  const comparison = trigger.eventConfig?.comparison === 'eq' ? '=' : '>=';
  return Number.isInteger(level) ? `Level ${comparison} ${level}` : trigger.eventType;
}

function actionSummary(trigger: TriggerRecord) {
  if (trigger.actionType === 'grant_items') {
    const items = trigger.actionConfig?.items || [];
    return items.length
      ? `Grant ${items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}`
      : 'Grant items';
  }
  return trigger.actionType;
}

export default function TriggersPage() {
  const orgId = getStoredOrgId();
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [serverId, setServerId] = useState(getStoredServerId());
  const [triggers, setTriggers] = useState<TriggerRecord[]>([]);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [fires, setFires] = useState<Record<string, TriggerFireRecord[]>>({});
  const [catalog, setCatalog] = useState<TriggerCatalog>(emptyCatalog);

  const canCreate = (catalog.events?.length ?? 0) > 0;

  const load = useCallback(async () => {
    if (!orgId) return { servers: [] as ServerInstance[], triggers: [] as TriggerRecord[], selected: '', catalog: emptyCatalog };
    const rows = await api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`);
    const selected = serverId || rows[0]?.id || '';
    const catalog = await api.get<TriggerCatalog>(`/api/orgs/${orgId}/triggers/catalog`).catch(() => emptyCatalog);
    const list = selected
      ? await api.get<TriggerRecord[]>(`/api/orgs/${orgId}/triggers?serverInstanceId=${encodeURIComponent(selected)}`)
      : [];
    return { servers: rows, triggers: list, selected, catalog };
  }, [orgId, serverId]);

  usePoll(load, (data) => {
    setServers(data.servers);
    setTriggers(data.triggers);
    if (data.catalog) setCatalog({
      events: data.catalog.events ?? [],
      actions: data.catalog.actions?.length ? data.catalog.actions : emptyCatalog.actions,
    });
    if (data.selected && data.selected !== serverId) setServerId(data.selected);
    setError('');
  }, 15000, !!orgId);

  async function handleToggle(trigger: TriggerRecord) {
    if (!orgId) return;
    setActionLoading(trigger.id);
    try {
      await api.patch<TriggerRecord>(`/api/orgs/${orgId}/triggers/${trigger.id}`, { enabled: !trigger.enabled });
      const updated = await load();
      setTriggers(updated.triggers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update trigger');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: string) {
    if (!orgId || !confirm('Delete this trigger?')) return;
    setActionLoading(id);
    try {
      await api.delete(`/api/orgs/${orgId}/triggers/${id}`);
      setTriggers((current) => current.filter((trigger) => trigger.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete trigger');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFires(id: string) {
    if (!orgId) return;
    if (fires[id]) {
      setFires((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setActionLoading(id);
    try {
      const rows = await api.get<TriggerFireRecord[]>(`/api/orgs/${orgId}/triggers/${id}/fires`);
      setFires((current) => ({ ...current, [id]: rows }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load grant log');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>Triggers</h1>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#64748b' }}>
          Run an action when an in-game event happens.
        </p>
      </div>
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.25rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#f1f5f9' }}>Event actions</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select aria-label="Server" style={{ ...inputStyle, width: 'auto' }} value={serverId} onChange={(event) => setServerId(event.target.value)}>
              {servers.length === 0 && <option value="">No servers</option>}
              {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
            </select>
            <button
              style={{
                padding: '0.5rem 1.125rem', background: canCreate ? '#6366f1' : '#1e1e2a', color: canCreate ? '#fff' : '#64748b',
                border: 'none', borderRadius: 7, cursor: canCreate ? 'pointer' : 'not-allowed', fontSize: '0.875rem', fontWeight: 600,
              }}
              disabled={!canCreate}
              title={!canCreate ? 'Level triggers require Minecraft progression sync (not yet available)' : undefined}
            >
              + Add trigger
            </button>
          </div>
        </div>

        {!canCreate && (
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '0.85rem 1rem', marginBottom: '1.25rem' }}>
            Level triggers require Minecraft progression sync (not yet available). Existing triggers below remain visible so you can disable or delete them.
          </p>
        )}

        {triggers.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No triggers configured.</p>
        ) : (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid #1e1e2a' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Name', 'Event', 'Action', 'Enabled', 'Last fire', 'Grants', 'Actions'].map((heading) => (
                    <th key={heading} style={thStyle}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {triggers.map((trigger) => (
                  <tr key={trigger.id}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{trigger.name}</td>
                    <td style={tdStyle}><code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.78rem', color: '#94a3b8' }}>{eventSummary(trigger)}</code></td>
                    <td style={tdStyle}><code style={{ background: '#1e1e2a', padding: '0.15rem 0.5rem', borderRadius: 4, fontSize: '0.78rem', color: '#94a3b8' }}>{actionSummary(trigger)}</code></td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: trigger.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)', color: trigger.enabled ? '#4ade80' : '#64748b' }}>
                        {trigger.enabled ? 'On' : 'Off'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#64748b', fontSize: '0.8rem' }}>{trigger.lastFiredAt ? new Date(trigger.lastFiredAt).toLocaleString() : '—'}</td>
                    <td style={tdStyle}>{trigger.fireCount}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button style={btnSmall} onClick={() => handleToggle(trigger)} disabled={actionLoading === trigger.id}>{trigger.enabled ? 'Disable' : 'Enable'}</button>
                        <button style={btnSmall} onClick={() => void handleFires(trigger.id)} disabled={actionLoading === trigger.id}>{fires[trigger.id] ? 'Hide log' : 'Grant log'}</button>
                        <button style={btnDangerSmall} onClick={() => void handleDelete(trigger.id)} disabled={actionLoading === trigger.id}>Delete</button>
                      </div>
                      {fires[trigger.id] && (
                        <div style={{ color: '#94a3b8', fontSize: '.75rem', marginTop: 8 }}>
                          {fires[trigger.id].length === 0
                            ? 'No grants yet.'
                            : fires[trigger.id].map((fire) => (
                              <div key={fire.id}>{fire.player.name} · {fire.eventKey} · {new Date(fire.createdAt).toLocaleString()}</div>
                            ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
