'use client';
import { useCallback, useState } from 'react';
import { api, TriggerCatalog, TriggerFireRecord, TriggerRecord, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { getStoredServerId } from '../../../lib/server-selection';
import { usePoll } from '../../../hooks/useRealtime';
import { GrantList, emptyGrant, type GrantDraft } from '../../../components/GrantItemPicker';

const card: React.CSSProperties = {
  background: '#111118', borderRadius: 10, padding: '1.5rem',
  border: '1px solid #1e1e2a', marginBottom: '1rem',
};
const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.875rem', borderRadius: 7, border: '1px solid #252532',
  fontSize: '0.875rem', background: '#0d0d14', color: '#f1f5f9',
  width: '100%', outline: 'none',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.78rem', color: '#94a3b8', marginBottom: '0.3rem', fontWeight: 500 };
const btnSmall: React.CSSProperties = {
  padding: '0.25rem 0.625rem', background: 'transparent', color: '#94a3b8',
  border: '1px solid #252532', borderRadius: 5, cursor: 'pointer', fontSize: '0.78rem',
};
const btnDangerSmall: React.CSSProperties = { ...btnSmall, color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' };
const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1.125rem', background: '#6366f1', color: '#fff',
  border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
};
const thStyle: React.CSSProperties = {
  padding: '0.625rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600,
  color: '#64748b', letterSpacing: '0.04em', textTransform: 'uppercase',
  background: '#0d0d14', borderBottom: '1px solid #1e1e2a',
};
const tdStyle: React.CSSProperties = {
  padding: '0.75rem 1rem', fontSize: '0.875rem', borderBottom: '1px solid #1a1a24', color: '#e2e8f0',
};

const emptyCatalog: TriggerCatalog = {
  events: [
    { type: 'player_first_join', label: 'First join' },
    { type: 'player_playtime', label: 'Lifetime playtime' },
  ],
  actions: [{ type: 'grant_items', label: 'Grant items' }],
};

type FormState = {
  name: string;
  eventType: string;
  hours: string;
  grants: GrantDraft[];
  notifyPlayer: boolean;
  message: string;
  applyToExisting: boolean;
};

const emptyForm = (): FormState => ({
  name: '',
  eventType: 'player_first_join',
  hours: '24',
  grants: [emptyGrant()],
  notifyPlayer: true,
  message: 'You received a reward.',
  applyToExisting: false,
});

function eventSummary(trigger: TriggerRecord) {
  if (trigger.eventType === 'player_first_join') return 'First join';
  if (trigger.eventType === 'player_playtime') {
    const hours = Number(trigger.eventConfig?.hours);
    return Number.isInteger(hours) ? `Playtime ≥ ${hours}h` : 'Playtime';
  }
  const level = Number(trigger.eventConfig?.level);
  if (Number.isInteger(level)) return `Level (legacy) ${level}`;
  return trigger.eventType;
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
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const [itemNames, setItemNames] = useState<string[]>([]);
  const [itemCatalogBusy, setItemCatalogBusy] = useState(false);
  const [itemCatalogSource, setItemCatalogSource] = useState('');

  const canCreate = (catalog.events?.length ?? 0) > 0;

  const load = useCallback(async () => {
    if (!orgId) return { servers: [] as ServerInstance[], triggers: [] as TriggerRecord[], selected: '', catalog: emptyCatalog };
    const rows = await api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`);
    const selected = serverId || rows[0]?.id || '';
    const nextCatalog = await api.get<TriggerCatalog>(`/api/orgs/${orgId}/triggers/catalog`).catch(() => emptyCatalog);
    const list = selected
      ? await api.get<TriggerRecord[]>(`/api/orgs/${orgId}/triggers?serverInstanceId=${encodeURIComponent(selected)}`)
      : [];
    return { servers: rows, triggers: list, selected, catalog: nextCatalog };
  }, [orgId, serverId]);

  usePoll(load, (data) => {
    setServers(data.servers);
    setTriggers(data.triggers);
    if (data.catalog) setCatalog({
      events: data.catalog.events?.length ? data.catalog.events : emptyCatalog.events,
      actions: data.catalog.actions?.length ? data.catalog.actions : emptyCatalog.actions,
    });
    if (data.selected && data.selected !== serverId) setServerId(data.selected);
    setError('');
  }, 15000, !!orgId);

  async function loadItemCatalog(refresh = false) {
    if (!orgId) return;
    setItemCatalogBusy(true);
    try {
      const response = await api.get<{ items?: string[]; source?: string }>(
        `/api/orgs/${orgId}/shop-items/game-items${refresh ? '?refresh=1' : ''}`,
      );
      setItemNames(response.items || []);
      setItemCatalogSource(response.source || '');
    } catch {
      setItemNames([]);
      setItemCatalogSource('');
    } finally {
      setItemCatalogBusy(false);
    }
  }

  async function openCreate() {
    setShowCreate(true);
    setCreateError('');
    setForm(emptyForm());
    if (!itemNames.length) void loadItemCatalog();
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!orgId || !serverId) return;
    setCreateLoading(true);
    setCreateError('');
    try {
      const items = form.grants.filter((row) => row.name.trim()).map((row) => ({ name: row.name.trim(), quantity: row.quantity }));
      await api.post(`/api/orgs/${orgId}/triggers`, {
        name: form.name.trim(),
        serverInstanceId: serverId,
        enabled: true,
        eventType: form.eventType,
        eventConfig: form.eventType === 'player_playtime' ? { hours: Number(form.hours) || 1 } : {},
        actionType: 'grant_items',
        actionConfig: {
          items,
          notifyPlayer: form.notifyPlayer,
          message: form.message.trim() || 'You received a reward.',
        },
        applyToExisting: form.applyToExisting,
      });
      setShowCreate(false);
      setForm(emptyForm());
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
          Grant items on first join or when a player reaches lifetime playtime milestones.
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
            <button style={{ ...btnPrimary, background: canCreate ? '#6366f1' : '#1e1e2a', color: canCreate ? '#fff' : '#64748b' }} disabled={!canCreate || !serverId} onClick={() => void openCreate()}>
              + Add trigger
            </button>
          </div>
        </div>

        {showCreate && (
          <form onSubmit={(event) => void handleCreate(event)} style={{ display: 'grid', gap: 12, marginBottom: '1.5rem', padding: '1rem', border: '1px solid #1e1e2a', borderRadius: 8, background: '#0d0d14' }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} placeholder="Welcome kit" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Event</label>
                <select style={inputStyle} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })}>
                  {(catalog.events.length ? catalog.events : emptyCatalog.events).map((event) => (
                    <option key={event.type} value={event.type}>{event.label}</option>
                  ))}
                </select>
              </div>
              {form.eventType === 'player_playtime' && (
                <div>
                  <label style={labelStyle}>Hours played</label>
                  <input style={inputStyle} type="number" min={1} max={10000} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} required />
                </div>
              )}
            </div>
            <GrantList
              value={form.grants}
              onChange={(grants) => setForm({ ...form, grants })}
              catalog={itemNames}
              loading={itemCatalogBusy}
              sourceLabel={itemCatalogSource}
              onRefresh={() => void loadItemCatalog(true)}
            />
            <div>
              <label style={labelStyle}>In-game message (optional)</label>
              <input style={inputStyle} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={200} placeholder="Welcome! Placeholders: {name} {hours} {items}" />
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={form.notifyPlayer} onChange={(e) => setForm({ ...form, notifyPlayer: e.target.checked })} />
              Tell the player in chat when granted
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={form.applyToExisting} onChange={(e) => setForm({ ...form, applyToExisting: e.target.checked })} />
              Apply to existing players who already qualify
            </label>
            {createError && <p style={{ color: '#f87171', margin: 0, fontSize: '0.85rem' }}>{createError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" style={btnPrimary} disabled={createLoading}>{createLoading ? 'Creating…' : 'Create trigger'}</button>
              <button type="button" style={{ ...btnPrimary, background: '#334155' }} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
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
                              <div key={fire.id}>
                                {fire.player.name} · {fire.eventKey} · {fire.status}
                                {typeof fire.attempts === 'number' ? ` · try ${fire.attempts}` : ''}
                                {fire.lastError ? ` · ${fire.lastError}` : ''}
                                {' · '}{new Date(fire.createdAt).toLocaleString()}
                              </div>
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
