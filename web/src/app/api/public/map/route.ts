import { NextRequest } from 'next/server';
import { controlPlaneInternalUrl } from '../../../../lib/control-plane';

export async function GET(_request: NextRequest) {
  const control = controlPlaneInternalUrl();
  const response = await fetch(`${control}/api/public/map`, { cache: 'no-store' }).catch(() => null);
  if (!response) {
    return Response.json({ ok: false, configured: false, mapEmbedUrl: null, message: 'Map is unavailable' }, { status: 503 });
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}
