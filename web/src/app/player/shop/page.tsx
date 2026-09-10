'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PortalFrame } from '../PortalFrame';
import { ShopThumb, ShopGrantList } from '../../../lib/shop-copy';
import { useShopCart } from '../../../lib/shop-cart';
import { ShopAuthGate } from '../../../lib/shop-auth';
import {
  money,
  shopAlert,
  shopEyebrow,
  shopInput,
  shopPrimary,
  shopSuccess,
  shopTeaser,
  sortShopItems,
  SHOP_SORT_OPTIONS,
  startShopCheckout,
  shopItemImageUrl,
  type ShopItem,
  type ShopProfile,
  type ShopSort,
} from '../../../lib/shop-player';

function ShopCatalogCard({ item }: { item: ShopItem }) {
  const { add, remove, has } = useShopCart();
  const inCart = has(item.id);
  return (
    <article className="shop-card">
      <a href={`/player/shop/${item.id}`} className="shop-card-link">
        {item.hasImage ? (
          <ShopThumb src={shopItemImageUrl(item.id, 'thumb')} alt={item.name} />
        ) : (
          <div className="shop-thumb-wrap" style={{ color: '#64748b', fontSize: 13 }}>No picture</div>
        )}
        <div className="shop-card-body">
          <h2 className="shop-card-title">{item.name}</h2>
          {item.description && <p className="shop-card-teaser">{shopTeaser(item.description)}</p>}
          <ShopGrantList item={item} compact />
          <div className="shop-card-footer">
            <span className="shop-price">{money(item.priceCents)}</span>
            <span className="shop-card-cta">View details →</span>
          </div>
        </div>
      </a>
      <div className="shop-card-actions" style={{ padding: '0 16px 14px' }}>
        {inCart ? (
          <>
            <button type="button" className="shop-card-btn shop-card-btn-muted" onClick={() => remove(item.id)}>Remove from cart</button>
            <a href="/player/shop/cart" className="shop-card-btn shop-card-btn-primary" style={{ textDecoration: 'none' }}>Visit cart</a>
          </>
        ) : (
          <button type="button" className="shop-card-btn shop-card-btn-primary" onClick={() => add(item.id)}>Add to cart</button>
        )}
      </div>
    </article>
  );
}

export default function PlayerShopPage() {
  return (
    <Suspense fallback={<PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading the donator shop…</p></PortalFrame>}>
      <PlayerShopContent />
    </Suspense>
  );
}

