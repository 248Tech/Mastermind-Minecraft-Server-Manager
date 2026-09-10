'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '../lib/auth';

type LandingServer = {
  id: string;
  name: string;
  hostName: string;
  playersOnline: number;
  shopPath: string;
  mapPath: string;
};

type LandingPayload = {
  ok?: boolean;
  orgName?: string | null;
  headline?: string;
  servers?: LandingServer[];
  message?: string;
};

export default function Home() {
  const router = useRouter();
  const [landing, setLanding] = useState<LandingPayload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoggedIn()) {
      router.replace('/dashboard');
      return;
    }
    fetch('/api/public/landing', { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({})) as LandingPayload;
        if (!res.ok) throw new Error(data.message || 'Could not load hosting status');
        setLanding(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load hosting status'));
  }, [router]);

  const servers = landing?.servers ?? [];
  const orgName = landing?.orgName || 'Mastermind';
  const headline = landing?.headline || (landing ? `${orgName} — no servers online` : 'Checking hosting status…');
  const ready = Boolean(landing) && !error;
  const multi = servers.length > 1;

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at 30% 20%, rgba(249,115,22,0.10) 0%, #0a0a0f 60%)',
      flexDirection: 'column', gap: '1.5rem', padding: '2rem',
    }}>
      <div style={{
        background: '#111118', border: '1px solid #1e1e2a', borderRadius: 16,
        padding: '2.5rem 3rem', maxWidth: 560, width: '100%', textAlign: 'center',
      }}>
        <img src="/mastermind-logo.png" alt="Mastermind" style={{ width: 88, height: 88, objectFit: 'cover', objectPosition: 'center 42%', borderRadius: 14, display: 'block', margin: '0 auto 1.25rem', boxShadow: '0 0 32px rgba(249,115,22,.4)' }} />
        <h1 style={{ margin: '0 0 0.375rem', fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>
          {orgName}
        </h1>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.875rem', color: '#64748b' }}>
          Minecraft community portal
        </p>

        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '0.75rem', textAlign: 'left',
          padding: '0.875rem 1rem', borderRadius: 8,
          background: error ? 'rgba(239,68,68,0.06)' : ready ? 'rgba(34,197,94,0.06)' : 'rgba(100,116,139,0.06)',
          border: `1px solid ${error ? 'rgba(239,68,68,0.2)' : ready ? 'rgba(34,197,94,0.2)' : '#1e1e2a'}`,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 6,
            background: error ? '#f87171' : ready && servers.length ? '#4ade80' : '#64748b',
            boxShadow: ready && servers.length ? '0 0 8px #4ade80' : undefined,
          }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: error ? '#f87171' : ready ? '#e2e8f0' : '#94a3b8', lineHeight: 1.4 }}>
              {error || headline}
            </div>
            {!error && ready && servers.length === 0 && (
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 4 }}>Check back soon — game hosts come online with the agent heartbeat.</div>
            )}
          </div>
        </div>

        {servers.length === 1 && (
          <div style={{ marginTop: '1.25rem' }}>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#94a3b8' }}>
              {servers[0].playersOnline} player{servers[0].playersOnline === 1 ? '' : 's'} online
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', justifyContent: 'center' }}>
              <a href={servers[0].shopPath} style={secondaryCta}>View Shop</a>
              <a href={servers[0].mapPath} style={secondaryCta}>View Map</a>
              <a href="/login" style={primaryCta}>Sign In →</a>
            </div>
          </div>
        )}

        {multi && (
          <div style={{ marginTop: '1.25rem', display: 'grid', gap: '0.75rem', textAlign: 'left' }}>
            {servers.map((server) => (
              <div key={server.id} style={serverCard}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: '#f1f5f9', fontWeight: 700 }}>{server.name}</div>
                  <div style={{ color: '#64748b', fontSize: '0.78rem', marginTop: 2 }}>
                    {server.playersOnline} online · host {server.hostName}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <a href={server.shopPath} style={smallCta}>View Shop</a>
                  <a href={server.mapPath} style={smallCta}>View Map</a>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
              <a href="/login" style={primaryCta}>Sign In →</a>
            </div>
          </div>
        )}

        {!error && servers.length === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', justifyContent: 'center', marginTop: '1.5rem' }}>
            <a href="/player/shop" style={secondaryCta}>View Shop</a>
            <a href="/player/map" style={secondaryCta}>View Map</a>
            <a href="/login" style={primaryCta}>Sign In →</a>
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', justifyContent: 'center', marginTop: '1.5rem' }}>
            <a href="/player/shop" style={secondaryCta}>View Shop</a>
            <a href="/player/map" style={secondaryCta}>View Map</a>
            <a href="/login" style={primaryCta}>Sign In →</a>
          </div>
        )}
      </div>
    </div>
  );
}

const secondaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.65rem 1.35rem',
  background: '#16161f',
  color: '#e2e8f0',
  textDecoration: 'none',
  borderRadius: 8,
  fontSize: '0.875rem',
  fontWeight: 600,
  border: '1px solid #2a2a38',
};

const primaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.65rem 1.35rem',
  background: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)',
  color: '#fff',
  textDecoration: 'none',
  borderRadius: 8,
  fontSize: '0.875rem',
  fontWeight: 600,
  boxShadow: '0 4px 16px rgba(249,115,22,0.3)',
};

const smallCta: React.CSSProperties = {
  ...secondaryCta,
  padding: '0.45rem 0.85rem',
  fontSize: '0.8rem',
};

const serverCard: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  padding: '0.85rem 1rem',
  borderRadius: 10,
  background: '#0d0d14',
  border: '1px solid #252532',
};
