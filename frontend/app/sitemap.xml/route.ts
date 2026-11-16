import { getSitemapCatalog, renderSitemap, sitemapResponse } from '../../lib/sitemap';

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  try { return sitemapResponse(renderSitemap(await getSitemapCatalog())); } catch {
    // Never turn a backend outage into a successfully cached empty sitemap.
    return new Response('Sitemap temporarily unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
}
