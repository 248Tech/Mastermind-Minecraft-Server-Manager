import { NextRequest } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../../../../lib/control-plane';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-z0-9_-]{10,40}$/i.test(id)) return Response.json({ message: 'Item not found' }, { status: 404 });
  const control = controlPlaneInternalUrl();
  const size = request.nextUrl.searchParams.get('size');
  const query = size === 'thumb' ? '?size=thumb' : '';
  const token = request.cookies.get('mm_player_session')?.value;
  const auth = new Headers();
  if (token) auth.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${control}/api/player-auth/shop/items/${encodeURIComponent(id)}/image${query}`, {
    headers: auth,
    cache: 'no-store',
  }).catch(() => null);
  if (!response) return Response.json({ message: 'Shop is unavailable' }, { status: 503 });
  const headers = new Headers();
  headers.set('content-type', response.headers.get('content-type') || 'application/octet-stream');
  headers.set('cache-control', 'public, max-age=300');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}
