import type { CSSProperties } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { catalogEntityPath } from '../../lib/catalog-path';
import type { Locale } from '../../i18n/routing';
import type { CatalogMaster } from '../../lib/public-catalog';

export async function ManufacturerMarquee({ locale, manufacturers }: { locale: Locale; manufacturers: CatalogMaster[] }) {
  if (manufacturers.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const repeatCount = manufacturers.length >= 8 ? 1 : Math.ceil(8 / manufacturers.length);
  const loopItems = Array.from({ length: repeatCount }, (_, repeat) =>
    manufacturers.map((manufacturer) => ({
      key: `${repeat}-${manufacturer.id}`,
      href: catalogEntityPath(locale, 'manufacturers', manufacturer.alternate_slugs),
      name: manufacturer.name,
      imageUrl: manufacturer.image_url,
    })),
  ).flat();

  return (
    <section className="manufacturer-marquee-section" id="trusted-manufacturers" aria-labelledby="trusted-manufacturers-heading">
      <div className="site-container">
        <div className="centered-heading">
          <h2 id="trusted-manufacturers-heading">{t('marqueeManufacturersTitle')}</h2>
          <p className="section-intro">{t('marqueeManufacturersDescription')}</p>
        </div>
        <div className="manufacturer-marquee">
          <div
            className="manufacturer-marquee-track"
            style={{ '--marquee-duration': `${Math.max(22, loopItems.length * 3)}s` } as CSSProperties}
          >
            <ul className="manufacturer-marquee-group">
              {loopItems.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="manufacturer-logo-item" title={item.name}>
                    {item.imageUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.imageUrl} alt={item.name} loading="lazy" decoding="async" />
                      : <span className="manufacturer-logo-text">{item.name}</span>}
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="manufacturer-marquee-group" aria-hidden="true">
              {loopItems.map((item) => (
                <li key={`dup-${item.key}`}>
                  <Link href={item.href} className="manufacturer-logo-item" tabIndex={-1}>
                    {item.imageUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
                      : <span className="manufacturer-logo-text">{item.name}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
