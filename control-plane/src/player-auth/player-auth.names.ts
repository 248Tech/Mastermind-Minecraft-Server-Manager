export const MAX_PORTAL_PLAYER_NAME = 64;
export const MIN_PORTAL_PASSWORD = 8;
export const MAX_PORTAL_PASSWORD = 128;

export function parsePortalPlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  // Minecraft Java names: 1–16 chars, letters/digits/underscore
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return null;
  return name;
}

export function parsePortalPassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < MIN_PORTAL_PASSWORD || raw.length > MAX_PORTAL_PASSWORD) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

export function parseShopReturnPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/player/shop';
  const path = raw.trim();
  if (path === '/player' || path === '/player/shop' || path === '/player/shop/cart' || path === '/player/map') return path;
  if (/^\/player\/shop\/[a-zA-Z0-9_-]{10,40}$/.test(path)) return path;
  return '/player/shop';
}
