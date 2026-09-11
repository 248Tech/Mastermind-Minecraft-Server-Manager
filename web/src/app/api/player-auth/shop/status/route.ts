import { NextRequest } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../../lib/control-plane';

export async function GET(request: NextRequest) {
  const control = controlPlaneInternalUrl();
  const headers = new Headers();
  const token = request.cookies.get('mm_player_session')?.value;
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${control}/api/player-auth/shop/status`, {
    headers,
    cache: 'no-store',
  }).catch(() => null);
  if (!response) return Response.json({ message: 'Shop is unavailable' }, { status: 503 });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}
