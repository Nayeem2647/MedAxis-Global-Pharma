import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, Snowflake } from 'lucide-react';
import { isLocale } from '../../../../i18n/routing';
import { ApiError } from '../../../../lib/api-client';
import { getProduct, catalogStaticParams } from '../../../../lib/catalog-data';
import { catalogEntityPath, normalizeCatalogSlug } from '../../../../lib/catalog-path';
import { entityMetadata, productStructuredData, serializeStructuredData } from '../../../../lib/catalog-seo';
import { plainText, publicAssetUrl, publicVideoUrl } from '../../../../lib/public-catalog';
import { getContactConfig } from '../../../../lib/public-config';
import { Breadcrumbs } from '../../../../components/catalog/Breadcrumbs';
import { CatalogState } from '../../../../components/catalog/CatalogState';
import { cartInput } from '../../../../components/catalog/ProductCard';
import { ProductRichDescription } from '../../../../components/catalog/ProductRichDescription';
import { ProductEnquiry } from '../../../../components/catalog/ProductEnquiry';
import { ProductGallery } from '../../../../components/catalog/ProductGallery';
import { ProductDetailsDisclosure } from '../../../../components/catalog/ProductDetailsDisclosure';
import { SimilarProducts } from '../../../../components/catalog/SimilarProducts';

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
  const fields = [
    { label: t('generic'), content: <Link href={catalogEntityPath(locale, 'generics', product.generic.alternate_slugs)}>{product.generic.name}</Link> },
    { label: t('packSize'), content: product.pack_size },
    { label: t('manufacturer'), content: <Link href={catalogEntityPath(locale, 'manufacturers', product.manufacturer.alternate_slugs)}>{product.manufacturer.name}</Link> },
    { label: t('strength'), content: product.strength },
    { label: t('dosageForm'), content: product.dosage_form },
    ...(product.categories.length ? [{ label: t('category'), content: product.categories.map((category, index) => <span key={category.id}>{index > 0 && ', '}<Link href={catalogEntityPath(locale, 'categories', category.alternate_slugs)}>{category.name}</Link></span>) }] : []),
  ];
  const information = [
    { id: 'product-description', label: t('description'), content: product.description, html: product.description_html },
    { id: 'product-indications', label: t('indications'), content: product.indication_summary },
    { id: 'product-usage', label: t('usageNotes'), content: product.usage_notes },
    { id: 'product-storage', label: t('storage'), content: product.storage_condition },
  ].filter((section) => section.content || section.html);
  return <main id="main-content" className="product-detail"><div className="section site-container">
    <Breadcrumbs locale={locale} entries={[{ name: t('products'), href: `/${locale}/products` }, { name: product.brand_name, href: path }]}/>
    {locale === 'zh-CN' && product.alternate_slugs.zhCN === null && <p className="translation-notice" lang="zh-CN">{t('untranslated')}</p>}
    <div className="product-detail-grid">
      <ProductGallery key={product.id} images={images} video={publicVideoUrl(product.video_url)} name={product.brand_name} alt={product.image_alt_text ?? `${product.brand_name} · ${product.generic.name} · ${product.manufacturer.name}`}/>
      <div className="product-summary"><p className="product-detail-manufacturer"><Link href={catalogEntityPath(locale, 'manufacturers', product.manufacturer.alternate_slugs)}>{product.manufacturer.name}</Link></p><h1>{product.brand_name} <span>({product.generic.name})</span></h1>
        <div className="product-status-row"><span className="availability"><span/>{home('onRequest')}</span>{product.cold_chain_required && <span className="detail-cold"><Snowflake size={16}/>{home('coldChain')}</span>}</div>
        <dl className="specifications">{fields.map(({ label, content }) => <div key={label}><dt><span className="specification-check" aria-hidden="true"><Check size={13} strokeWidth={3}/></span>{label}</dt><dd>{content}</dd></div>)}</dl>
        <div className="product-reference"><span>{t('sku')}: <strong>{product.sku}</strong></span><span>{t('unit')}: <strong>{product.packaging_unit}</strong></span></div>
        <ProductEnquiry key={product.id} product={cartInput(product)} contact={getContactConfig()}/>
        {product.review_metadata&&<p className="small muted">{locale==='zh-CN'?(product.review_metadata.kind==='MEDICAL'?'医学审核':'技术审核'):(product.review_metadata.kind==='MEDICAL'?'Medical review':'Technical review')} · {product.review_metadata.reviewer_name} · <time dateTime={product.review_metadata.reviewed_at}>{product.review_metadata.reviewed_at.slice(0,10)}</time></p>}
      </div>
    </div>
    <div className="product-information">
      <div className="product-information-heading"><h2>{t('productDetails')}</h2><span>{product.brand_name}</span></div>
      {information.length > 0 && <ProductDetailsDisclosure key={product.id} preview={plainText(information[0].html || information[0].content || '')} label={information[0].label} hasAdditionalDetails={information.length > 1 || Boolean(information[0].html)}>
        {information.length > 1 && <nav className="product-information-nav" aria-label={t('productDetails')}>{information.map(({ id, label }) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>}
        <div className="product-information-body">{information.map(({ id, label, content, html }) => <section id={id} key={id}><h2>{label}</h2>{html ? <ProductRichDescription html={html} /> : <p>{content}</p>}</section>)}</div>
      </ProductDetailsDisclosure>}
      <div className="product-information-body"><p className="medical-notice">{t('medicalNotice')}</p></div>
    </div>
    <Suspense fallback={<section className="similar-products" aria-busy="true"><p className="muted">{t('loading')}</p></section>}><SimilarProducts product={product} locale={locale}/></Suspense>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(productStructuredData(product, locale, images)) }}/>
  </div></main>;
}
