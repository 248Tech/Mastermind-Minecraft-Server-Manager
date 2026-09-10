'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Profile = {
  name: string;
  steamId?: string | null;
  uuid?: string | null;
  serverName: string;
  auth?: string;
  isAdmin?: boolean;
  donation?: { supporter?: boolean };
};

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
  const [authMode, setAuthMode] = useState<'choose' | 'login' | 'register'>('choose');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [requestFile, setRequestFile] = useState<File | null>(null);
  const [requestDescription, setRequestDescription] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');

  useEffect(() => {
    fetch('/api/player-auth/me', { cache: 'no-store' }).then(async (r) => {
      if (r.ok) setProfile(await r.json());
    }).finally(() => setChecking(false));
  }, []);

  const steamLogin = `/api/player-auth/steam/start${server ? `?server=${encodeURIComponent(server)}` : ''}`;
  const isName = profile?.auth === 'name';
  const canBrowseMods = Boolean(profile?.isAdmin || profile?.donation?.supporter);

  async function submitAuth(path: 'login' | 'register') {
    setAuthError('');
    setAuthBusy(true);
    try {
      const response = await fetch(`/api/player-auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, password, next: '/player' }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string; next?: string };
      if (!response.ok) throw new Error(data.message || 'Could not sign in');
      location.href = typeof data.next === 'string' ? data.next : '/player';
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Could not sign in');
      setAuthBusy(false);
    }
  }

  async function submitModRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!requestFile || !requestDescription.trim() || requestBusy) return;
    setRequestBusy(true);
    setRequestMessage('');
    const form = new FormData();
    form.append('file', requestFile, requestFile.name);
    form.append('description', requestDescription.trim());
    try {
      const response = await fetch('/api/player-auth/mod-request', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Mod request failed');
      setRequestMessage('Submitted for staff approval. Thank you for the recommendation!');
      setRequestFile(null);
      setRequestDescription('');
      const input = document.getElementById('player-mod-file') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch (err) {
      setRequestMessage(err instanceof Error ? err.message : 'Mod request failed');
    } finally {
      setRequestBusy(false);
    }
  }

  return (
    <main style={shell}>
      <section style={card}>
        <img src="/mastermind-logo.png" alt="Mastermind" style={{ width: 82, height: 82, objectFit: 'cover', objectPosition: 'center 42%', borderRadius: 16, boxShadow: '0 0 30px rgba(249,115,22,.35)' }} />
        <p style={eyebrow}>MINECRAFT PLAYER PORTAL</p>
        <h1 style={{ margin: 0, color: '#f8fafc', fontSize: '1.8rem' }}>Player Portal</h1>
        <p style={{ color: '#94a3b8', lineHeight: 1.55, maxWidth: 480 }}>
          Browse the donator shop freely. Sign in with your Minecraft name (after joining the server once) to donate and receive In-Game Gifts via RCON <code>give</code>. Steam sign-in remains optional.
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
                {isName ? ' · Minecraft name account' : profile.steamId ? ` · Steam ending ${profile.steamId.slice(-4)}` : ''}
                {profile.uuid ? ` · ${profile.uuid}` : ''}
              </small>
            </div>
            <a href="/player/profile" style={primary}>View profile</a>
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
          <div style={{ display: 'grid', gap: 10, justifyItems: 'stretch', maxWidth: 360, margin: '0 auto' }}>
            <a href="/player/shop" style={{ ...primary, textAlign: 'center', marginRight: 0 }}>View Shop</a>
            <a href="/player/map" style={{ ...secondary, display: 'block', textDecoration: 'none', textAlign: 'center' }}>View Map</a>
            {authMode === 'choose' && (
              <>
                <button type="button" onClick={() => setAuthMode('login')} style={{ ...primary, border: 0, cursor: 'pointer', marginRight: 0, background: '#15803d' }}>Sign in with Minecraft name</button>
                <button type="button" onClick={() => setAuthMode('register')} style={{ ...secondary, cursor: 'pointer' }}>Create Minecraft name account</button>
                <a href={steamLogin} style={{ ...steamButton, justifyContent: 'center' }}><span style={{ fontSize: '1.25rem' }}>◉</span> Optional: Steam</a>
              </>
            )}
            {authMode !== 'choose' && (
              <form
                onSubmit={(e) => { e.preventDefault(); void submitAuth(authMode); }}
                style={{ display: 'grid', gap: 10, textAlign: 'left' }}
              >
                {authError && <div style={errorBox}>{authError}</div>}
                <label style={{ color: '#94a3b8', fontSize: 12 }}>
                  Minecraft name
                  <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required maxLength={16} style={{ ...input, marginTop: 6 }} />
                </label>
                <label style={{ color: '#94a3b8', fontSize: 12 }}>
                  Password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} style={{ ...input, marginTop: 6 }} />
                </label>
                <button type="submit" disabled={authBusy} style={{ ...primary, border: 0, cursor: 'pointer', marginRight: 0, opacity: authBusy ? 0.7 : 1 }}>
                  {authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
                </button>
                <button type="button" onClick={() => { setAuthMode('choose'); setAuthError(''); }} style={{ ...secondary, cursor: 'pointer' }}>Back</button>
                <p style={{ color: '#64748b', fontSize: 12, margin: 0, lineHeight: 1.45 }}>
                  {authMode === 'register'
                    ? 'Join the Minecraft server once first so your name is known, then create a portal password.'
                    : 'Use the password you created for this Minecraft name.'}
                </p>
              </form>
            )}
          </div>
        )}
        <p style={{ color: '#475569', fontSize: '.75rem', marginTop: 18 }}>
          Name accounts never receive your Minecraft password — only a portal password you choose. Steam OpenID (optional) never shares your Steam password either.
        </p>
      </section>
    </main>
  );
}

const shell: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '1.5rem', background: 'radial-gradient(circle at 50% 15%,rgba(249,115,22,.14),#08080d 55%)' };
const card: React.CSSProperties = { width: 'min(100%,560px)', textAlign: 'center', padding: '2.5rem', background: 'rgba(17,17,24,.96)', border: '1px solid #33261e', borderRadius: 18, boxShadow: '0 22px 70px rgba(0,0,0,.45)' };
const eyebrow: React.CSSProperties = { color: '#f97316', fontSize: '.72rem', letterSpacing: '.16em', fontWeight: 800, margin: '1rem 0 .35rem' };
const steamButton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 9, color: 'white', background: 'linear-gradient(135deg,#1b2838,#2a475e)', padding: '.8rem 1.2rem', borderRadius: 8, textDecoration: 'none', fontWeight: 700 };
const primary: React.CSSProperties = { display: 'inline-block', color: 'white', background: '#ea580c', padding: '.7rem 1rem', borderRadius: 7, textDecoration: 'none', fontWeight: 700, marginRight: 8 };
const secondary: React.CSSProperties = { color: '#cbd5e1', background: '#27272f', padding: '.7rem 1rem', borderRadius: 7, border: '1px solid #3f3f49', cursor: 'pointer' };
const profileBox: React.CSSProperties = { color: '#e2e8f0', background: '#0b1220', border: '1px solid #1e3a5f', borderRadius: 8, padding: 12, margin: '0 auto 14px' };
const errorBox: React.CSSProperties = { color: '#fecaca', background: '#3f1d25', border: '1px solid #7f1d1d', borderRadius: 8, padding: 10, marginBottom: 12 };
const requestBox: React.CSSProperties = { textAlign: 'left', color: '#cbd5e1', background: '#111827', border: '1px solid #374151', borderRadius: 10, padding: 12, margin: '14px auto', maxWidth: 460 };
const helpText: React.CSSProperties = { color: '#94a3b8', fontSize: '.82rem', lineHeight: 1.45 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', color: '#e2e8f0', background: '#0b1220', border: '1px solid #334155', borderRadius: 6, padding: '.55rem' };
