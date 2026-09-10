'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, PlayerRecord, ServerAdminRecord, ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { useServerSelection } from '../../../lib/server-selection';

type JobResult = { data?: { admins?: ServerAdminRecord[] }; errorMessage?: string; output?: string };

function duration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function uuidFromIdentity(player: PlayerRecord): string | null {
  if (player.identityKey?.startsWith('uuid:')) return player.identityKey.slice(5);
  return null;
}

function normalizeAdmins(raw: unknown): ServerAdminRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name : '';
    const uuid = typeof r.uuid === 'string' ? r.uuid : typeof r.userId === 'string' ? r.userId : '';
    const level = Number(r.permissionLevel ?? r.level ?? 4);
    return {
      userId: uuid || name,
      name: name || uuid || 'op',
      permissionLevel: Number.isFinite(level) ? level : 4,
      platform: 'minecraft',
    };
  });
}

export default function PlayersPage() {
  const orgId = getStoredOrgId();
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [serverId, setServerId] = useState('');
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [admins, setAdmins] = useState<ServerAdminRecord[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'online' | 'offline' | 'admin'>('all');
  const [sort, setSort] = useState<'status' | 'name' | 'uuid' | 'ip' | 'admin' | 'session' | 'lifetime' | 'lastSeen'>('status');
  const [sortAsc, setSortAsc] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const selectServer = useServerSelection(servers, serverId, setServerId);

  useEffect(() => {
    if (!orgId) return;
    api.get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`)
      .then((rows) => setServers(rows.filter((row) => row.gameType === 'minecraft')))
      .catch((e) => setError(e.message));
  }, [orgId]);

  const waitForJob = useCallback(async (runId: string) => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const run = await api.get<{ status: string; result: JobResult | null } | null>(`/api/orgs/${orgId}/jobs/runs/${runId}`);
      if (run?.status === 'failed') throw new Error(run.result?.errorMessage || 'Agent job failed');
      if (run?.status === 'success') return (run.result || {}) as JobResult;
    }
    throw new Error('Agent job timed out');
  }, [orgId]);

  const loadPlayers = useCallback(async () => {
    if (!orgId || !serverId) return;
    try {
      setPlayers(await api.get<PlayerRecord[]>(`/api/orgs/${orgId}/players?serverInstanceId=${encodeURIComponent(serverId)}`));
      setLastRefresh(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load players');
    }
  }, [orgId, serverId]);

  const loadAdmins = useCallback(async () => {
    if (!orgId || !serverId) return;
    try {
      const queued = await api.post<{ jobRunId: string }>(`/api/orgs/${orgId}/jobs`, { serverInstanceId: serverId, type: 'PLAYER_ADMIN_LIST', payload: {} });
      const result = await waitForJob(queued.jobRunId);
      setAdmins(normalizeAdmins(result.data?.admins));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read ops.json');
    }
  }, [orgId, serverId, waitForJob]);

  useEffect(() => {
    void loadPlayers();
    const t = setInterval(() => void loadPlayers(), 5000);
    return () => clearInterval(t);
  }, [loadPlayers]);

  useEffect(() => {
    if (serverId) void loadAdmins();
  }, [serverId, loadAdmins]);

  function adminFor(player: PlayerRecord) {
    const uuid = uuidFromIdentity(player)?.toLowerCase();
    const name = player.name.toLowerCase();
    return admins.find((a) => {
      const id = a.userId.toLowerCase();
      const adminName = (a.name || '').toLowerCase();
      return (uuid && id === uuid) || adminName === name || id === name;
    });
  }

  async function moderationAction(player: PlayerRecord, type: 'PLAYER_KICK' | 'PLAYER_BAN') {
    if (!orgId) return;
    const reason = window.prompt(
      type === 'PLAYER_KICK' ? 'Kick reason:' : 'Ban reason:',
      type === 'PLAYER_KICK' ? 'Removed by administrator' : 'Banned by administrator',
    );
    if (reason === null) return;
    try {
      await api.post(`/api/orgs/${orgId}/jobs`, {
        serverInstanceId: serverId,
        type,
        payload: { player: player.name, name: player.name, identifier: player.name, reason },
      });
      setMessage(`${type === 'PLAYER_KICK' ? 'Kick' : 'Ban'} queued for ${player.name}.`);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Command failed');
    }
  }

  async function kickAll() {
    if (!orgId || !serverId || busy) return;
    const reason = window.prompt('Reason shown to every kicked player:', 'Server maintenance');
    if (reason === null) return;
    if (!confirm(`Kick all ${players.filter((p) => p.online).length} online player(s)?`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const queued = await api.post<{ jobRunId: string }>(`/api/orgs/${orgId}/jobs`, {
        serverInstanceId: serverId,
        type: 'PLAYER_KICK_ALL',
        payload: { reason },
      });
      await waitForJob(queued.jobRunId);
      await loadPlayers();
      setMessage('Kick all completed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kick all failed');
    } finally {
      setBusy(false);
    }
  }

  async function adminAction(player: PlayerRecord, promote: boolean) {
    if (!orgId || busy) return;
    const verb = promote ? 'promote' : 'demote';
    if (!confirm(`${promote ? 'Op' : 'Deop'} ${player.name}?`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const queued = await api.post<{ jobRunId: string }>(`/api/orgs/${orgId}/jobs`, {
        serverInstanceId: serverId,
        type: promote ? 'PLAYER_ADMIN_PROMOTE' : 'PLAYER_ADMIN_DEMOTE',
        payload: { player: player.name, name: player.name, identifier: player.name },
      });
      await waitForJob(queued.jobRunId);
      await loadAdmins();
      setMessage(`${player.name} ${verb}d. ops.json refreshed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${verb} player`);
    } finally {
      setBusy(false);
    }
  }

  async function syncRoster() {
    if (!orgId || !serverId || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const queued = await api.post<{ jobRunId: string }>(`/api/orgs/${orgId}/jobs`, {
        serverInstanceId: serverId,
        type: 'PLAYER_LIST_SYNC',
        payload: {},
      });
      await waitForJob(queued.jobRunId);
      await loadPlayers();
      setMessage('Roster synced from RCON list.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Roster sync failed');
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => players
    .filter((player) => {
      const admin = adminFor(player);
      if (status === 'online' && !player.online) return false;
      if (status === 'offline' && player.online) return false;
      if (status === 'admin' && !admin) return false;
      const uuid = uuidFromIdentity(player) || '';
      const text = `${player.name} ${uuid} ${player.ipAddress || ''}`.toLowerCase();
      return text.includes(query.trim().toLowerCase());
    })
    .sort((a, b) => {
      const aa = adminFor(a);
      const bb = adminFor(b);
      let result = 0;
      switch (sort) {
        case 'status': result = Number(b.online) - Number(a.online); break;
        case 'name': result = a.name.localeCompare(b.name); break;
        case 'uuid': result = (uuidFromIdentity(a) || '').localeCompare(uuidFromIdentity(b) || ''); break;
        case 'ip': result = (a.ipAddress || '').localeCompare(b.ipAddress || ''); break;
        case 'admin': result = Number(Boolean(bb)) - Number(Boolean(aa)) || (bb?.permissionLevel || 0) - (aa?.permissionLevel || 0); break;
        case 'session': result = a.sessionSeconds - b.sessionSeconds; break;
        case 'lifetime': result = a.lifetimeSeconds - b.lifetimeSeconds; break;
        case 'lastSeen': result = new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime(); break;
      }
      return (sortAsc ? result : -result) || a.name.localeCompare(b.name);
    }), [players, admins, query, status, sort, sortAsc]);

  const onlineCount = players.filter((p) => p.online).length;
  const adminCount = players.filter((p) => adminFor(p)).length;

  function actions(p: PlayerRecord, admin: ServerAdminRecord | undefined) {
    return (
      <div className="player-actions">
        <button disabled={!p.online || busy} onClick={() => moderationAction(p, 'PLAYER_KICK')} style={button('#b45309')}>Kick</button>
        <button disabled={busy} onClick={() => moderationAction(p, 'PLAYER_BAN')} style={button('#991b1b')}>Ban</button>
        {admin
          ? <button disabled={busy} onClick={() => void adminAction(p, false)} style={button('#7c2d12')}>Deop</button>
          : <button disabled={busy} onClick={() => void adminAction(p, true)} style={button('#15803d')}>Op</button>}
      </div>
    );
  }

  return (
    <div className="players-page">
      <div className="players-header">
        <div>
          <h1 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.5rem' }}>Players</h1>
          <p style={{ color: '#64748b', margin: '.25rem 0 0' }}>
            Minecraft roster from RCON <code>list</code> and join logs · refreshes every 5 seconds
            {lastRefresh ? ` · updated ${lastRefresh.toLocaleTimeString()}` : ''}
          </p>
        </div>
        <div className="players-header-actions">
          <button disabled={busy || !serverId} onClick={() => void syncRoster()} style={button('#0369a1')}>Sync roster</button>
          <button disabled={busy || !serverId} onClick={() => void kickAll()} style={button('#991b1b')}>Kick all online</button>
          <button disabled={busy || !serverId} onClick={() => { void loadPlayers(); void loadAdmins(); }} style={button('#334155')}>Refresh</button>
          <select aria-label="Server" value={serverId} onChange={(e) => selectServer(e.target.value)} style={{ background: '#111118', color: '#e2e8f0', border: '1px solid #252532', borderRadius: 6, padding: '.5rem', maxWidth: '100%' }}>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {error && <div style={{ color: '#f87171', marginBottom: 10 }}>{error}</div>}
      {message && <div style={{ color: '#4ade80', marginBottom: 10 }}>{message}</div>}
      <div className="player-summary-grid">
        <Summary label="Online now" value={onlineCount} color="#4ade80" />
        <Summary label="Known players" value={players.length} color="#38bdf8" />
        <Summary label="Operators" value={adminCount} color="#fbbf24" />
        <Summary label="Showing" value={visible.length} color="#a78bfa" />
      </div>
      <div className="player-toolbar">
        <input aria-label="Search players" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, UUID, or IP…" />
        <select aria-label="Player status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">All players</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="admin">Operators</option>
        </select>
        <select aria-label="Sort players" value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setSortAsc(e.target.value === 'status' ? false : true); }}>
          <option value="status">Online first</option>
          <option value="name">Name</option>
          <option value="uuid">UUID</option>
          <option value="ip">IP address</option>
          <option value="admin">Operator status</option>
          <option value="session">Session playtime</option>
          <option value="lifetime">Lifetime playtime</option>
          <option value="lastSeen">Last seen</option>
        </select>
        <button type="button" onClick={() => setSortAsc((v) => !v)} style={button('#334155')} title="Toggle sort direction">{sortAsc ? 'Asc ▲' : 'Desc ▼'}</button>
        {(query || status !== 'all') && <button onClick={() => { setQuery(''); setStatus('all'); }} style={button('#334155')}>Clear</button>}
      </div>
      <div className="player-card-list">
        {visible.length === 0 ? (
          <div className="player-card player-card-empty">
            {players.length ? 'No players match current filters.' : 'No players discovered yet. Sync roster or wait for join log / poll.'}
          </div>
        ) : visible.map((p) => {
          const admin = adminFor(p);
          const uuid = uuidFromIdentity(p);
          return (
            <article key={p.id} className="player-card">
              <div className="player-card-main">
                <div className="player-card-head">
                  <div>
                    <strong>{p.name}</strong>
                    <div className="player-status" style={{ color: p.online ? '#4ade80' : '#64748b' }}>
                      {p.online ? '● Online' : '○ Offline'}
                      {admin ? ` · Op L${admin.permissionLevel}` : ''}
                    </div>
                  </div>
                </div>
                <div className="player-meta">
                  <code className="player-id">{uuid || p.identityKey || 'No UUID yet'}</code>
                  <span className="player-ip">IP {p.ipAddress || '—'}</span>
                  <span className="player-seen">Seen {new Date(p.lastSeenAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="player-stat-grid">
                <span><small>Session</small>{duration(p.sessionSeconds)}</span>
                <span><small>Lifetime</small>{duration(p.lifetimeSeconds)}</span>
                <span><small>Identity</small>{uuid ? 'UUID' : p.identityKey.startsWith('name:') ? 'Name' : 'Other'}</span>
              </div>
              {actions(p, admin)}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Summary({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="player-summary"><small>{label}</small><strong style={{ color }}>{value}</strong></div>;
}
function button(background: string) {
  return { background, color: 'white', border: 0, borderRadius: 5, padding: '.4rem .6rem', cursor: 'pointer' as const };
}
