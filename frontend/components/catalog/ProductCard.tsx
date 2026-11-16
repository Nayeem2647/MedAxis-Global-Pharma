import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Pill, Snowflake } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import { publicAssetUrl, type HomeProduct } from '../../lib/public-catalog';
import { catalogEntityPath } from '../../lib/catalog-path';
import { ProductActions } from '../home/ProductActions';
import { CatalogImage } from './CatalogImage';

export function cartInput(product: HomeProduct) {
  return { productId: product.id, name: product.brand_name,
    names: { en: product.translations.en.brand_name, ...(product.translations.zhCN ? { 'zh-CN': product.translations.zhCN.brand_name } : {}) },
    strength: product.strength, packagingUnit: product.packaging_unit, quantity: 1 };
}

export async function ProductCard({ product, locale }: { product: HomeProduct; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  const c = await getTranslations({ locale, namespace: 'Catalog' });
  const image = publicAssetUrl(product.primary_image_url);
  const href = catalogEntityPath(locale, 'products', product.alternate_slugs);
  return <article className="product-card">
    <Link className="product-image" href={href} aria-label={c('viewNamed', { name: product.brand_name })}>{image
      ? <CatalogImage src={image} alt={product.image_alt_text ?? `${product.brand_name} · ${product.generic.name} · ${product.manufacturer.name}`} width={360} height={240} sizes="(max-width: 640px) 90vw, (max-width: 1000px) 45vw, 30vw" fallbackLabel={c('imageUnavailable')}/>
      : <div className="product-placeholder" aria-hidden="true"><Pill size={43} strokeWidth={1.2}/></div>}
      {product.cold_chain_required && <span className="cold-badge"><Snowflake size={14}/>{t('coldChain')}</span>}
    </Link>
    <div className="product-body"><p className="product-manufacturer"><Link href={catalogEntityPath(locale, 'manufacturers', product.manufacturer.alternate_slugs)}>{product.manufacturer.name}</Link></p><h3><Link href={href}>{product.brand_name}</Link></h3><p className="product-generic"><Link href={catalogEntityPath(locale, 'generics', product.generic.alternate_slugs)}>{product.generic.name}</Link></p><p className="product-spec">{product.strength} · {product.dosage_form} · {product.pack_size}</p><span className="availability"><span/>{t('onRequest')}</span><ProductActions product={cartInput(product)}/></div>
  </article>;
}
