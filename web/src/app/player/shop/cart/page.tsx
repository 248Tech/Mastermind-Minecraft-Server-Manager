'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PortalFrame } from '../../PortalFrame';
import { ShopThumb, ShopGrantList } from '../../../../lib/shop-copy';
import { useShopCart } from '../../../../lib/shop-cart';
import { ShopAuthGate } from '../../../../lib/shop-auth';
import {
  money,
  shopAlert,
  shopBackLink,
  shopEyebrow,
  shopPrimary,
  shopSuccess,
  sortShopItems,
  SHOP_SORT_OPTIONS,
  startShopCheckout,
  shopItemImageUrl,
  type ShopItem,
  type ShopProfile,
  type ShopSort,
} from '../../../../lib/shop-player';

export default function PlayerShopCartPage() {
  return (
    <Suspense fallback={<PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading cart…</p></PortalFrame>}>
      <PlayerShopCartContent />
    </Suspense>
  );
}

function PlayerShopCartContent() {
  const query = useSearchParams();
  const donationResult = query.get('donation');
  const { ids, remove, clear } = useShopCart();
  const [profile, setProfile] = useState<ShopProfile | null>(null);
  const [catalog, setCatalog] = useState<ShopItem[]>([]);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [sort, setSort] = useState<ShopSort>('name-asc');

  useEffect(() => {
    Promise.all([
      fetch('/api/player-auth/me', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) return null;
        return r.json() as Promise<ShopProfile>;
      }),
      fetch('/api/player-auth/shop/items', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error('Could not load the donator shop');
        return r.json() as Promise<ShopItem[]>;
      }),
    ])
      .then(([nextProfile, nextItems]) => {
        if (nextProfile) setProfile(nextProfile);
        setCatalog(Array.isArray(nextItems) ? nextItems : []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load cart'))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (donationResult === 'success') clear();
  }, [donationResult, clear]);

  const items = useMemo(() => {
    const map = new Map(catalog.map((item) => [item.id, item]));
    const rows = ids.map((id) => map.get(id)).filter((item): item is ShopItem => Boolean(item));
    return sortShopItems(rows, sort);
  }, [catalog, ids, sort]);

  const staleIds = ids.filter((id) => !catalog.some((item) => item.id === id));
  const totalCents = items.reduce((sum, item) => sum + item.priceCents, 0);

  async function checkout() {
    if (!items.length) return;
    setCheckoutError('');
    setBusy(true);
    try {
      await startShopCheckout({ shopItemIds: items.map((item) => item.id) });
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Could not start checkout');
      setBusy(false);
    }
  }

  if (checking) return <PortalFrame profile={null}><p style={{ color: '#94a3b8' }}>Loading cart…</p></PortalFrame>;
  if (error) return <PortalFrame profile={profile}><div style={shopAlert}>{error}</div></PortalFrame>;

  const signedIn = Boolean(profile?.name);
  const checkoutReady = signedIn && Boolean(profile?.donation?.checkoutEnabled);
  const steamLast4 = profile?.steamId ? profile.steamId.slice(-4) : '';

  return (
    <PortalFrame profile={profile} maxWidth={760}>
      <a href="/player/shop" style={shopBackLink}>← Back to donator shop</a>
      {donationResult === 'success' && <div style={shopSuccess}>Thank you. Your supporter status updates after Stripe confirms the payment.</div>}
      {donationResult === 'cancel' && <div style={shopAlert}>Checkout was cancelled. No charge was made.</div>}
      {checkoutError && <div style={shopAlert}>{checkoutError}</div>}
      {signedIn && !profile?.donation?.checkoutEnabled && <div style={shopAlert}>Donations are not configured yet.</div>}

      <section style={hero}>
        <p style={shopEyebrow}>YOUR CART</p>
        <h1 style={{ margin: '0 0 6px', fontSize: '1.5rem' }}>{items.length} item{items.length === 1 ? '' : 's'}</h1>
        <p style={{ color: '#94a3b8', margin: 0 }}>
          {signedIn && profile?.auth === 'name'
            ? `Donate once for everything in your cart. In-Game Gifts stay tied to ${profile.name}.`
            : signedIn && steamLast4
              ? `Donate once for everything in your cart. In-Game Gifts stay tied to Steam ending ${steamLast4}.`
              : 'Review your cart. Sign in with your Minecraft name to donate.'}
        </p>
      </section>

      {staleIds.length > 0 && (
        <div style={shopAlert}>Some saved items are no longer available and were skipped.</div>
      )}

      {items.length === 0 ? (
        <article className="shop-item">
          <div className="shop-item-body">
            <p style={{ color: '#94a3b8', margin: 0 }}>Your cart is empty. Browse the shop and add packages you want to support.</p>
            <a href="/player/shop" style={{ ...shopPrimary, display: 'inline-block', marginTop: 14, textDecoration: 'none' }}>Browse shop</a>
          </div>
        </article>
      ) : (
        <>
          <div className="shop-sort-bar">
            <span className="shop-sort-label">Cart total {money(totalCents)}</span>
            <label className="shop-sort-label">
              Sort{' '}
              <select className="shop-sort-select" value={sort} onChange={(e) => setSort(e.target.value as ShopSort)}>
                {SHOP_SORT_OPTIONS.filter((option) => option.value !== 'featured').map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="shop-cart-list">
            {items.map((item) => (
              <article key={item.id} className="shop-cart-row">
                <a href={`/player/shop/${item.id}`} className="shop-cart-thumb-link">
                  {item.hasImage ? (
                    <ShopThumb src={shopItemImageUrl(item.id, 'thumb')} alt={item.name} />
                  ) : (
                    <div className="shop-thumb-wrap" style={{ minHeight: 80, width: 100, color: '#64748b', fontSize: 12 }}>No picture</div>
                  )}
                </a>
                <div className="shop-cart-row-body">
                  <a href={`/player/shop/${item.id}`} style={{ color: '#f8fafc', textDecoration: 'none', fontWeight: 700 }}>{item.name}</a>
                  <span className="shop-price" style={{ fontSize: '1.1rem' }}>{money(item.priceCents)}</span>
                  <ShopGrantList item={item} compact />
                </div>
                <button type="button" onClick={() => remove(item.id)} style={secondary}>Remove</button>
              </article>
            ))}
          </div>
          <div className="shop-cart-summary">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ color: '#94a3b8' }}>Total</span>
              <span className="shop-price">{money(totalCents)}</span>
            </div>
            {signedIn ? (
              <button
                disabled={!checkoutReady || busy}
                onClick={() => void checkout()}
                style={{ ...shopPrimary, width: '100%', opacity: !checkoutReady || busy ? 0.7 : 1, cursor: !checkoutReady || busy ? 'not-allowed' : 'pointer' }}
              >
                {busy ? 'Opening checkout…' : `Donate ${money(totalCents)}`}
              </button>
            ) : (
              <div style={{ marginBottom: 10 }}>
                <ShopAuthGate next="/player/shop/cart" title="Sign in to donate" />
              </div>
            )}
            <button type="button" onClick={clear} style={{ ...secondary, width: '100%', marginTop: 10 }}>Clear cart</button>
          </div>
        </>
      )}
    </PortalFrame>
  );
}

const hero: React.CSSProperties = { background: '#111118', border: '1px solid #292936', borderRadius: 14, padding: '16px 18px', marginBottom: 16 };
const secondary: React.CSSProperties = { color: '#cbd5e1', background: '#27272f', border: '1px solid #3f3f49', padding: '.55rem .85rem', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };
