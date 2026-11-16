import { apiUrl } from './api-config';
import { parseCatalogPath, validateCatalogRedirect } from './catalog-path';
import { LruCache } from './lru-cache';

const redirects = new LruCache<string, string | null>(500, 3_600_000);
const pending = new Map<string, Promise<string | null>>();

async function lookup(pathname: string): Promise<string | null> {
  const source = parseCatalogPath(pathname);
  if (!source) return null;
  try {
    // The existing Express detail routes expose URL_REDIRECT as 301 + Location.
    // Manual mode prevents fetch from following the relative frontend destination.
    const url = apiUrl(`/v1/public/${source.kind}/${encodeURIComponent(source.slug)}?locale=${source.locale}`);
    const response = await fetch(url, { redirect: 'manual', cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (response.status === 301 && location) {
      const target = validateCatalogRedirect(pathname, location);
      if (target) {
        redirects.set(pathname, target);
        return target;
      }
    }
    if (response.status === 404) redirects.set(pathname, null);
    // Do not cache live 200 paths: a subsequent slug edit must be seen immediately.
    // Transient errors also stay uncached and must never break public rendering.
    return null;
  } catch {
    return null;
  }
}

export async function findHistoricalRedirect(pathname: string): Promise<string | null> {
  if (!parseCatalogPath(pathname)) return null;
  const cached = redirects.get(pathname);
  if (cached !== undefined) return cached;
  const existing = pending.get(pathname);
  if (existing) return existing;
  const request = lookup(pathname);
  pending.set(pathname, request);
  try { return await request; } finally { pending.delete(pathname); }
}
