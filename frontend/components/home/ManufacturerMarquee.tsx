import type { CSSProperties } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { catalogEntityPath } from '../../lib/catalog-path';
import type { Locale } from '../../i18n/routing';
import type { CatalogMaster } from '../../lib/public-catalog';

export async function ManufacturerMarquee({ locale, manufacturers }: { locale: Locale; manufacturers: CatalogMaster[] }) {
  const uniqueManufacturers = [...new Map(manufacturers.map((item) => [item.id, item])).values()];
  const withLogos = uniqueManufacturers.filter((item) => Boolean(item.image_url));
  const displayManufacturers = withLogos.length > 0 ? withLogos : uniqueManufacturers;
  if (displayManufacturers.length === 0) return null;

  const t = await getTranslations({ locale, namespace: 'Home' });
  const items = displayManufacturers.map((manufacturer) => ({
    id: manufacturer.id,
    href: catalogEntityPath(locale, 'manufacturers', manufacturer.alternate_slugs),
    name: manufacturer.name,
    imageUrl: manufacturer.image_url,
  }));
  const shouldScroll = items.length >= 7;

  return (
    <section className="manufacturer-marquee-section" id="trusted-manufacturers" aria-labelledby="trusted-manufacturers-heading">
      <div className="site-container">
        <div className="centered-heading">
          <h2 id="trusted-manufacturers-heading">{t('marqueeManufacturersTitle')}</h2>
          <p className="section-intro">{t('marqueeManufacturersDescription')}</p>
        </div>
        <div className={`manufacturer-marquee${shouldScroll ? '' : ' is-static'}`}>
          <div
            className="manufacturer-marquee-track"
            style={shouldScroll ? ({ '--marquee-duration': `${Math.max(24, items.length * 3.5)}s` } as CSSProperties) : undefined}
          >
            <ul className="manufacturer-marquee-group">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className="manufacturer-logo-item" title={item.name}>
                    {item.imageUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" />
                      : <span className="manufacturer-logo-text">{item.name}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {shouldScroll && (
              <ul className="manufacturer-marquee-group" aria-hidden="true">
                {items.map((item) => (
                  <li key={`dup-${item.id}`}>
                    <Link href={item.href} className="manufacturer-logo-item" tabIndex={-1}>
                      {item.imageUrl
                        ? /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
                        : <span className="manufacturer-logo-text">{item.name}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
