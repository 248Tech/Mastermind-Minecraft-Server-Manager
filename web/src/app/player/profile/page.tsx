'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PortalFrame } from '../PortalFrame';
import { InventoryGrid } from '../../../components/InventoryGrid';
import './profile.css';

type InventoryItem = { slot: string; count: number; name: string };
type Inventory = { bag?: InventoryItem[]; belt?: InventoryItem[]; equipment?: InventoryItem[]; other?: InventoryItem[]; empty?: boolean };
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
    level: number;
    zombieKills: number;
    playerKills: number;
    deaths: number;
    sessionSeconds: number;
    lifetimeSeconds: number;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  location: { x: number; y: number | null; z: number; lastLogoutAt: string | null; source: string } | null;
  inventory: Inventory | null;
  inventoryAt: string | null;
  donation: Donation;
};
type Places = {
  reachable: boolean;
  claims: Array<{ id: string; position: { x: number; y: number; z: number }; size: number }>;
  homes: Array<{ id: string; position: { x: number; y: number; z: number }; active: boolean }>;
  vehicles: Array<{ id: string; name: string; position: { x: number; y: number; z: number }; vehicleKey?: string; live?: boolean; lastSeenAt?: string }>;
  drones: Array<{ id: string; name: string; position: { x: number; y: number; z: number } }>;
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
  const [places, setPlaces] = useState<Places | null>(null);
  const [returningKey, setReturningKey] = useState('');
  const [returnMessage, setReturnMessage] = useState('');
  const [returnOk, setReturnOk] = useState(false);

  useEffect(() => {
    fetch('/api/player-auth/me', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          setError('Sign in with your Minecraft name to view your profile.');
          return;
        }
        if (!response.ok) throw new Error('Could not load your profile');
        const next = await response.json() as Profile;
        setProfile(next);
        if (next.auth === 'steam') {
          const placesResponse = await fetch('/api/player-auth/places', { cache: 'no-store' });
          if (placesResponse.ok) setPlaces(await placesResponse.json());
        }
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
    level: 0,
    zombieKills: 0,
    playerKills: 0,
    deaths: 0,
    sessionSeconds: 0,
    lifetimeSeconds: 0,
    firstSeenAt: '',
    lastSeenAt: '',
  };
  const inventory = profile.inventory;
  const donation = profile.donation;
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

  async function returnVehicle(vehicleKey: string) {
    setReturnMessage('');
    setReturnOk(false);
    setReturningKey(vehicleKey);
    try {
      const response = await fetch('/api/player-auth/vehicles/return', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vehicleKey }),
      });
      const data = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(data.message || 'Could not return that vehicle');
      setReturnOk(true);
      setReturnMessage(data.message || 'Vehicle returned.');
      const placesResponse = await fetch('/api/player-auth/places', { cache: 'no-store' });
      if (placesResponse.ok) setPlaces(await placesResponse.json());
    } catch (e) {
      setReturnOk(false);
      setReturnMessage(e instanceof Error ? e.message : 'Could not return that vehicle');
    } finally {
      setReturningKey('');
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
              <div className="pp-stat"><small>Deaths</small><strong>{stats.deaths}</strong></div>
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
            <h2>Places & vehicles</h2>
            <p className="pp-help">Return works only while you are online. If the vehicle is still in the world it is brought to you; otherwise a replacement is added to your inventory.</p>
            {returnMessage && <p className={`pp-flash ${returnOk ? 'pp-flash-ok' : 'pp-flash-bad'}`}>{returnMessage}</p>}
            {!hasPlaces ? (
              <p className="pp-empty">
                {places && !places.reachable ? 'Land data is unavailable right now.' : 'No claims, bed, vehicles, or drones linked to this Steam account yet.'}
                {' '}<a href="/player/map" style={{ color: '#fb923c' }}>Open the map</a>
              </p>
            ) : (
              <>
                {places!.claims.length > 0 && (
                  <div className="pp-group">
                    <p className="pp-group-title">Land claims</p>
                    <div className="pp-list">
                      {places!.claims.map((claim) => (
                        <div key={claim.id} className="pp-row">
                          <div className="pp-row-copy">
                            <strong>Land claim</strong>
                            <span>{coords(claim.position)} · {claim.size}×{claim.size}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {places!.homes.length > 0 && (
                  <div className="pp-group">
                    <p className="pp-group-title">Bed</p>
                    <div className="pp-list">
                      {places!.homes.map((home) => (
                        <div key={home.id} className="pp-row">
                          <div className="pp-row-copy">
                            <strong>{home.active ? 'Active bed' : 'Inactive bed'}</strong>
                            <span>{coords(home.position)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {places!.vehicles.length > 0 && (
                  <div className="pp-group">
                    <p className="pp-group-title">Vehicles</p>
                    <div className="pp-list">
                      {places!.vehicles.map((vehicle) => (
                        <div key={vehicle.id} className="pp-row">
                          <div className="pp-row-copy">
                            <strong>{vehicle.name}</strong>
                            <span>{coords(vehicle.position)}{vehicle.live === false ? ' · last seen' : ' · in world'}</span>
                          </div>
                          {vehicle.vehicleKey && vehicle.vehicleKey !== 'unknown' && (
                            <button
                              type="button"
                              className="pp-btn pp-btn-blue"
                              disabled={!profile.online || Boolean(returningKey)}
                              title={profile.online ? 'Bring this vehicle to you' : 'Join the server to return a vehicle'}
                              onClick={() => void returnVehicle(vehicle.vehicleKey!)}
                            >
                              {returningKey === vehicle.vehicleKey ? 'Returning…' : profile.online ? 'Return to me' : 'Join to return'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {places!.drones.length > 0 && (
                  <div className="pp-group">
                    <p className="pp-group-title">Drones</p>
                    <div className="pp-list">
                      {places!.drones.map((drone) => (
                        <div key={drone.id} className="pp-row">
                          <div className="pp-row-copy">
                            <strong>{drone.name}</strong>
                            <span>{coords(drone.position)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="pp-card">
            <h2>Last known inventory</h2>
            <p className="pp-help">
              {profile.inventoryAt
                ? `Snapshot ${when(profile.inventoryAt)}`
                : 'The server only records this when an inventory-capable command returns item data while you are online.'}
            </p>
            {!inventory || inventory.empty ? (
              <p className="pp-empty">Inventory is empty or has not been captured yet.</p>
            ) : (
              <InventoryGrid sections={sections} />
            )}
          </section>

          <section className="pp-card pp-support">
            <h2>Support the server</h2>
            {donationResult === 'success' && <p className="pp-flash pp-flash-ok">Thanks. Your supporter badge appears after Stripe confirms the payment — refresh in a few seconds.</p>}
            {donationResult === 'cancel' && <p className="pp-flash pp-flash-bad">Checkout was cancelled. Nothing was charged.</p>}
            <p className="pp-help">
              Support is voluntary and tied to this Steam account. Featured packages are in the{' '}
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
