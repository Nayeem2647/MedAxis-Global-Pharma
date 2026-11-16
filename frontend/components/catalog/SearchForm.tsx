import Link from 'next/link';
import { Search } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '../../i18n/routing';
import { getMasterOptions } from '../../lib/catalog-data';
import { CatalogForm } from './CatalogForm';

export async function SearchForm({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const categories = await getMasterOptions(locale, 'categories');
  return <CatalogForm className="hero-search" action={`/${locale}/products`} search label={t('searchCatalog')} loadingLabel={t('loading')}>
    {categories.complete ? <label><span className="sr-only">{t('category')}</span><select name="category" defaultValue=""><option value="">{t('allCategories')}</option>{categories.options.map((category) => <option key={category.id} value={locale === 'zh-CN' ? category.alternate_slugs.zhCN ?? category.alternate_slugs.en : category.alternate_slugs.en}>{category.name}</option>)}</select></label>
      : <Link className="search-category-link" href={`/${locale}/categories`}>{t('categories')}</Link>}
    <label className="search-query"><span className="sr-only">{t('searchMedicines')}</span><input name="q" type="search" maxLength={100} placeholder={t('searchPlaceholder')}/></label>
    <button type="submit" aria-label={t('searchCatalog')}><Search size={21}/></button>
  </CatalogForm>;
}
