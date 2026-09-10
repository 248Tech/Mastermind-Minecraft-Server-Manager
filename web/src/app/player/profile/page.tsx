'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PortalFrame } from '../PortalFrame';
import './profile.css';

type Donation = {
  checkoutEnabled?: boolean;
  supporter?: boolean;
  supporterSince?: string | null;
  totalDonatedCents?: number;
  steamLast4?: string;
  recent?: Array<{ amountCents: number; at: string }>;
};
type Profile = {
  name: string;
  steamId: string;
  serverName: string;
  online: boolean;
  auth?: 'steam' | 'name';
  isAdmin?: boolean;
  stats?: {
    sessionSeconds: number;
    lifetimeSeconds: number;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  location: { x: number; y: number | null; z: number; lastLogoutAt: string | null; source: string } | null;
  donation: Donation;
};
const PRESETS = [500, 1000, 2500, 5000];

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function when(value?: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString();
}

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function coords(position: { x: number; y?: number | null; z: number }) {
  return `${Math.round(position.x)}, ${Math.round(position.y ?? 0)}, ${Math.round(position.z)}`;
}

function isStripeCheckoutUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'checkout.stripe.com' || parsed.hostname.endsWith('.stripe.com'));
  } catch {
    return false;
  }
}

export default function PlayerProfilePage() {
  return (
    <Suspense fallback={<PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading your profile…</p></PortalFrame>}>
      <PlayerProfileContent />
    </Suspense>
  );
}

