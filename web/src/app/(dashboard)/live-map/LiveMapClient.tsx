'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { api, type ServerInstance } from '../../../lib/api';
import { getStoredOrgId } from '../../../lib/auth';
import { useServerSelection } from '../../../lib/server-selection';

const shell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  height: 'calc(100vh - 7rem)',
  minHeight: 420,
};

const selectStyle: CSSProperties = {
  background: '#0d0d14',
  border: '1px solid #252532',
  borderRadius: 6,
  padding: '.45rem .65rem',
  color: '#e2e8f0',
  minWidth: 200,
};

const emptyBox: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '2rem',
  background: '#111118',
  border: '1px solid #1e1e2a',
  borderRadius: 10,
  color: '#94a3b8',
  textAlign: 'center',
};

export default function LiveMapClient() {
  const orgId = getStoredOrgId();
  const [servers, setServers] = useState<ServerInstance[]>([]);
  const [serverId, setServerId] = useState('');
  const [error, setError] = useState('');
  const selectServer = useServerSelection(servers, serverId, setServerId);
  const server = servers.find((row) => row.id === serverId) ?? null;
  const mapUrl = server?.mapEmbedUrl?.trim() || '';

  useEffect(() => {
    if (!orgId) return;
    api
      .get<ServerInstance[]>(`/api/orgs/${orgId}/server-instances`)
      .then((rows) => {
        const game = rows.filter((row) => row.gameType === 'minecraft');
        setServers(game);
        setError(game.length ? '' : 'No Minecraft server found');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load servers'));
  }, [orgId]);

  if (!orgId) {
    return <p style={{ color: '#f87171' }}>Select an organization first.</p>;
  }

  return (
    <div style={shell}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, color: '#f1f5f9', fontSize: '1.35rem' }}>Live map</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '.85rem' }}>
            Embeds BlueMap or Dynmap from the selected server&apos;s live map URL.
          </p>
        </div>
        {servers.length > 0 && (
          <label style={{ color: '#94a3b8', fontSize: '.82rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            Server
            <select
              value={serverId}
              onChange={(event) => selectServer(event.target.value)}
              style={selectStyle}
            >
              {servers.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p style={{ color: '#f87171', margin: 0 }}>{error}</p>}

      {!error && !mapUrl && (
        <div style={emptyBox}>
          <strong style={{ color: '#e2e8f0' }}>No live map URL configured</strong>
          <p style={{ margin: 0, maxWidth: 480, lineHeight: 1.5 }}>
            Set a BlueMap or Dynmap embed URL on the server settings page
            {server ? (
              <>
                {' '}(<a href={`/servers/${server.id}`} style={{ color: '#818cf8' }}>{server.name}</a>)
              </>
            ) : null}
            , then return here.
          </p>
          {server && (
            <a href={`/servers/${server.id}`} style={{ color: '#818cf8' }}>Open server settings</a>
          )}
        </div>
      )}

      {mapUrl && (
        <iframe
          title={`${server?.name || 'Server'} live map`}
          src={mapUrl}
          style={{
            flex: 1,
            width: '100%',
            border: '1px solid #1e1e2a',
            borderRadius: 10,
            background: '#0a0a10',
          }}
          allow="fullscreen"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}
