/** Base URL for server-side BFF → control-plane calls (never expose to the browser). */
export function controlPlaneInternalUrl(): string {
  const configured = (process.env.CONTROL_PLANE_INTERNAL_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const publicUrl = (process.env.NEXT_PUBLIC_CONTROL_PLANE_URL || '').trim().replace(/\/$/, '');
  if (publicUrl) return publicUrl;
  // Local `pnpm dev` default — do NOT use http://control-plane:3001 (Docker-only DNS).
  return 'http://127.0.0.1:3001';
}