function PlayerProfileContent() {
  const query = useSearchParams();
  const donationResult = query.get('donation');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [amountCents, setAmountCents] = useState(1000);
  const [custom, setCustom] = useState('');
  const [donating, setDonating] = useState(false);
  const [donateError, setDonateError] = useState('');

  useEffect(() => {
    fetch('/api/player-auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          setError('Sign in with your Minecraft name to view your profile.');
          return;
        }
        if (!response.ok) throw new Error('Could not load your profile');
        setProfile(await response.json() as Profile);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your profile'))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return <PortalFrame profile={null}><p className="pp-help">Loading your profile…</p></PortalFrame>;
  }
  if (error || !profile) {
    return (
      <PortalFrame profile={null}>
        <p className="pp-flash pp-flash-bad">{error || 'Sign in with your Minecraft name to view your profile.'}</p>
        <a className="pp-btn pp-btn-primary" href="/player">Back to portal sign-in</a>
      </PortalFrame>
    );
  }

  const stats = profile.stats || {
    sessionSeconds: 0,
    lifetimeSeconds: 0,
    firstSeenAt: '',
    lastSeenAt: '',
  };
  const donation = profile.donation;
  const selectedCents = custom.trim() ? Math.round(Number(custom) * 100) : amountCents;
  const checkoutReady = Boolean(donation?.checkoutEnabled);

  async function donate() {
    setDonateError('');
    if (!Number.isInteger(selectedCents) || selectedCents < 500 || selectedCents > 50000) {
      setDonateError('Choose an amount between $5 and $500.');
      return;
    }
    setDonating(true);
    try {
      const response = await fetch('/api/player-auth/donations/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountCents: selectedCents }),
      });
      const data = await response.json().catch(() => ({})) as { url?: string; message?: string };
      if (!response.ok) throw new Error(data.message || 'Could not start checkout');
      if (typeof data.url !== 'string' || !isStripeCheckoutUrl(data.url)) throw new Error('Checkout is unavailable');
      location.href = data.url;
    } catch (e) {
      setDonateError(e instanceof Error ? e.message : 'Could not start checkout');
      setDonating(false);
    }
  }

  return (
    <PortalFrame profile={profile}>
      <div className="pp">
        {profile.isAdmin && (
          <div className="pp-card" style={{ borderColor: '#4f46e5', background: 'linear-gradient(90deg, rgba(79,70,229,.18), #111118)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#c4b5fd', fontSize: 13 }}>Administrator access detected for this player.</span>
            <a className="pp-btn pp-btn-ghost" href="/">Open admin dashboard</a>
          </div>
        )}

        <section className="pp-hero">
          <div className="pp-avatar" aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <p className="pp-help" style={{ color: '#fb923c', letterSpacing: '.16em', fontWeight: 800, marginBottom: 4 }}>YOUR PROFILE</p>
            <h1>{profile.name}</h1>
            <div className="pp-meta">
              <span className={profile.online ? 'pp-pill pp-pill-on' : 'pp-pill pp-pill-off'}>{profile.online ? 'Online' : 'Offline'}</span>
              {donation?.supporter && <span className="pp-pill pp-pill-gold">Supporter</span>}
              <span>{profile.serverName}</span>
              <span>{profile.auth === 'name' ? 'Minecraft name' : profile.steamId ? `Steam ···${profile.steamId.slice(-4)}` : 'Account'}</span>
            </div>
            <div className="pp-actions">
              <a className="pp-btn pp-btn-ghost" href="/player/map">Open map</a>
              <a className="pp-btn pp-btn-primary" href="/player/shop">Donator shop</a>
            </div>
          </div>
        </section>

        <div className="pp-grid">
          <section className="pp-card">
            <h2>Playtime</h2>
            <p className="pp-help">Totals from roster polls and join/leave logs.</p>
            <div className="pp-stats">
              <div className="pp-stat"><small>Session</small><strong>{profile.online ? duration(stats.sessionSeconds) : '—'}</strong></div>
              <div className="pp-stat"><small>Lifetime</small><strong>{duration(stats.lifetimeSeconds)}</strong></div>
              <div className="pp-stat"><small>Status</small><strong>{profile.online ? 'Online' : 'Offline'}</strong></div>
            </div>
            <div className="pp-quiet">
              <span>First seen {when(stats.firstSeenAt)}</span>
              <span>Last seen {when(stats.lastSeenAt)}</span>
            </div>
          </section>

          <section className="pp-card">
            <h2>Last logout</h2>
            {profile.location ? (
              <>
                <p className="pp-coord">{coords(profile.location)}</p>
                <p className="pp-help" style={{ marginBottom: 10 }}>
                  {profile.location.source === 'last_logout' ? 'Last reported logout' : 'Last reported position while online'}
                  {profile.location.lastLogoutAt ? ` · ${when(profile.location.lastLogoutAt)}` : ''}
                </p>
                <a
                  className="pp-btn pp-btn-ghost"
                  href={`/player/map?focus=logout&x=${Math.round(profile.location.x)}&z=${Math.round(profile.location.z)}`}
                >
                  Find on map
                </a>
              </>
            ) : (
              <p className="pp-empty">No logout coordinates yet. They appear after the next live poll while you are in-game.</p>
            )}
          </section>

          <section className="pp-card pp-span">
            <h2>World map</h2>
            <p className="pp-help">Open the live map when your server has BlueMap or Dynmap configured.</p>
            <div className="pp-actions">
              <a className="pp-btn pp-btn-primary" href="/player/map">Open map</a>
            </div>
          </section>

          <section className="pp-card pp-support">
            <h2>Support the server</h2>
            {donationResult === 'success' && <p className="pp-flash pp-flash-ok">Thanks. Your supporter badge appears after Stripe confirms the payment — refresh in a few seconds.</p>}
            {donationResult === 'cancel' && <p className="pp-flash pp-flash-bad">Checkout was cancelled. Nothing was charged.</p>}
            <p className="pp-help">
              Support is voluntary and tied to this player account. Featured packages are in the{' '}
              <a href="/player/shop" style={{ color: '#fb923c' }}>donator shop</a>.
            </p>
            {donation?.supporter && (
              <p className="pp-help" style={{ color: '#fdba74' }}>
                Supporter{donation.supporterSince ? ` since ${when(donation.supporterSince)}` : ''}
                {typeof donation.totalDonatedCents === 'number' ? ` · ${money(donation.totalDonatedCents)} total` : ''}
              </p>
            )}
            <div className="pp-presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="pp-btn"
                  onClick={() => { setAmountCents(preset); setCustom(''); }}
                  style={amountCents === preset && !custom.trim()
                    ? { color: '#fff7ed', background: '#9a3412', borderColor: '#c2410c' }
                    : { color: '#fdba74', background: '#1c1008', borderColor: '#7c2d12' }}
                >
                  {money(preset)}
                </button>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 13 }}>
                Custom $
                <input
                  type="number"
                  min={5}
                  max={500}
                  step={1}
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  placeholder="25"
                  style={{ width: 72, background: '#0b0b12', color: '#e2e8f0', border: '1px solid #3f3f49', borderRadius: 6, padding: '6px 8px' }}
                />
              </label>
            </div>
            {donateError && <p className="pp-flash pp-flash-bad">{donateError}</p>}
            <button type="button" className="pp-btn pp-btn-primary" disabled={donating || !checkoutReady} onClick={() => void donate()}>
              {donating ? 'Starting checkout…' : checkoutReady ? `Donate ${Number.isInteger(selectedCents) ? money(selectedCents) : ''}` : 'Donations are not configured yet'}
            </button>
            {donation?.recent && donation.recent.length > 0 && (
              <ul style={{ margin: '14px 0 0', paddingLeft: 18, color: '#e2e8f0', fontSize: 13 }}>
                {donation.recent.map((row, index) => (
                  <li key={`${row.at}-${index}`}>{money(row.amountCents)} · {when(row.at)}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PortalFrame>
  );
}
