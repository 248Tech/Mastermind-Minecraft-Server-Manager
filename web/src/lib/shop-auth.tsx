'use client';

import { useState } from 'react';
import { shopAlert, shopInput, shopPrimary } from './shop-player';
import './shop-ui.css';

export function steamShopLoginUrl(next: string) {
  return `/api/player-auth/steam/start?next=${encodeURIComponent(next)}`;
}

export function ShopAuthGate({ next, title }: { next: string; title?: string }) {
  const [mode, setMode] = useState<'choose' | 'login' | 'register'>('choose');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(path: 'login' | 'register') {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`/api/player-auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, password, next }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string; next?: string };
      if (!response.ok) throw new Error(data.message || 'Could not sign in');
      location.href = typeof data.next === 'string' ? data.next : next;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
      setBusy(false);
    }
  }

  return (
    <aside className="shop-auth-gate">
      <p style={{ color: '#f97316', fontSize: 11, letterSpacing: '.14em', fontWeight: 800, margin: '0 0 6px' }}>CONTINUE TO DONATE</p>
      <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>{title || 'Sign in to donate'}</h2>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 13, lineHeight: 1.5 }}>
        Browse without an account. To donate (and receive In-Game Gifts via <code>give</code>), sign in with your Minecraft name — or optionally through Steam.
      </p>
      {error && <div style={{ ...shopAlert, marginBottom: 12 }}>{error}</div>}
      {mode === 'choose' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <button type="button" style={{ ...shopPrimary, border: 0, cursor: 'pointer' }} onClick={() => setMode('login')}>Sign in with Minecraft name</button>
          <button type="button" className="shop-card-btn" onClick={() => setMode('register')}>Create Minecraft name account</button>
          <a href={steamShopLoginUrl(next)} className="shop-card-btn shop-card-btn-muted" style={{ textDecoration: 'none', textAlign: 'center' }}>Optional: Steam</a>
        </div>
      )}
      {mode !== 'choose' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(mode);
          }}
          style={{ display: 'grid', gap: 10 }}
        >
          <label style={{ color: '#94a3b8', fontSize: 12 }}>
            Minecraft name
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required maxLength={16} style={{ ...shopInput, marginTop: 6 }} />
          </label>
          <label style={{ color: '#94a3b8', fontSize: 12 }}>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} style={{ ...shopInput, marginTop: 6 }} />
          </label>
          <button type="submit" disabled={busy} style={{ ...shopPrimary, opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
          <button type="button" className="shop-card-btn shop-card-btn-muted" onClick={() => { setMode('choose'); setError(''); }}>Back</button>
          <p style={{ color: '#64748b', fontSize: 12, margin: 0, lineHeight: 1.45 }}>
            {mode === 'register'
              ? 'Join the Minecraft server once first so your name is known, then set a portal password. Gifts are delivered with RCON give when you are online.'
              : 'Use the password you created for this Minecraft name.'}
          </p>
        </form>
      )}
    </aside>
  );
}
