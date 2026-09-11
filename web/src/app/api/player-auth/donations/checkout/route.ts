import { NextRequest } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../../lib/control-plane';

export async function POST(request: NextRequest) {
  const token = request.cookies.get('mm_player_session')?.value;
  if (!token) return Response.json({ message: 'Player sign-in required' }, { status: 401 });
  const body = await request.text();
  if (body.length > 2048) return Response.json({ message: 'Request too large' }, { status: 413 });
  const control = controlPlaneInternalUrl();
  const response = await fetch(`${control}/api/player-auth/donations/checkout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body,
    cache: 'no-store',
  }).catch(() => null);
  if (!response) return Response.json({ message: 'Donations are unavailable' }, { status: 503 });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}
