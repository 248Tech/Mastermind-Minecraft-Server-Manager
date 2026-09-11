import { NextRequest } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../../../lib/control-plane';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-z0-9_-]{10,40}$/i.test(id)) return Response.json({ message: 'Item not found' }, { status: 404 });
  const control = controlPlaneInternalUrl();
  const headers = new Headers();
  const token = request.cookies.get('mm_player_session')?.value;
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${control}/api/player-auth/shop/items/${encodeURIComponent(id)}`, {
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
