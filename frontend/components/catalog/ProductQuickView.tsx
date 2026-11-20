'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Pill } from 'lucide-react';
import { publicAssetUrl, type HomeProduct } from '../../lib/public-catalog';
import { catalogEntityPath } from '../../lib/catalog-path';
import { productCartInput } from '../../lib/product-tools';
import { Modal } from '../layout/Modal';
import { usePublicShell } from '../layout/PublicShell';
import { CatalogImage } from './CatalogImage';
import { CustomerRating } from './ProductRating';

export function ProductQuickView({ product, onClose }: { product: HomeProduct; onClose(): void }) {
  const t = useTranslations('ProductTools');
  const c = useTranslations('Catalog');
  const locale = useLocale();
  const { openQuickQuote } = usePublicShell();
  const image = publicAssetUrl(product.primary_image_url);
  const fields = [[c('generic'), product.generic.name], [c('manufacturer'), product.manufacturer.name], [c('strength'), product.strength], [c('dosageForm'), product.dosage_form], [c('packSize'), product.pack_size]];
  return <Modal title={t('quickView')} onClose={onClose} className="product-quick-view">
    <div className="quick-view-grid"><div className="quick-view-image">{image ? <CatalogImage src={image} alt={product.brand_name} width={480} height={480} sizes="(max-width: 640px) 80vw, 360px" fallbackLabel={c('imageUnavailable')}/> : <Pill size={70} strokeWidth={1}/>}</div>
      <div><p className="quick-view-manufacturer">{product.manufacturer.name}</p><h3>{product.brand_name}</h3><CustomerRating product={product} interactive={false}/>
        <dl className="quick-view-facts">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {product.description && <p className="quick-view-description">{product.description.slice(0, 360)}{product.description.length > 360 ? '…' : ''}</p>}
        <div className="quick-view-buttons"><button type="button" className="button primary" onClick={() => { onClose(); openQuickQuote(productCartInput(product)); }}>{t('requestQuote')}</button><Link className="button secondary" href={catalogEntityPath(locale, 'products', product.alternate_slugs)} onClick={onClose}>{t('viewDetails')}</Link></div>
      </div>
    </div>
  </Modal>;
}
