'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { PortalFrame } from '../PortalFrame';

type Profile = {
  name: string;
  steamId?: string | null;
  serverName?: string;
  online?: boolean;
  auth?: string;
  isAdmin?: boolean;
  mapEmbedUrl?: string | null;
  donation?: { supporter?: boolean; checkoutEnabled?: boolean };
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
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch('/api/player-auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to view the map');
        return response.json() as Promise<Profile>;
      })
      .then((next) => {
        if (!active) return;
        setProfile(next);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setProfile(null);
        setError(err instanceof Error ? err.message : 'Could not load map');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const mapUrl = profile?.mapEmbedUrl?.trim() || '';

  return (
    <PortalFrame profile={profile} wide maxWidth={1400}>
      {loading && <p style={{ color: '#94a3b8', padding: '2rem' }}>Loading player map…</p>}
      {!loading && error && <p style={{ color: '#f87171', padding: '2rem' }}>{error}</p>}
      {!loading && !error && !mapUrl && (
        <div style={emptyBox}>
          <strong style={{ color: '#e2e8f0', display: 'block', marginBottom: 8 }}>Map not configured</strong>
          An administrator needs to set a BlueMap or Dynmap URL for this Minecraft server.
        </div>
      )}
      {!loading && !error && mapUrl && (
        <div style={{ padding: '12px 18px 18px', height: 'calc(100vh - 64px)', boxSizing: 'border-box' }}>
          <iframe
            title={`${profile?.serverName || 'Server'} map`}
            src={mapUrl}
            style={{
              width: '100%',
              height: '100%',
              border: '1px solid #292936',
              borderRadius: 10,
              background: '#0a0a10',
            }}
            allow="fullscreen"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </PortalFrame>
  );
}
