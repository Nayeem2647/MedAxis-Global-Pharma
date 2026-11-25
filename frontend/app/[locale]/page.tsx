import type { Metadata } from 'next';
import Link from 'next/link';
import { catalogEntityPath } from '../../lib/catalog-path';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowRight, Box, ClipboardList, FileCheck2, Pill, Snowflake, Truck } from 'lucide-react';
import { isLocale } from '../../i18n/routing';
import { buildLocalizedMetadata } from '../../lib/seo';
import { getHomeData } from '../../lib/public-catalog';
import { Hero } from '../../components/home/Hero';
import { SourcingTiles } from '../../components/home/SourcingTiles';
import { Categories } from '../../components/home/Categories';
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
          <div className="product-grid">{data.products.map((product) => <ProductCard key={product.id} product={product} locale={locale}/>)}</div>
          <div className="catalog-view-all"><Link className="catalog-view-all-btn" href={`/${locale}/products`}>{t('viewAllProducts')}<ArrowRight size={17} aria-hidden="true"/></Link></div>
        </>
          : <div className="catalog-empty"><Pill size={30}/><p>{t(data.catalogUnavailable ? 'catalogUnavailable' : 'catalogEmpty')}</p><QuoteButton className="button secondary">{t('request')}</QuoteButton></div>}
      </div></section>
      <section className="section site-container manufacturer-section" id="manufacturers"><div className="section-heading"><div><p className="eyebrow">{t('manufacturersKicker')}</p><h2>{t('manufacturersTitle')}</h2></div><p>{t('manufacturersDescription')}</p></div>{data.manufacturers.length > 0 ? <div className="manufacturer-grid">{data.manufacturers.map((manufacturer) => <div key={manufacturer.id}><Link href={catalogEntityPath(locale, 'manufacturers', manufacturer.alternate_slugs)}>{manufacturer.name}</Link><span>{t('manufacturerLabel')}</span></div>)}</div> : <QuoteButton className="text-button">{t('request')}</QuoteButton>}<p className="small muted">{t('manufacturerNote')}</p>
        <div className="generic-section" id="generics"><h3>{t('genericTitle')}</h3><p className="muted">{t('genericDescription')}</p>{data.generics.length > 0 ? <ul className="generic-list">{data.generics.map((generic) => <li key={generic.id}><Link href={catalogEntityPath(locale, 'generics', generic.alternate_slugs)}>{generic.name}</Link></li>)}</ul> : <QuoteButton className="text-button">{t('request')}</QuoteButton>}</div>
      </section>
      <section className="services-section" id="cold-chain"><div className="site-container services-grid"><div><p className="eyebrow">{t('servicesKicker')}</p><h2>{t('servicesTitle')}</h2><p className="section-intro">{t('servicesDescription')}</p><QuoteButton className="button light">{t('request')}<ArrowRight size={18}/></QuoteButton></div><div className="service-list">
        <article><Snowflake/><div><h3>{t('temperatureTitle')}</h3><p>{t('temperatureBody')}</p></div></article><article><FileCheck2/><div><h3>{t('documentationTitle')}</h3><p>{t('documentationBody')}</p></div></article><article><Truck/><div><h3>{t('coordinationTitle')}</h3><p>{t('coordinationBody')}</p></div></article>
      </div></div></section>
      <section className="section site-container process-section"><p className="eyebrow">MEDAXIS GLOBAL PHARMA</p><h2>{t('processTitle')}</h2><ol className="process-grid"><li><span>01</span><ClipboardList/><h3>{t('stepOneTitle')}</h3><p>{t('stepOneBody')}</p></li><li><span>02</span><FileCheck2/><h3>{t('stepTwoTitle')}</h3><p>{t('stepTwoBody')}</p></li><li><span>03</span><Box/><h3>{t('stepThreeTitle')}</h3><p>{t('stepThreeBody')}</p></li></ol></section>
      <section className="site-container final-cta"><div><h2>{t('ctaTitle')}</h2><p>{t('ctaBody')}</p></div><QuoteButton>{t('request')}<ArrowRight size={18}/></QuoteButton></section>
    </main>
  );
}
