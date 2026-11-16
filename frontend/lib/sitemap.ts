import { z } from 'zod';
import { apiRequest } from './api-client';
import { catalogKinds, slugSchema, type CatalogKind } from './catalog-path';
import { siteOrigin } from './seo';

const entrySchema = z.object({ en: slugSchema, zhCN: slugSchema.nullable(), updated_at: z.iso.datetime() });
export const sitemapCatalogSchema = z.object({
  products: z.array(entrySchema), generics: z.array(entrySchema),
  manufacturers: z.array(entrySchema), categories: z.array(entrySchema),
});
export type SitemapCatalog = z.infer<typeof sitemapCatalogSchema>;

export async function getSitemapCatalog(): Promise<SitemapCatalog> {
  const response = await apiRequest('/v1/public/sitemap-catalog', sitemapCatalogSchema, { next: { revalidate: 3600, tags: ['catalog'] } });
  return response.data;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

function urlEntry(enPath: string, zhPath: string | null, updatedAt?: string): string {
  const en = `${siteOrigin()}/en${enPath}`;
  const zh = zhPath === null ? null : `${siteOrigin()}/zh-CN${zhPath}`;
  const alternates = `<xhtml:link rel="alternate" hreflang="en" href="${escapeXml(en)}"/>`
    + (zh ? `<xhtml:link rel="alternate" hreflang="zh-CN" href="${escapeXml(zh)}"/>` : '')
    + `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(en)}"/>`;
  return [en, ...(zh ? [zh] : [])].map((loc) => `<url><loc>${escapeXml(loc)}</loc>${updatedAt ? `<lastmod>${escapeXml(updatedAt)}</lastmod>` : ''}${alternates}</url>`).join('');
}

export function renderSitemap(catalog: SitemapCatalog, kind?: CatalogKind | 'static'): string {
  const entries: string[] = [];
  // Add only implemented static pages. Later steps can extend this allowlist.
  if (!kind || kind === 'static') {
    for (const path of ['', '/products', '/manufacturers', '/generics', '/categories', '/services', '/services/pharmaceutical-sourcing']) entries.push(urlEntry(path, path));
  }
  for (const group of catalogKinds) {
    if (kind && kind !== group) continue;
    for (const entry of catalog[group]) {
      entries.push(urlEntry(`/${group}/${encodeURIComponent(entry.en)}`, entry.zhCN === null ? null : `/${group}/${encodeURIComponent(entry.zhCN)}`, entry.updated_at));
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join('')}</urlset>`;
}

export function sitemapResponse(xml: string): Response {
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
}
