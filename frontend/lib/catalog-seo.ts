import type { Metadata } from 'next';
import type { Locale } from '../i18n/routing';
import type { CatalogKind } from './catalog-path';
import { catalogEntityPath } from './catalog-path';
import { buildLocalizedMetadata, siteOrigin } from './seo';
import type { CatalogMaster, HomeProduct } from './public-catalog';

export function entityMetadata(locale: Locale, kind: CatalogKind, requestedSlug: string, entity: CatalogMaster | HomeProduct, noindex = false): Metadata {
  const title = entity.seo_title ?? ('brand_name' in entity ? entity.brand_name : entity.name);
  return buildLocalizedMetadata({ locale, title: `${title} | MedAxis Global Pharma`, description: entity.meta_description ?? entity.description ?? title,
    enPath: catalogEntityPath('en', kind, entity.alternate_slugs), zhPath: entity.alternate_slugs.zhCN ? catalogEntityPath('zh-CN', kind, entity.alternate_slugs) : null,
    currentPath: `/${locale}/${kind}/${encodeURIComponent(requestedSlug)}`, noindex });
}

export function productStructuredData(product: HomeProduct, locale: Locale, images: string[]) {
  return { '@context': 'https://schema.org', '@type': ['Product', 'Drug'], name: product.brand_name, sku: product.sku,
    url: `${siteOrigin()}${catalogEntityPath(locale, 'products', product.alternate_slugs, true)}`,
    ...(product.description ? { description: product.description } : {}), ...(images.length ? { image: images } : {}),
    activeIngredient: product.generic.name, dosageForm: product.dosage_form,
    manufacturer: { '@type': 'Organization', name: product.manufacturer.name, url: `${siteOrigin()}${catalogEntityPath(locale, 'manufacturers', product.manufacturer.alternate_slugs)}` },
    additionalProperty: [{ '@type': 'PropertyValue', name: 'Strength', value: product.strength }, { '@type': 'PropertyValue', name: 'Pack size', value: product.pack_size }] };
}

export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
