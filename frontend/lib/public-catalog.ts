import { z } from 'zod';
import { apiRequest } from './api-client';
import { slugSchema } from './catalog-path';
import type { Locale } from '../i18n/routing';

export function plainText(html: string): string {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
const text = z.string().min(1).max(500).transform(plainText);
const content = z.string().max(5000).transform(plainText);
const imageUrl = z.url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }, 'Expected a public HTTPS image URL.');
export const alternateSlugsSchema = z.object({ en: slugSchema, zhCN: slugSchema.nullable() });
export const masterSchema = z.object({
  id: z.uuid(), name: text, slug: slugSchema, alternate_slugs: alternateSlugsSchema,
  description: content.optional(), seo_title: text.optional(), meta_description: text.optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(), certifications: z.array(text).max(100).optional(),
  therapeutic_indications: z.array(text).max(100).optional(),
});
const translationFields = {
  brand_name: text, slug: slugSchema, description: content.optional(), seo_title: text.optional(), meta_description: text.optional(),
  indication_summary: content.optional(), usage_notes: content.optional(), storage_condition: text.optional(), image_alt_text: text.optional(),
};
const translationSchema = z.object(translationFields);
export const homeProductSchema = z.object({
  id: z.uuid(), sku: text, locale: z.enum(['en', 'zh-CN']), ...translationFields, alternate_slugs: alternateSlugsSchema,
  translations: z.object({ en: translationSchema, zhCN: translationSchema.optional() }),
  manufacturer: masterSchema, generic: masterSchema, categories: z.array(masterSchema),
  strength: text, dosage_form: text, pack_size: text, packaging_unit: z.string().min(1).max(40),
  cold_chain_required: z.boolean(), primary_image_url: imageUrl.nullable(), image_urls: z.array(imageUrl).max(20),
  review_metadata: z.object({ kind:z.enum(['TECHNICAL','MEDICAL']), reviewed_at:z.iso.datetime(), reviewer_name:text }).optional(),
}).refine((product) => product.alternate_slugs.en === product.translations.en.slug
  && product.alternate_slugs.zhCN === (product.translations.zhCN?.slug ?? null)
  && product.slug === (product.locale === 'zh-CN' ? product.translations.zhCN?.slug : product.translations.en.slug), 'Product translation identity must match its public locale and alternate slugs.');
export type HomeProduct = z.infer<typeof homeProductSchema>;
export type CatalogMaster = z.infer<typeof masterSchema>;
export const homeProductsSchema = z.object({ products: z.array(homeProductSchema).max(100) });
export const facetsSchema = z.object({
  dosage_forms: z.array(z.object({ name: text, count: z.number().int().nonnegative() })).max(1000),
  cold_chain: z.array(z.object({ required: z.boolean(), count: z.number().int().nonnegative() })).max(2),
});
export const catalogListSchema = homeProductsSchema.extend({ facets: facetsSchema });
export const masterDetailSchema = masterSchema.extend({ products: z.array(homeProductSchema).max(100), facets: facetsSchema });
export type CatalogFacets = z.infer<typeof facetsSchema>;
export const bannersSchema = z.array(z.object({
  id: z.uuid(), title: z.string().max(200).transform(plainText), body: z.string().max(5000).transform(plainText),
  sort_order: z.number().int().nonnegative(), link_path: z.string().max(500).optional(),
}));
export type Banner = z.infer<typeof bannersSchema>[number];

export async function getHomeData(locale: Locale) {
  const [catalog, cms] = await Promise.allSettled([
    apiRequest(`/v1/public/products?locale=${locale}&page=1&limit=6`, homeProductsSchema, { next: { revalidate: 3600, tags: ['catalog'] } }),
    apiRequest(`/v1/public/cms/banners?locale=${locale}`, bannersSchema, { next: { revalidate: 300, tags: ['cms'] } }),
  ]);
  const products = catalog.status === 'fulfilled' ? catalog.value.data.products : [];
  const unique = (values: CatalogMaster[]) => [...new Map(values.map((item) => [item.id, item])).values()];
  return {
    products, banners: cms.status === 'fulfilled' ? cms.value.data : [],
    categories: unique(products.flatMap((product) => product.categories)),
    manufacturers: unique(products.map((product) => product.manufacturer)),
    generics: unique(products.map((product) => product.generic)),
    catalogUnavailable: catalog.status === 'rejected',
  };
}

export function publicAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  // Local, public raster assets are served directly; private routes and traversal
  // can never be selected as image URLs through contact configuration.
  if (/^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:avif|webp|png|jpe?g)$/.test(value)) return value;
  try {
    const url = new URL(value);
    const origins = ['https://cdn.medaxisglobalpharma.com', process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL];
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && origins.includes(url.origin) ? url.href : null;
  } catch { return null; }
}
