import type { CSSProperties } from 'react';

export type ShopGrantItem = { name: string; quantity: number; quality?: number | null };
export type ShopItem = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  hasImage: boolean;
  createdAt?: string;
  sortOrder?: number;
  active?: boolean;
  grantItemName?: string | null;
  grantQuantity?: number;
  grantItems?: ShopGrantItem[];
};
export type ShopProfile = {
  name: string;
  steamId?: string | null;
  serverName: string;
  online?: boolean;
  auth?: 'steam' | 'name';
  donation?: { supporter?: boolean; checkoutEnabled?: boolean };
};
export type ShopSort = 'featured' | 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc' | 'price-desc' | 'price-asc';

export const SHOP_SORT_OPTIONS: { value: ShopSort; label: string }[] = [
  { value: 'featured', label: 'Featured order' },
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'date-desc', label: 'Date added (newest)' },
  { value: 'date-asc', label: 'Date added (oldest)' },
  { value: 'price-desc', label: 'Price (high to low)' },
  { value: 'price-asc', label: 'Price (low to high)' },
];

export function sortShopItems<T extends { name: string; priceCents: number; createdAt?: string; sortOrder?: number }>(items: T[], sort: ShopSort): T[] {
  const copy = [...items];
  switch (sort) {
    case 'name-asc':
      return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    case 'name-desc':
      return copy.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
    case 'date-desc':
      return copy.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    case 'date-asc':
      return copy.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    case 'price-desc':
      return copy.sort((a, b) => b.priceCents - a.priceCents || a.name.localeCompare(b.name));
    case 'price-asc':
      return copy.sort((a, b) => a.priceCents - b.priceCents || a.name.localeCompare(b.name));
    case 'featured':
    default:
      return copy.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
}

export function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function shopItemImageUrl(itemId: string, size: 'thumb' | 'full' = 'full') {
  const base = `/api/player-auth/shop/items/${encodeURIComponent(itemId)}/image`;
  return size === 'thumb' ? `${base}?size=thumb` : base;
}

export function shopItemIconUrl(itemName: string) {
  return `/item-icon/${encodeURIComponent(itemName)}`;
}

export function shopGrantItems(item: Pick<ShopItem, 'grantItems' | 'grantItemName' | 'grantQuantity'>): ShopGrantItem[] {
  if (Array.isArray(item.grantItems) && item.grantItems.length) {
    return item.grantItems
      .filter((row) => typeof row?.name === 'string' && row.name.trim())
      .map((row) => ({
        name: row.name.trim(),
        quantity: Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : 1,
        quality: row.quality ?? null,
      }));
  }
  if (item.grantItemName?.trim()) {
    return [{
      name: item.grantItemName.trim(),
      quantity: Number.isInteger(item.grantQuantity) && (item.grantQuantity as number) > 0 ? (item.grantQuantity as number) : 1,
      quality: null,
    }];
  }
  return [];
}

export function formatShopGrantLabel(grant: ShopGrantItem) {
  return `${grant.quantity}× ${grant.name}`;
}

export function shopTeaser(text: string, max = 110) {
  const line = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').find((row) => row.trim())?.trim() || '';
  const plain = line.replace(/\*\*/g, '').replace(/^\*\s+/, '');
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).trimEnd()}…`;
}

export function isStripeCheckoutUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'checkout.stripe.com' || parsed.hostname.endsWith('.stripe.com'));
  } catch {
    return false;
  }
}

export async function startShopCheckout(body: { shopItemId?: string; shopItemIds?: string[]; amountCents?: number }) {
  const response = await fetch('/api/player-auth/donations/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as { url?: string; message?: string };
  if (!response.ok) throw new Error(data.message || 'Could not start checkout');
  if (typeof data.url !== 'string' || !isStripeCheckoutUrl(data.url)) throw new Error('Checkout is unavailable');
  location.href = data.url;
}

export const shopAlert: CSSProperties = { color: '#fecaca', background: '#3f1d25', border: '1px solid #7f1d1d', borderRadius: 8, padding: 12, marginBottom: 14 };
export const shopSuccess: CSSProperties = { color: '#bbf7d0', background: '#052e16', border: '1px solid #166534', borderRadius: 8, padding: 12, marginBottom: 14 };
export const shopEyebrow: CSSProperties = { color: '#f97316', fontSize: 11, letterSpacing: '.14em', fontWeight: 800, margin: '0 0 6px' };
export const shopPrimary: CSSProperties = { color: 'white', background: '#ea580c', border: 0, padding: '.7rem 1.15rem', borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 15 };
export const shopInput: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.55rem .75rem', borderRadius: 7, border: '1px solid #3f3f49', background: '#0d0d14', color: '#f1f5f9' };
export const shopBackLink: CSSProperties = { color: '#94a3b8', textDecoration: 'none', fontSize: 13, display: 'inline-block', marginBottom: 12 };
