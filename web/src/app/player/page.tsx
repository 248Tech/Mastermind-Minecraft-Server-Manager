'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Profile = { name: string; steamId?: string | null; serverName: string; auth?: string; isAdmin?: boolean; donation?: { supporter?: boolean } };
export default function PlayerPortal() {
  return (
    <Suspense fallback={<main style={shell}><section style={card}><p style={{ color: '#94a3b8' }}>Loading player portal…</p></section></main>}>
      <PlayerPortalContent />
    </Suspense>
  );
}
function PlayerPortalContent() {
  const query = useSearchParams();
  const server = query.get('server') || '';
  const error = query.get('error') || '';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checking, setChecking] = useState(true);
  const [requestFile, setRequestFile] = useState<File | null>(null);
  const [requestDescription, setRequestDescription] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  useEffect(() => {
    fetch('/api/player-auth/me', { cache: 'no-store' }).then(async (r) => {
      if (r.ok) setProfile(await r.json());
    }).finally(() => setChecking(false));
  }, []);
  const login = `/api/player-auth/steam/start${server ? `?server=${encodeURIComponent(server)}` : ''}`;
  const steam = profile && profile.auth !== 'name';
  const steamLast4 = profile?.steamId ? profile.steamId.slice(-4) : '';
  const canBrowseMods = Boolean(profile?.isAdmin || profile?.donation?.supporter);
  async function submitModRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestFile || !requestDescription.trim() || requestBusy) return;
    setRequestBusy(true); setRequestMessage('');
    const form = new FormData();
    form.append('file', requestFile, requestFile.name);
    form.append('description', requestDescription.trim());
    try {
      const response = await fetch('/api/player-auth/mod-request', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Mod request failed');
      setRequestMessage('Submitted for staff approval. Thank you for the recommendation!');
      setRequestFile(null); setRequestDescription('');
      const input = document.getElementById('player-mod-file') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (error) { setRequestMessage(error instanceof Error ? error.message : 'Mod request failed'); }
    finally { setRequestBusy(false); }
  }
  return (
    <main style={shell}>
      <section style={card}>
        <img src="/mastermind-logo.png" alt="Mastermind" style={{ width: 82, height: 82, objectFit: 'cover', objectPosition: 'center 42%', borderRadius: 16, boxShadow: '0 0 30px rgba(249,115,22,.35)' }} />
        <p style={eyebrow}>BUILDER FRIENDLY PvE</p>
        <h1 style={{ margin: 0, color: '#f8fafc', fontSize: '1.8rem' }}>Player Portal</h1>
        <p style={{ color: '#94a3b8', lineHeight: 1.55, maxWidth: 480 }}>
          Browse the donator shop without signing in. To donate, sign in through Steam or create a shop account that matches your in-game name. Steam is still required for live map players, stats, and inventory.
        </p>
        {error && <div style={errorBox}>{error}</div>}
        {checking ? (
          <p style={{ color: '#64748b' }}>Checking session…</p>
        ) : profile ? (
          <div>
            <div style={profileBox}>
              Signed in as <strong>{profile.name}</strong>
              <br />
              <small>
                {profile.serverName}
                {steam && steamLast4 ? ` · Steam ending ${steamLast4}` : ' · in-game shop account'}
              </small>
            </div>
            {steam && <a href="/player/profile" style={primary}>View profile</a>}
            <a href="/player/shop" style={primary}>Donate</a>
            <a href="/player/map" style={primary}>Open live map</a>
            {canBrowseMods && <a href="/player/mods" style={primary}>View / download mods</a>}
            <details style={requestBox}>
              <summary style={{ cursor: 'pointer', color: '#fed7aa', fontWeight: 700 }}>Request a mod</summary>
              <p style={helpText}>Recommend a ZIP mod for staff review. Your verified in-game name is recorded with the request.</p>
              <form onSubmit={submitModRequest} style={{ display: 'grid', gap: 8, textAlign: 'left' }}>
                <input id="player-mod-file" type="file" accept=".zip,application/zip" onChange={(e) => setRequestFile(e.target.files?.[0] || null)} style={input} />
                <textarea value={requestDescription} onChange={(e) => setRequestDescription(e.target.value)} maxLength={500} required rows={3} placeholder="What does this mod add or improve?" style={{ ...input, resize: 'vertical' }} />
                <button type="submit" disabled={requestBusy || !requestFile} style={{ ...primary, border: 0, cursor: requestBusy ? 'wait' : 'pointer' }}>{requestBusy ? 'Submitting…' : 'Submit for approval'}</button>
              </form>
              {requestMessage && <p style={{ color: requestMessage.includes('Submitted') ? '#86efac' : '#fecaca', fontSize: '.85rem' }}>{requestMessage}</p>}
            </details>
            <button onClick={() => fetch('/api/player-auth/logout', { method: 'POST' }).then(() => location.reload())} style={secondary}>Sign out</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            <a href="/player/shop" style={primary}>View Shop</a>
            <a href="/player/map" style={{ ...secondary, display: 'inline-block', textDecoration: 'none' }}>View Map</a>
            <a href={login} style={steamButton}><span style={{ fontSize: '1.25rem' }}>◉</span> Sign in through Steam</a>
          </div>
        )}
        <p style={{ color: '#475569', fontSize: '.75rem', marginTop: 18 }}>Mastermind never receives your Steam password. Steam verifies your identity and returns only your SteamID.</p>
      </section>
    </main>
  );
}
const shell: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem', background: 'radial-gradient(circle at 50% 15%,rgba(249,115,22,.14),#08080d 55%)' };
const card: React.CSSProperties = { width: 'min(100%,560px)', textAlign: 'center', padding: '2.5rem', background: 'rgba(17,17,24,.96)', border: '1px solid #33261e', borderRadius: 18, boxShadow: '0 22px 70px rgba(0,0,0,.45)' };
const eyebrow: React.CSSProperties = { color: '#f97316', fontSize: '.72rem', letterSpacing: '.16em', fontWeight: 800, margin: '1rem 0 .35rem' };
const steamButton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 9, color: 'white', background: 'linear-gradient(135deg,#1b2838,#2a475e)', padding: '.8rem 1.2rem', borderRadius: 8, textDecoration: 'none', fontWeight: 700, marginTop: 8 };
const primary: React.CSSProperties = { display: 'inline-block', color: 'white', background: '#ea580c', padding: '.7rem 1rem', borderRadius: 7, textDecoration: 'none', fontWeight: 700, marginRight: 8 };
const secondary: React.CSSProperties = { color: '#cbd5e1', background: '#27272f', padding: '.7rem 1rem', borderRadius: 7, border: '1px solid #3f3f49', cursor: 'pointer' };
const profileBox: React.CSSProperties = { color: '#e2e8f0', background: '#0b1220', border: '1px solid #1e3a5f', borderRadius: 8, padding: 12, margin: '0 auto 14px' };
const errorBox: React.CSSProperties = { color: '#fecaca', background: '#3f1d25', border: '1px solid #7f1d1d', borderRadius: 8, padding: 10, marginBottom: 12 };
const requestBox: React.CSSProperties = { textAlign: 'left', color: '#cbd5e1', background: '#111827', border: '1px solid #374151', borderRadius: 10, padding: 12, margin: '14px auto', maxWidth: 460 };
const helpText: React.CSSProperties = { color: '#94a3b8', fontSize: '.82rem', lineHeight: 1.45 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', color: '#e2e8f0', background: '#0b1220', border: '1px solid #334155', borderRadius: 6, padding: '.55rem' };
