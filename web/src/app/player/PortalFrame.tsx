'use client';

import { usePathname } from 'next/navigation';
import { useShopCart } from '../../lib/shop-cart';

export type PortalProfile = {
  name?: string;
  steamId?: string | null;
  serverName?: string;
  online?: boolean;
  auth?: string;
  isAdmin?: boolean;
  donation?: { supporter?: boolean; checkoutEnabled?: boolean };
};

export function PortalFrame({
  profile,
  children,
  wide,
  maxWidth,
}: {
  profile: PortalProfile | null;
  children: React.ReactNode;
  wide?: boolean;
  maxWidth?: number;
}) {
  const signedIn = Boolean(profile?.name);
  const path = usePathname() || '';
  return (
    <main style={{ minHeight: '100vh', background: '#08080d', color: '#f1f5f9' }}>
      <header style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 18px', background: '#111118', borderBottom: '1px solid #292936' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/mastermind-logo.png" alt="" style={{ width: 38, height: 38, objectFit: 'cover', borderRadius: 8 }} />
          <div>
            <strong>Player Portal</strong>
            <div style={{ color: '#64748b', fontSize: 11 }}>{profile?.serverName || 'Donator shop and Minecraft name access'}</div>
          </div>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#94a3b8', fontSize: 13 }}>
          {profile?.name && <span style={{ color: profile.online ? '#4ade80' : '#94a3b8' }}>{profile.online ? '●' : '○'} {profile.name}</span>}
          <NavLink href="/player" current={path === '/player'}>Home</NavLink>
          {signedIn && <NavLink href="/player/profile" current={path.startsWith('/player/profile')}>Profile</NavLink>}
          {profile?.isAdmin && <NavLink href="/" current={false}>Admin dashboard</NavLink>}
          <NavLink href="/player/shop" current={path.startsWith('/player/shop')}>Shop</NavLink>
          <CartNavLink current={path.startsWith('/player/shop/cart')} />
          <NavLink href="/player/map" current={path.startsWith('/player/map')}>Map</NavLink>
          {(profile?.isAdmin || profile?.donation?.supporter) && <NavLink href="/player/mods" current={path.startsWith('/player/mods')}>Mods</NavLink>}
          {signedIn && (
            <button
              onClick={() => fetch('/api/player-auth/logout', { method: 'POST' }).then(() => { location.href = '/player'; })}
              style={{ ...link, background: 'transparent', border: 0, cursor: 'pointer', padding: 0, font: 'inherit' }}
            >
              Sign out
            </button>
          )}
        </nav>
      </header>
      <section style={{ padding: wide ? '14px 18px' : '18px 20px 32px', maxWidth: wide ? undefined : (maxWidth ?? 1100), margin: wide ? undefined : '0 auto' }}>{children}</section>
    </main>
  );
}

const link: React.CSSProperties = { color: '#fb923c', textDecoration: 'none' };
const linkOn: React.CSSProperties = { color: '#fed7aa', textDecoration: 'none', fontWeight: 700 };

function NavLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return <a href={href} style={current ? linkOn : link}>{children}</a>;
}

function CartNavLink({ current }: { current?: boolean }) {
  const { count } = useShopCart();
  return (
    <a href="/player/shop/cart" style={current ? linkOn : link}>
      Cart{count > 0 ? ` (${count})` : ''}
    </a>
  );
}
