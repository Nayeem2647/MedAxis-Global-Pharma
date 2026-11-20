'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Pill, X } from 'lucide-react';
import { apiRequest } from '../../lib/api-client';
import { homeProductSchema, publicAssetUrl, type HomeProduct } from '../../lib/public-catalog';
import { catalogEntityPath } from '../../lib/catalog-path';
import type { ComparisonItem } from '../../lib/product-tools';
import { Modal } from '../layout/Modal';
import { CatalogImage } from './CatalogImage';

export function ProductComparison({ selected, onRemove, onClose }: { selected: readonly ComparisonItem[]; onRemove(id: string): void; onClose(): void }) {
  const t = useTranslations('ProductTools');
  const c = useTranslations('Catalog');
  const locale = useLocale();
  const [records, setRecords] = useState<Record<string, HomeProduct>>({});
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const selections = JSON.stringify(selected);
  useEffect(() => {
    const controller = new AbortController();
    const items = JSON.parse(selections) as ComparisonItem[];
    setLoading(true);
    void Promise.allSettled(items.map(async (item) => {
      const slug = locale === 'zh-CN' ? item.alternate_slugs.zhCN ?? item.alternate_slugs.en : item.alternate_slugs.en;
      const { data } = await apiRequest(`/v1/public/products/${encodeURIComponent(slug)}?locale=${locale}`, homeProductSchema, { cache: 'no-store', signal: controller.signal, timeoutMs: 8000 });
      if (data.id !== item.id) throw new Error('Product identity changed.');
      return data;
    })).then((results) => {
      if (controller.signal.aborted) return;
      setRecords(Object.fromEntries(results.flatMap((result) => result.status === 'fulfilled' ? [[result.value.id, result.value]] : [])));
      setLoading(false);
    });
    return () => controller.abort();
  }, [selections, locale, retry]);
  const fields: Array<{ label: string; value(product: HomeProduct): string }> = [
    { label: c('generic'), value: (product) => product.generic.name },
    { label: c('manufacturer'), value: (product) => product.manufacturer.name },
    { label: c('strength'), value: (product) => product.strength },
    { label: c('dosageForm'), value: (product) => product.dosage_form },
    { label: c('packSize'), value: (product) => product.pack_size },
    { label: c('category'), value: (product) => product.categories.map((category) => category.name).join(', ') },
    { label: c('storage'), value: (product) => product.storage_condition ?? t('notListed') },
    { label: c('handling'), value: (product) => c(product.cold_chain_required ? 'coldChain' : 'standardHandling') },
  ];
  return <Modal title={t('comparisonTitle')} onClose={onClose} className="product-comparison-dialog">
    <p className="muted">{t('comparisonHelp')}</p>
    {selected.length < 2 && <p className="comparison-empty">{t('chooseAnother')}</p>}
    {loading ? <p role="status">{t('loadingComparison')}</p> : selected.length > 0 && <>
      <div className="comparison-table-scroll" role="region" aria-label={t('comparisonTitle')} tabIndex={0}><table className="comparison-table"><thead><tr><th scope="col">{t('specification')}</th>{selected.map((item) => {
        const product = records[item.id];
        const image = publicAssetUrl(product?.primary_image_url);
        return <th scope="col" key={item.id}><button className="comparison-remove" type="button" aria-label={t('removeNamed', { name: product?.brand_name ?? item.name })} onClick={() => onRemove(item.id)}><X size={17}/></button>
          <div className="comparison-image">{image ? <CatalogImage src={image} alt={product!.brand_name} width={180} height={180} sizes="160px" fallbackLabel={c('imageUnavailable')}/> : <Pill size={35} strokeWidth={1}/>}</div>
          {product ? <Link href={catalogEntityPath(locale, 'products', product.alternate_slugs)} onClick={onClose}>{product.brand_name}</Link> : <><span>{item.name}</span><p className="form-error">{t('productUnavailable')}</p></>}
        </th>;
      })}</tr></thead><tbody>{fields.map(({ label, value }) => <tr key={label}><th scope="row">{label}</th>{selected.map((item) => <td key={item.id}>{records[item.id] ? value(records[item.id]) : '—'}</td>)}</tr>)}</tbody></table></div>
      {selected.some((item) => !records[item.id]) && <button type="button" className="button secondary" onClick={() => setRetry((value) => value + 1)}>{t('retry')}</button>}
    </>}
  </Modal>;
}
