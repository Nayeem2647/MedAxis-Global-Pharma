import { z } from 'zod';
import type { Locale } from '../i18n/routing';

export const catalogKinds = ['products', 'generics', 'manufacturers', 'categories'] as const;
export type CatalogKind = (typeof catalogKinds)[number];
export const slugSchema = z.string().min(1).max(200).regex(/^[\p{L}\p{N}\p{M}]+(?:-[\p{L}\p{N}\p{M}]+)*$/u).refine((slug) => slug === slug.toLowerCase());

export function normalizeCatalogSlug(value: string): string | null {
  try { const parsed = slugSchema.safeParse(decodeURIComponent(value)); return parsed.success ? parsed.data : null; }
  catch { return null; }
}

export function parseCatalogPath(path: string) {
  const match = /^\/(en|zh-CN)\/(products|generics|manufacturers|categories)\/([^/]+)$/.exec(path);
  if (!match) return null;
  let rawSlug: string;
  try { rawSlug = decodeURIComponent(match[3]); } catch { return null; }
  const slug = slugSchema.safeParse(rawSlug);
  const kind = z.enum(catalogKinds).safeParse(match[2]);
  if (!slug.success || !kind.success) return null;
  return { locale: match[1], kind: kind.data, slug: slug.data };
}

export function validateCatalogRedirect(sourcePath: string, location: string | null): string | null {
  if (!location) return null;
  const source = parseCatalogPath(sourcePath);
  const target = parseCatalogPath(location);
  return source && target && target.kind === source.kind && !(source.locale === target.locale && source.slug === target.slug) ? location : null;
}

export function catalogEntityPath(locale: Locale, kind: CatalogKind, slugs: { en: string; zhCN: string | null }, fallback = false): string {
  const useChinese = locale === 'zh-CN' && (slugs.zhCN !== null || fallback);
  return `/${useChinese ? 'zh-CN' : 'en'}/${kind}/${encodeURIComponent(useChinese ? slugs.zhCN ?? slugs.en : slugs.en)}`;
}