function PlayerShopContent() {
  const query = useSearchParams();
  const donationResult = query.get('donation');
  const { count } = useShopCart();
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [serverName, setServerName] = useState('');
  const [checkoutEnabled, setCheckoutEnabled] = useState(false);
  const [serverReachable, setServerReachable] = useState(false);
  const [playersOnline, setPlayersOnline] = useState(0);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [donateError, setDonateError] = useState('');
  const [custom, setCustom] = useState('10');
  const [sort, setSort] = useState<ShopSort>('featured');

  const sortedItems = useMemo(() => sortShopItems(items, sort), [items, sort]);
  const signedIn = Boolean(profile?.name);

  useEffect(() => {
    Promise.all([
      fetch('/api/player-auth/me', { cache: 'no-store' }).then(async (r) => {
        if (r.status === 401) return null;
        if (!r.ok) return null;
        return r.json() as Promise<ShopProfile>;
      }),
      fetch('/api/player-auth/shop/items', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error('Could not load the donator shop');
        return r.json() as Promise<ShopItem[]>;
      }),
      fetch('/api/player-auth/shop/status', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) return { serverName: '', checkoutEnabled: false, serverReachable: false, playersOnline: 0 };
        return r.json() as Promise<{ serverName?: string; checkoutEnabled?: boolean; serverReachable?: boolean; playersOnline?: number }>;
      }),
    ])
      .then(([nextProfile, nextItems, status]) => {
        if (nextProfile) setProfile(nextProfile);
        setItems(Array.isArray(nextItems) ? nextItems : []);
        setServerName(nextProfile?.serverName || status.serverName || '');
        setCheckoutEnabled(Boolean(nextProfile?.donation?.checkoutEnabled ?? status.checkoutEnabled));
        setServerReachable(Boolean(status.serverReachable));
        setPlayersOnline(Number.isInteger(status.playersOnline) ? Math.max(0, Number(status.playersOnline)) : 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the donator shop'))
      .finally(() => setChecking(false));
  }, []);

  async function checkout(body: { shopItemId?: string; amountCents?: number }, busyKey: string) {
    setDonateError('');
    setBusyId(busyKey);
    try {
      await startShopCheckout(body);
    } catch (e) {
      setDonateError(e instanceof Error ? e.message : 'Could not start checkout');
      setBusyId(null);
    }
  }

  if (checking) return <PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading the donator shop…</p></PortalFrame>;
  if (error) return <PortalFrame profile={profile}><div style={shopAlert}>{error}</div></PortalFrame>;

  const checkoutReady = signedIn && checkoutEnabled;
  const customCents = Math.round(Number(custom) * 100);
  const donateDisabled = !checkoutReady || busyId !== null;
  const steamLast4 = profile?.steamId ? profile.steamId.slice(-4) : '';
  const displayProfile = profile || (serverName ? { name: '', serverName } : null);

  return (
    <PortalFrame profile={displayProfile} maxWidth={980}>
      <section style={hero}>
        <p style={shopEyebrow}>SUPPORT THE SERVER</p>
        <h1 style={{ margin: '0 0 6px', fontSize: '1.7rem' }}>Donator shop</h1>
        <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.55 }}>
          {signedIn && profile?.auth === 'name'
            ? `Signed in as ${profile.name}. Gifts apply to that in-game name.`
            : signedIn && steamLast4
              ? `Gifts are tied to Steam ending ${steamLast4}.`
              : signedIn
                ? `Signed in as ${profile?.name || 'player'}. Gifts apply to this account.`
              : 'Browse freely. Sign in with your Minecraft name to donate.'}
          {` · ${serverReachable ? 'Server online' : 'Server status unknown'} · ${playersOnline} player${playersOnline === 1 ? '' : 's'}`}
          {count > 0 && <> · <a href="/player/shop/cart" style={{ color: '#fb923c' }}>View cart ({count})</a></>}
        </p>
      </section>
      {donationResult === 'success' && <div style={shopSuccess}>Thank you. Your supporter status updates after Stripe confirms the payment.</div>}
      {donationResult === 'cancel' && <div style={shopAlert}>Checkout was cancelled. No charge was made.</div>}
      {donateError && <div style={shopAlert}>{donateError}</div>}
      {signedIn && !checkoutEnabled && <div style={shopAlert}>Donations are not configured yet.</div>}

      <div className="shop-layout">
        <div>
          {items.length === 0 ? (
            <article className="shop-item">
              <div className="shop-item-body">
                <h2 className="shop-item-title">No featured items yet</h2>
                <p style={{ color: '#94a3b8', margin: 0 }}>You can still support the server with a custom amount.</p>
              </div>
            </article>
          ) : (
            <>
              <div className="shop-sort-bar">
                <span className="shop-sort-label">{sortedItems.length} item{sortedItems.length === 1 ? '' : 's'}</span>
                <label className="shop-sort-label">
                  Sort{' '}
                  <select className="shop-sort-select" value={sort} onChange={(e) => setSort(e.target.value as ShopSort)}>
                    {SHOP_SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="shop-grid">
                {sortedItems.map((item) => <ShopCatalogCard key={item.id} item={item} />)}
              </div>
            </>
          )}
        </div>

        <aside className="shop-custom">
          {signedIn ? (
            <>
              <p style={shopEyebrow}>OR GIVE ANY AMOUNT</p>
              <h2 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>Custom gift</h2>
              <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 13, lineHeight: 1.5 }}>
                {profile?.auth === 'name' ? 'Any amount from $5 to $500, tied to this in-game name.' : 'Any amount from $5 to $500, tied to this player account.'}
              </p>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>USD</label>
              <input
                type="number"
                min={5}
                max={500}
                step="1"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                style={shopInput}
              />
              <button
                disabled={donateDisabled}
                onClick={() => void checkout({ amountCents: customCents }, 'custom')}
                style={{ ...shopPrimary, width: '100%', marginTop: 12, opacity: donateDisabled ? 0.7 : 1, cursor: donateDisabled ? 'not-allowed' : 'pointer' }}
              >
                {busyId === 'custom' ? 'Opening…' : `Donate ${Number.isFinite(customCents) ? money(customCents) : ''}`}
              </button>
            </>
          ) : (
            <ShopAuthGate next="/player/shop" title="Sign in to donate" />
          )}
        </aside>
      </div>
    </PortalFrame>
  );
}

const hero: React.CSSProperties = { background: '#111118', border: '1px solid #292936', borderRadius: 14, padding: '16px 18px', marginBottom: 16 };
