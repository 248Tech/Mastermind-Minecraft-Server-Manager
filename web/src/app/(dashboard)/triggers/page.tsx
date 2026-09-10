'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, TriggerCatalog, TriggerFireRecord, TriggerRecord, ServerInstance } from '../../../lib/api';
import { GrantList, emptyGrant, type GrantDraft } from '../../../components/GrantItemPicker';
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
const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: '#6366f1', color: '#fff', border: 'none',
  borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: 'transparent', color: '#94a3b8',
  border: '1px solid #252532', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem',
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
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500,
};

type FormState = {
  name: string;
  enabled: boolean;
  eventType: string;
  comparison: 'gte' | 'eq';
  level: string;
  actionType: string;
  claimCount: string;
  grants: GrantDraft[];
  applyToExisting: boolean;
  notifyPlayer: boolean;
  message: string;
};

const emptyForm: FormState = {
  name: '',
  enabled: true,
  eventType: 'player_level',
  comparison: 'gte',
  level: '50',
  actionType: 'grant_items',
  claimCount: '5',
  grants: [],
  applyToExisting: false,
  notifyPlayer: true,
  message: 'You reached a reward level.',
};

const fallbackCatalog: TriggerCatalog = {
  events: [{ type: 'player_level', label: 'Player level' }],
  actions: [
    { type: 'grant_items', label: 'Grant items' },
  ],
};

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
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [fires, setFires] = useState<Record<string, TriggerFireRecord[]>>({});
  const [catalog, setCatalog] = useState<TriggerCatalog>(fallbackCatalog);
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemCatalogBusy, setItemCatalogBusy] = useState(false);
  const [itemCatalogSource, setItemCatalogSource] = useState('');

  const waitForJob = useCallback(async (runId: string) => {
    for (let i = 0; i < 240; i++) {
      const run = await api.get<{ status: string; result: { data?: { items?: string[] }; errorMessage?: string } | null } | null>(`/api/orgs/${orgId}/jobs/runs/${runId}`);
      if (run?.status === 'failed') throw new Error(run.result?.errorMessage || 'Item catalog job failed');
      if (run?.status === 'success') return run.result || {};
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Item catalog timed out');
  }, [orgId]);

  const loadItemCatalog = useCallback(async (refresh = false) => {
    if (!orgId) return;
    setItemCatalogBusy(true);
    try {
      let gameItems: string[] = [];
      try {
        const response = await api.get<{ items?: string[]; jobRunId?: string }>(`/api/orgs/${orgId}/shop-items/game-items${refresh ? '?refresh=1' : ''}`);
        if (response.jobRunId) {
          const result = await waitForJob(response.jobRunId);
          gameItems = result.data?.items || [];
        } else {
          gameItems = response.items || [];
        }
      } catch {
        // Catalog may be empty until the agent has scanned items.
      }
      const names = [...new Set(gameItems.map((name) => String(name || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      setItemNames(names);
      setItemCatalogSource(gameItems.length ? `Game items (${names.length.toLocaleString()})` : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load game items');
    } finally {
      setItemCatalogBusy(false);
    }
  }, [orgId, waitForJob]);

  useEffect(() => {
    if (showCreate && form.actionType === 'grant_items') void loadItemCatalog();
  }, [showCreate, form.actionType, loadItemCatalog]);

  const load = useCallback(async () => {
    if (!orgId) return { servers: [] as ServerInstance[], triggers: [] as TriggerRecord[], selected: '', catalog: fallbackCatalog };
    const rows = await api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`);
    const selected = serverId || rows[0]?.id || '';
    const catalog = await api.get<TriggerCatalog>(`/api/orgs/${orgId}/triggers/catalog`).catch(() => fallbackCatalog);
    const list = selected
      ? await api.get<TriggerRecord[]>(`/api/orgs/${orgId}/triggers?serverInstanceId=${encodeURIComponent(selected)}`)
      : [];
    return { servers: rows, triggers: list, selected, catalog };
  }, [orgId, serverId]);

  usePoll(load, (data) => {
    setServers(data.servers);
    setTriggers(data.triggers);
    if (data.catalog) setCatalog({
      events: data.catalog.events?.length ? data.catalog.events : fallbackCatalog.events,
      actions: data.catalog.actions?.length ? data.catalog.actions : fallbackCatalog.actions,
    });
    if (data.selected && data.selected !== serverId) setServerId(data.selected);
    setError('');
  }, 15000, !!orgId);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!orgId || !serverId) return;
    setCreateLoading(true);
    setCreateError('');
    try {
      await api.post<TriggerRecord>(`/api/orgs/${orgId}/triggers`, {
        name: form.name,
        serverInstanceId: serverId,
        enabled: form.enabled,
        eventType: form.eventType,
        eventConfig: { level: Number(form.level), comparison: form.comparison },
        actionType: form.actionType,
        actionConfig: { items: form.grants.filter((row) => row.name.trim()).map((row) => ({ name: row.name, quantity: row.quantity })), notifyPlayer: form.notifyPlayer, message: form.message },
        applyToExisting: form.applyToExisting,
      });
      setShowCreate(false);
      setForm(emptyForm);
      const updated = await load();
      setTriggers(updated.triggers);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create trigger');
    } finally {
      setCreateLoading(false);
    }
  }

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
          Run an action when an in-game event happens. Land-claim rewards write trigger claims plus donated extras. Grant items uses the same item picker as the donator shop.
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
            <button style={btnPrimary} onClick={() => { setShowCreate(!showCreate); setCreateError(''); }}>
              {showCreate ? 'Cancel' : '+ Add trigger'}
            </button>
          </div>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} style={{ background: '#0d0d14', border: '1px solid #1e1e2a', borderRadius: 8, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>New trigger</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.875rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="Level 50 land claims" />
              </div>
              <div>
                <label style={labelStyle}>Event</label>
                <select style={inputStyle} value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })}>
                  {catalog.events.map((event) => <option key={event.type} value={event.type}>{event.label}</option>)}
                </select>
              </div>
              {form.eventType === 'player_level' && (
                <>
                  <div>
                    <label style={labelStyle}>When level is</label>
                    <select style={inputStyle} value={form.comparison} onChange={(event) => setForm({ ...form, comparison: event.target.value as 'gte' | 'eq' })}>
                      <option value="gte">At least</option>
                      <option value="eq">Reached this level</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Level *</label>
                    <input style={inputStyle} type="number" min={1} max={300} value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })} required />
                  </div>
                </>
              )}
              <div>
                <label style={labelStyle}>Action</label>
                <select
                  style={inputStyle}
                  value={form.actionType}
                  onChange={(event) => {
                    const actionType = event.target.value;
                    setForm({
                      ...form,
                      actionType,
                      message: actionType === 'grant_items'
                        ? (form.message === emptyForm.message ? 'You reached a reward level.' : form.message)
                        : form.message,
                      grants: form.grants.length ? form.grants : [emptyGrant()],
                    });
                  }}
                >
                  {catalog.actions.map((action) => <option key={action.type} value={action.type}>{action.label}</option>)}
                </select>
              </div>
              {form.actionType === 'grant_items' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Items to grant *</label>
                  <GrantList
                    value={form.grants}
                    onChange={(grants) => setForm({ ...form, grants })}
                    catalog={itemNames}
                    loading={itemCatalogBusy}
                    sourceLabel={itemCatalogSource}
                    onRefresh={() => void loadItemCatalog(true)}
                  />
                </div>
              )}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>In-game message</label>
                <input style={inputStyle} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="You reached a reward level." />
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>Placeholders: {'{name}'} {'{level}'} {'{items}'}</div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: '.85rem' }}>
                <input type="checkbox" checked={form.applyToExisting} onChange={(event) => setForm({ ...form, applyToExisting: event.target.checked })} />
                Apply to players already at or above this level
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: '.85rem' }}>
                <input type="checkbox" checked={form.notifyPlayer} onChange={(event) => setForm({ ...form, notifyPlayer: event.target.checked })} />
                Announce in server chat
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: '.85rem' }}>
                <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
                Enabled
              </label>
            </div>
            {createError && <p style={{ color: '#f87171', margin: '0.875rem 0 0', fontSize: '0.8rem' }}>{createError}</p>}
            <div style={{ marginTop: '1rem', display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading || !serverId}>{createLoading ? 'Saving…' : 'Save trigger'}</button>
              <button type="button" style={btnSecondary} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        )}

        {triggers.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: '0.875rem' }}>No triggers yet. Example: at level 50, grant diamond ×4.</p>
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
