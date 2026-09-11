import { NextRequest, NextResponse } from 'next/server';
import { makeSteamState, requestOrigin } from '../../../../../lib/player-auth';
import { controlPlaneInternalUrl } from '../../../../../lib/control-plane';

const SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
export async function GET(request: NextRequest) {
  const publicOrigin = requestOrigin(request);
  let serverInstanceId = request.nextUrl.searchParams.get('server') || process.env.PLAYER_PORTAL_SERVER_ID || '';
  if (!/^c[a-z0-9]{10,40}$/i.test(serverInstanceId)) {
    const control = controlPlaneInternalUrl();
    const landing = await fetch(`${control}/api/public/landing`, { cache: 'no-store' }).catch(() => null);
    const data = landing ? await landing.json().catch(() => null) as { servers?: { id?: string }[] } | null : null;
    serverInstanceId = data?.servers?.[0]?.id || '';
  }
  if (!/^c[a-z0-9]{10,40}$/i.test(serverInstanceId)) {
    return NextResponse.json({ message: 'Player portal server is not configured' }, { status: 503 });
  }
  const next = request.nextUrl.searchParams.get('next') || '/player/map';
  const { state, nonce } = makeSteamState(serverInstanceId, next);
  const callback = new URL('/api/player-auth/steam/callback', publicOrigin);
  callback.searchParams.set('state', state);
  const steam = new URL('https://steamcommunity.com/openid/login');
  steam.searchParams.set('openid.ns', 'http://specs.openid.net/auth/2.0');
  steam.searchParams.set('openid.mode', 'checkid_setup');
  steam.searchParams.set('openid.return_to', callback.toString());
  steam.searchParams.set('openid.realm', publicOrigin);
  steam.searchParams.set('openid.identity', SELECT);
  steam.searchParams.set('openid.claimed_id', SELECT);
  const response = NextResponse.redirect(steam);
  response.cookies.set('mm_player_login', nonce, { httpOnly: true, sameSite: 'lax', secure: new URL(publicOrigin).protocol === 'https:', path: '/api/player-auth/steam', maxAge: 600 });
  return response;
}
