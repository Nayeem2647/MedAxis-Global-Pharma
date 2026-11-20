import { getTranslations } from 'next-intl/server';
import { ArrowDown, ArrowRight, Globe2, ShieldCheck } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import type { Banner } from '../../lib/public-catalog';
import { QuoteButton } from '../layout/PublicShell';
import { HeroArtwork } from './HeroArtwork';
import { PlacementBanner } from './PlacementBanner';
import { SearchForm } from '../catalog/SearchForm';

export async function Hero({ locale, banners = [] }: { locale: Locale; banners?: Banner[] }) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  const heroBanners = banners.filter((banner) => banner.placement === 'MAIN_HERO' && banner.media_url);

  if (heroBanners.length > 0) {
    const usesOverlay = heroBanners.some((banner) => banner.show_overlay);
    if (usesOverlay) {
      return (
        <section className="hero hero-with-banner">
          <PlacementBanner banners={heroBanners} locale={locale} variant="hero">
            <div className="site-container hero-copy hero-copy-over-media">
              <p className="eyebrow"><span />{t('heroKicker')}</p>
              <h1>{t('title')}</h1>
              <p className="hero-description">{t('description')}</p>
              <p className="hero-note">{t('heroNote')}</p>
              <SearchForm locale={locale} />
              <div className="hero-actions">
                <QuoteButton>{t('request')}<ArrowRight size={18} /></QuoteButton>
                <a className="button secondary" href={`/${locale}/products`}>{t('browse')}<ArrowDown size={17} /></a>
              </div>
              <div className="hero-assurance">
                <span><ShieldCheck size={17} />{t('manufacturerDirect')}</span>
                <span><Globe2 size={17} />{t('globalCoordination')}</span>
              </div>
            </div>
          </PlacementBanner>
        </section>
      );
    }

    return (
      <section className="hero-banner-stage">
        <PlacementBanner banners={heroBanners} locale={locale} variant="hero" />
        <div className="hero-search-dock">
          <div className="site-container hero-search-dock-inner">
            <div className="hero-search-dock-copy">
              <h1 className="hero-dock-title">{t('title')}</h1>
              <p className="hero-dock-desc">{t('description')}</p>
            </div>
            <div className="hero-search-dock-controls">
              <SearchForm locale={locale} />
              <div className="hero-actions">
                <QuoteButton>{t('request')}<ArrowRight size={18} /></QuoteButton>
                <a className="button secondary" href={`/${locale}/products`}>{t('browse')}<ArrowDown size={17} /></a>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hero">
      <HeroArtwork />
      <div className="site-container hero-copy">
        <p className="eyebrow"><span />{t('heroKicker')}</p>
        <h1>{t('title')}</h1>
        <p className="hero-description">{t('description')}</p>
        <p className="hero-note">{t('heroNote')}</p>
        <SearchForm locale={locale} />
        <div className="hero-actions">
          <QuoteButton>{t('request')}<ArrowRight size={18} /></QuoteButton>
          <a className="button secondary" href={`/${locale}/products`}>{t('browse')}<ArrowDown size={17} /></a>
        </div>
        <div className="hero-assurance">
          <span><ShieldCheck size={17} />{t('manufacturerDirect')}</span>
          <span><Globe2 size={17} />{t('globalCoordination')}</span>
        </div>
      </div>
    </section>
  );
}
