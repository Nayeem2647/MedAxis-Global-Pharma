import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Pill, Snowflake } from 'lucide-react';
import { isLocale } from '../../../../i18n/routing';
import { ApiError } from '../../../../lib/api-client';
import { getProduct, catalogStaticParams } from '../../../../lib/catalog-data';
import { catalogEntityPath, normalizeCatalogSlug } from '../../../../lib/catalog-path';
import { entityMetadata, productStructuredData, serializeStructuredData } from '../../../../lib/catalog-seo';
import { publicAssetUrl } from '../../../../lib/public-catalog';
import { Breadcrumbs } from '../../../../components/catalog/Breadcrumbs';
import { CatalogState } from '../../../../components/catalog/CatalogState';
import { cartInput } from '../../../../components/catalog/ProductCard';
import { ProductActions } from '../../../../components/home/ProductActions';
import { CatalogImage } from '../../../../components/catalog/CatalogImage';

type Props = { params: Promise<{ locale: string; slug: string }> };
export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams({ params }: { params: { locale: string } }) { return isLocale(params.locale) ? catalogStaticParams('products', params.locale) : []; }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug: rawSlug } = await params;
  const slug = normalizeCatalogSlug(rawSlug);
  if (!isLocale(locale) || !slug) notFound();
  try { return entityMetadata(locale, 'products', slug, await getProduct(locale, slug)); }
  catch (error: unknown) { if (error instanceof ApiError && error.status === 404) notFound(); return { title: 'MedAxis Global Pharma', robots: { index: false, follow: true } }; }
}

export default async function ProductPage({ params }: Props) {
  const { locale, slug: rawSlug } = await params;
  const slug = normalizeCatalogSlug(rawSlug);
  if (!isLocale(locale) || !slug) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const home = await getTranslations({ locale, namespace: 'Home' });
  let product: Awaited<ReturnType<typeof getProduct>>;
  try { product = await getProduct(locale, slug); }
  catch (error: unknown) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <main id="main-content" className="section site-container"><CatalogState locale={locale} error={error} path={`/${locale}/products/${encodeURIComponent(slug)}`}/></main>;
  }
  const images = [...new Set([product.primary_image_url, ...product.image_urls].map(publicAssetUrl).filter((image): image is string => image !== null))];
  const path = `/${locale}/products/${encodeURIComponent(slug)}`;
  const fields = [[t('strength'), product.strength], [t('dosageForm'), product.dosage_form], [t('packSize'), product.pack_size], [t('unit'), product.packaging_unit], [t('sku'), product.sku], ...(product.storage_condition ? [[t('storage'), product.storage_condition]] : [])];
  return <main id="main-content" className="product-detail"><div className="section site-container">
    <Breadcrumbs locale={locale} entries={[{ name: t('products'), href: `/${locale}/products` }, { name: product.brand_name, href: path }]}/>
    {locale === 'zh-CN' && product.alternate_slugs.zhCN === null && <p className="translation-notice" lang="zh-CN">{t('untranslated')}</p>}
    <div className="product-detail-grid"><div className="product-gallery">{images.length ? images.map((image, index) => <div className={index === 0 ? 'gallery-main' : 'gallery-secondary'} key={image}><CatalogImage src={image} alt={product.image_alt_text ?? `${product.brand_name} · ${product.generic.name} · ${product.manufacturer.name}`} width={720} height={540} sizes="(max-width: 800px) 90vw, 45vw" priority={index === 0} fallbackLabel={t('imageUnavailable')}/></div>) : <div className="gallery-main gallery-fallback" aria-hidden="true"><Pill size={85} strokeWidth={1}/></div>}</div>
      <div className="product-summary"><p className="eyebrow"><Link href={catalogEntityPath(locale, 'manufacturers', product.manufacturer.alternate_slugs)}>{product.manufacturer.name}</Link></p><h1>{product.brand_name}</h1><Link className="ingredient-link" href={catalogEntityPath(locale, 'generics', product.generic.alternate_slugs)}>{product.generic.name}</Link><p className="muted">{product.strength} · {product.dosage_form} · {product.pack_size}</p>
        <span className="availability"><span/>{home('onRequest')}</span>{product.cold_chain_required && <p className="detail-cold"><Snowflake size={18}/>{home('coldChain')}</p>}
        <dl className="specifications">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <div className="category-links">{product.categories.map((category) => <Link key={category.id} href={catalogEntityPath(locale, 'categories', category.alternate_slugs)}>{category.name}</Link>)}</div>
        <ProductActions product={cartInput(product)}/><p className="small muted">{t('privateAvailability')}</p>
        {product.review_metadata&&<p className="small muted">{locale==='zh-CN'?(product.review_metadata.kind==='MEDICAL'?'医学审核':'技术审核'):(product.review_metadata.kind==='MEDICAL'?'Medical review':'Technical review')} · {product.review_metadata.reviewer_name} · <time dateTime={product.review_metadata.reviewed_at}>{product.review_metadata.reviewed_at.slice(0,10)}</time></p>}
      </div>
    </div>
    <div className="product-information">{[[t('description'), product.description], [t('indications'), product.indication_summary], [t('usageNotes'), product.usage_notes]].map(([label, content]) => content && <section key={label}><h2>{label}</h2><p>{content}</p></section>)}<p className="medical-notice">{t('medicalNotice')}</p></div>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(productStructuredData(product, locale, images)) }}/>
  </div></main>;
}
