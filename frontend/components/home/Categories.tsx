import { getTranslations } from 'next-intl/server';
import { Pill } from 'lucide-react';
import Link from 'next/link';
import { catalogEntityPath } from '../../lib/catalog-path';
import type { Locale } from '../../i18n/routing';
import type { CatalogMaster } from '../../lib/public-catalog';

export async function Categories({ locale, categories }: { locale: Locale; categories: CatalogMaster[] }) {
  if (categories.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'Home' });
  return <section className="section category-section"><div className="site-container">
    <div className="centered-heading"><p className="eyebrow">{t('categoryKicker')}</p><h2>{t('categoryTitle')}</h2><p className="section-intro">{t('categoryDescription')}</p></div>
    <div className="category-grid">{categories.slice(0, 8).map((category, index) => <article className={`category-card category-tone-${index % 4}`} key={category.id}>
      <Link href={catalogEntityPath(locale, 'categories', category.alternate_slugs)}><div className="category-art" aria-hidden="true"><div className="category-package"><Pill size={35} strokeWidth={1.2}/><span/></div></div><h3>{category.name}</h3></Link>
    </article>)}</div>
  </div></section>;
}
