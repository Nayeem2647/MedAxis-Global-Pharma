import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Pill, Snowflake } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import { publicAssetUrl, type HomeProduct } from '../../lib/public-catalog';
import { catalogEntityPath } from '../../lib/catalog-path';
import { ProductActions } from '../home/ProductActions';
import { CatalogImage } from './CatalogImage';
import { ProductHoverActions } from './ProductHoverActions';
import { CustomerRating } from './ProductRating';

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
    <div className="product-media"><Link className="product-image" href={href} aria-label={c('viewNamed', { name: product.brand_name })}>{image
      ? <CatalogImage src={image} alt={product.image_alt_text ?? `${product.brand_name} · ${product.generic.name} · ${product.manufacturer.name}`} width={640} height={640} sizes="(max-width: 480px) 90vw, (max-width: 760px) 45vw, (max-width: 1100px) 32vw, 25vw" fallbackLabel={c('imageUnavailable')}/>
      : <div className="product-placeholder" aria-hidden="true"><Pill size={43} strokeWidth={1.2}/></div>}
      {product.cold_chain_required && <span className="cold-badge"><Snowflake size={14}/>{t('coldChain')}</span>}
    </Link><ProductHoverActions product={product}/></div>
    <div className="product-body">
      <div className="product-card-copy">
        <p className="product-manufacturer" title={product.manufacturer.name}>{product.manufacturer.name}</p>
        <h3>
          <Link className="product-card-link" href={href} title={`${product.brand_name} (${product.generic.name})`}>
            <span className="product-title-line">
              {product.brand_name} <span className="product-generic-inline">({product.generic.name})</span>
            </span>
          </Link>
        </h3>
        <p className="product-spec">
          {[[c('strength'), product.strength], [c('dosageForm'), product.dosage_form], [c('packSize'), product.pack_size]].map(([label, value]) => <span key={label} title={label} aria-label={`${label}: ${value}`}>{value}</span>)}
        </p>
      </div>
      <CustomerRating product={product}/>
      <ProductActions product={cartInput(product)}/>
    </div>
  </article>;
}
