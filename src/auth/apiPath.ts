/**
 * Hono may expose either the full path (`/api/v1/...`) or the path relative to
 * a mounted sub-app (`/enterprise/...`). Normalize to full gateway path.
 */
export function normalizeGatewayPathname(pathname: string): string {
  if (pathname.startsWith("/api/v1")) return pathname;
  const tail = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `/api/v1${tail}`;
}
