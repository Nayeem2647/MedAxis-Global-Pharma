import { getSitemapCatalog, renderSitemapIndex, sitemapResponse, sitemapUnavailable } from '../../lib/sitemap';

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  try { await getSitemapCatalog(); return sitemapResponse(renderSitemapIndex()); } catch {
    // Never turn a backend outage into a successfully cached empty sitemap.
    return sitemapUnavailable();
  }
}
