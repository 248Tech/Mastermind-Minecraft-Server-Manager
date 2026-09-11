import { NextRequest, NextResponse } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../lib/control-plane';
import { parsePlayerReturnPath, requestOrigin } from '../../../../lib/player-auth';

export async function POST(request: NextRequest) {
  const publicOrigin = requestOrigin(request);
  const body = await request.json().catch(() => ({})) as { name?: unknown; password?: unknown; next?: unknown };
  const control = controlPlaneInternalUrl();
  const response = await fetch(`${control}/api/player-auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  }).catch(() => null);
  if (!response) return Response.json({ message: 'Player authentication is unavailable' }, { status: 503 });
  const data = await response.json().catch(() => ({})) as { access_token?: string; next?: string; message?: string };
  if (!response.ok || !data.access_token) {
    return Response.json({ message: data.message || 'Could not create account' }, { status: response.status || 400 });
  }
  const next = parsePlayerReturnPath(data.next || body.next, '/player/shop');
  const out = NextResponse.json({ ok: true, next });
  out.cookies.set('mm_player_session', data.access_token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(publicOrigin).protocol === 'https:',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
  return out;
}
