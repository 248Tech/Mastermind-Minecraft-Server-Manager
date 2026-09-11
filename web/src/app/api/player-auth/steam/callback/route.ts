import { NextRequest, NextResponse } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../../lib/control-plane';
import { readSteamState, requestOrigin } from '../../../../../lib/player-auth';

export async function GET(request: NextRequest) {
  const publicOrigin = requestOrigin(request);
  const stateText = request.nextUrl.searchParams.get('state') ?? '';
  const state = readSteamState(stateText, request.cookies.get('mm_player_login')?.value);
  const failed = (reason: string) => NextResponse.redirect(new URL(`/player?error=${encodeURIComponent(reason)}`, publicOrigin));
  if (!state) return failed('Steam sign-in expired or could not be verified');
  // Rebuild the exact return_to value sent during the login start. Do not use
  // request.url here: behind Cloudflare/Next standalone it contains the
  // container listener (0.0.0.0:3000), which Steam correctly rejects.
  const returnTo = new URL('/api/player-auth/steam/callback', publicOrigin);
  returnTo.searchParams.set('state', stateText);
  const openid: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => { if (key.startsWith('openid.')) openid[key] = value; });
  const control = controlPlaneInternalUrl();
  const verified = await fetch(`${control}/api/player-auth/steam/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ serverInstanceId: state.serverInstanceId, returnTo: returnTo.toString(), openid }),
  }).catch(() => null);
  if (!verified?.ok) {
    const body = await verified?.json().catch(() => null) as { message?: string } | null;
    return failed(body?.message || 'Steam verification failed');
  }
  const body = await verified.json() as { access_token: string };
  const response = NextResponse.redirect(new URL(state.next || '/player/map', publicOrigin));
  response.cookies.delete('mm_player_login');
  response.cookies.set('mm_player_session', body.access_token, { httpOnly: true, sameSite: 'lax', secure: new URL(publicOrigin).protocol === 'https:', path: '/', maxAge: 12 * 60 * 60 });
  return response;
}
