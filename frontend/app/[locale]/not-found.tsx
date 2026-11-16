import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const locale = await getLocale();
  const t = await getTranslations('Catalog');
  return <main id="main-content" className="section site-container catalog-state"><h1>{t('notFound')}</h1><p>{t('notFoundHelp')}</p><Link className="button primary" href={`/${locale}/products`}>{t('products')}</Link></main>;
}
