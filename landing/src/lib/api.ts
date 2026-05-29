/**
 * Backend base URL for the public careers API.
 *
 * In production Caddy serves the landing site at `/careers/*` on the same
 * origin as the backend, so a relative path works at runtime. For local
 * dev set `PUBLIC_BACKEND_URL=http://localhost:3000` in `landing/.env`.
 *
 * `PUBLIC_*` env vars are exposed to the browser by Vite, matching Astro's
 * documented convention.
 */
export const BACKEND_URL = (
  import.meta.env.PUBLIC_BACKEND_URL ?? ''
).replace(/\/$/, '');

export function apiUrl(path: string) {
  if (!path.startsWith('/')) path = `/${path}`;
  return `${BACKEND_URL}${path}`;
}
