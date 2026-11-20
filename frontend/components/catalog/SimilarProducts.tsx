import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ArrowRight } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import type { HomeProduct } from '../../lib/public-catalog';
import { getSimilarProducts } from '../../lib/catalog-data';
import { ProductCard } from './ProductCard';
import { SimilarProductsCarousel } from './SimilarProductsCarousel';

export async function SimilarProducts({ product, locale }: { product: HomeProduct; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const { products, unavailable } = await getSimilarProducts(locale, product);
  return <section className="similar-products" aria-labelledby="similar-products-heading">
    <div className="similar-products-heading"><h2 id="similar-products-heading">{t('similarProducts')}</h2><Link href={`/${locale}/products`}>{t('browseProducts')}<ArrowRight size={17} aria-hidden="true"/></Link></div>
    {products.length ? <SimilarProductsCarousel count={products.length}>{products.map((item) => <div className="similar-product-item" role="listitem" key={item.id}><ProductCard product={item} locale={locale}/></div>)}</SimilarProductsCarousel>
      : <p className="similar-products-empty">{t(unavailable ? 'similarProductsUnavailable' : 'similarProductsEmpty')}</p>}
  </section>;
}
