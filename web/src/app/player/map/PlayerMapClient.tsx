'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { PortalFrame } from '../PortalFrame';

type PublicMap = {
  ok?: boolean;
  serverName?: string;
  mapEmbedUrl?: string | null;
  configured?: boolean;
  message?: string;
};

const emptyBox: CSSProperties = {
  margin: '2rem auto',
  maxWidth: 520,
  padding: '2rem 1.5rem',
  background: '#111118',
  border: '1px solid #292936',
  borderRadius: 10,
  color: '#94a3b8',
  textAlign: 'center',
  lineHeight: 1.55,
};

export default function PlayerMapClient() {
  const [map, setMap] = useState<PublicMap | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/public/map', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as PublicMap;
        if (!response.ok) throw new Error(data.message || 'Could not load map');
        return data;
      })
      .then((data) => {
        if (!active) return;
        setMap(data);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load map');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const mapUrl = map?.mapEmbedUrl?.trim() || '';

  return (
    <PortalFrame>
      <div style={{ padding: '1.25rem 1rem 2rem', maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 6px', color: '#f1f5f9', fontSize: '1.35rem' }}>
          {map?.serverName ? `${map.serverName} map` : 'Live map'}
        </h1>
        <p style={{ margin: '0 0 1rem', color: '#64748b', fontSize: '.85rem' }}>
          Public BlueMap / Dynmap embed for this server.
        </p>
        {loading && <p style={{ color: '#94a3b8' }}>Loading map…</p>}
        {error && <div style={emptyBox}>{error}</div>}
        {!loading && !error && !mapUrl && (
          <div style={emptyBox}>
            <strong style={{ color: '#e2e8f0' }}>Map not configured</strong>
            <p style={{ margin: '8px 0 0' }}>
              ATM10 does not ship a web map by default. Install BlueMap (or Dynmap), expose it on a
              public URL, then set <em>Live map URL</em> under Servers → Manage in the dashboard.
            </p>
            <p style={{ margin: '12px 0 0', fontSize: 13 }}>
              Loopback URLs like <code>http://127.0.0.1:8100</code> only work on the game host — use
              your public host or a reverse proxy.
            </p>
          </div>
        )}
        {!loading && mapUrl && (
          <iframe
            title={`${map?.serverName || 'Server'} live map`}
            src={mapUrl}
            style={{
              width: '100%',
              minHeight: '70vh',
              border: '1px solid #1e1e2a',
              borderRadius: 10,
              background: '#0a0a10',
            }}
            allow="fullscreen"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </PortalFrame>
  );
}
