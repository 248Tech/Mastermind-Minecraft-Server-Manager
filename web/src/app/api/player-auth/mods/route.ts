import { NextRequest } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../lib/control-plane';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('mm_player_session')?.value;
  if (!token) return Response.json({ message: 'Player sign-in required' }, { status: 401 });
  const control = controlPlaneInternalUrl();
  const response = await fetch(`${control}/api/player-auth/mods`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
  if (!response) return Response.json({ message: 'Mod list is unavailable' }, { status: 503 });
  return new Response(response.body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
}
