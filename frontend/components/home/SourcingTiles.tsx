import { getTranslations } from 'next-intl/server';
import { ArrowRight, ClipboardList, Factory, HeartHandshake, Snowflake } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import { browseProductsBy } from '../../lib/catalog-path';
import { QuoteButton } from '../layout/PublicShell';

export async function SourcingTiles({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  return <section className="sourcing-section site-container" aria-label={t('sourcingSupport')}>
    <div className="sourcing-grid">
      <article className="sourcing-tile tile-blue"><Factory className="tile-icon" size={31} strokeWidth={1.4}/><p className="tile-kicker">{t('tileManufacturerKicker')}</p><h2>{t('tileManufacturerTitle')}</h2><p>{t('tileManufacturerBody')}</p><a className="tile-link" href={browseProductsBy(locale, 'manufacturer')}>{t('meetManufacturers')}<ArrowRight size={16}/></a></article>
      <article className="sourcing-tile tile-pink"><HeartHandshake className="tile-icon" size={31} strokeWidth={1.4}/><p className="tile-kicker">{t('tilePatientKicker')}</p><h2>{t('tilePatientTitle')}</h2><p>{t('tilePatientBody')}</p><QuoteButton className="tile-link">{t('startEnquiry')}<ArrowRight size={16}/></QuoteButton></article>
      <article className="sourcing-tile tile-mint"><Snowflake className="tile-icon" size={31} strokeWidth={1.4}/><p className="tile-kicker">{t('tileHandlingKicker')}</p><h2>{t('tileHandlingTitle')}</h2><p>{t('tileHandlingBody')}</p><a className="tile-link" href={`/${locale}/services`}>{t('exploreHandling')}<ArrowRight size={16}/></a></article>
      <article className="sourcing-tile tile-yellow"><ClipboardList className="tile-icon" size={31} strokeWidth={1.4}/><p className="tile-kicker">{t('tileRfqKicker')}</p><h2>{t('tileRfqTitle')}</h2><p>{t('tileRfqBody')}</p><a className="tile-link" href={`/${locale}/products`}>{t('prepareList')}<ArrowRight size={16}/></a></article>
    </div>
  </section>;
}
