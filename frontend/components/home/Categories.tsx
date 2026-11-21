import { getTranslations } from 'next-intl/server';
import { catalogEntityPath } from '../../lib/catalog-path';
import { CategoryCarousel, type CategoryCarouselItem } from './CategoryCarousel';
import type { Locale } from '../../i18n/routing';
import type { CatalogMaster } from '../../lib/public-catalog';

export async function Categories({ locale, categories }: { locale: Locale; categories: CatalogMaster[] }) {
  if (categories.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const items: CategoryCarouselItem[] = categories.map((category) => ({
    id: category.id,
    href: catalogEntityPath(locale, 'categories', category.alternate_slugs),
    name: category.name,
    imageUrl: category.image_url,
    countLabel: t('categoryProducts', { count: category.product_count ?? 0 }),
  }));

  return (
    <section className="section category-section">
      <div className="site-container">
        <div className="centered-heading">
          <h2>{t('categoryTitle')}</h2>
          <p className="section-intro">{t('categoryDescription')}</p>
        </div>
        <CategoryCarousel
          items={items}
          prevLabel={t('previousCategories')}
          nextLabel={t('nextCategories')}
          sectionLabel={t('categoryTitle')}
        />
      </div>
    </section>
  );
}
