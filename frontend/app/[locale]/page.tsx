import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowRight, Box, ClipboardList, FileCheck2, Pill } from 'lucide-react';
import { isLocale } from '../../i18n/routing';
import { buildLocalizedMetadata } from '../../lib/seo';
import { getHomeData } from '../../lib/public-catalog';
import { Hero } from '../../components/home/Hero';
import { SourcingTiles } from '../../components/home/SourcingTiles';
import { Categories } from '../../components/home/Categories';
import { CustomerReviews } from '../../components/home/CustomerReviews';
import { ManufacturerMarquee } from '../../components/home/ManufacturerMarquee';
import { ProductCard } from '../../components/home/ProductCard';
import { QuoteButton } from '../../components/layout/PublicShell';

export const revalidate = 300;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  return buildLocalizedMetadata({ locale, enPath: '/en', zhPath: '/zh-CN', title: t('title'), description: t('description') });
}

export default async function Home({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Home' });
  const data = await getHomeData(locale);
  return (
    <main id="main-content">
      <Hero locale={locale} banners={data.banners}/>
      <SourcingTiles locale={locale}/>
      <Categories locale={locale} categories={data.categories}/>
      <section className="catalog-section" id="catalog"><div className="section site-container"><div className="centered-heading"><h2>{t('catalogTitle')}</h2><p className="section-intro">{t('catalogDescription')}</p></div>
        {data.products.length > 0 ? <>
          <div className="product-grid">{data.products.slice(0, 8).map((product) => <ProductCard key={product.id} product={product} locale={locale}/>)}</div>
          <div className="catalog-view-all"><Link className="catalog-view-all-btn" href={`/${locale}/products`}>{t('viewAllProducts')}<ArrowRight size={17} aria-hidden="true"/></Link></div>
        </>
          : <div className="catalog-empty"><Pill size={30}/><p>{t(data.catalogUnavailable ? 'catalogUnavailable' : 'catalogEmpty')}</p><QuoteButton className="button secondary">{t('request')}</QuoteButton></div>}
      </div></section>
      {data.popularProducts.length > 0 && (
        <section className="popular-section" id="popular"><div className="section site-container"><div className="centered-heading"><h2>{t('popularTitle')}</h2><p className="section-intro">{t('popularDescription')}</p></div>
          <div className="product-grid popular-grid">{data.popularProducts.slice(0, 15).map((product) => <ProductCard key={`popular-${product.id}`} product={product} locale={locale}/>)}</div>
        </div></section>
      )}
      <CustomerReviews locale={locale}/>
      <section className="section site-container process-section"><p className="eyebrow">MEDAXIS GLOBAL PHARMA</p><h2>{t('processTitle')}</h2><ol className="process-grid"><li><span>01</span><ClipboardList/><h3>{t('stepOneTitle')}</h3><p>{t('stepOneBody')}</p></li><li><span>02</span><FileCheck2/><h3>{t('stepTwoTitle')}</h3><p>{t('stepTwoBody')}</p></li><li><span>03</span><Box/><h3>{t('stepThreeTitle')}</h3><p>{t('stepThreeBody')}</p></li></ol></section>
      <section className="site-container final-cta"><div><h2>{t('ctaTitle')}</h2><p>{t('ctaBody')}</p></div><QuoteButton>{t('request')}<ArrowRight size={18}/></QuoteButton></section>
      <ManufacturerMarquee locale={locale} manufacturers={data.marqueeManufacturers}/>
    </main>
  );
}
