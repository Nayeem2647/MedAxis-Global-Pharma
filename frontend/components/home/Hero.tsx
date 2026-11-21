import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import type { Banner } from '../../lib/public-catalog';
import { QuoteButton } from '../layout/PublicShell';
import { HeroArtwork } from './HeroArtwork';
import { PlacementBanner } from './PlacementBanner';
import { SearchForm } from '../catalog/SearchForm';
import { HeroPanel } from './HeroPanel';
import { getHeroCopy } from '../../lib/hero-copy';

export async function Hero({ locale, banners = [] }: { locale: Locale; banners?: Banner[] }) {
  const copy = await getHeroCopy(locale);
  const heroBanners = banners.filter((banner) => banner.placement === 'MAIN_HERO' && banner.media_url);
  const panel = <HeroPanel copy={copy}
    search={<SearchForm locale={locale} placeholder={copy.searchPlaceholder} />}
    actions={<>
      <QuoteButton>{copy.request}<ArrowUpRight size={18} aria-hidden="true" /></QuoteButton>
      <a className="button secondary" href={`/${locale}/products`}>{copy.browse}<ArrowRight size={18} aria-hidden="true" /></a>
    </>}
  />;

  if (heroBanners.length > 0) {
    return (
      <section className="hero-banner-stage">
        <PlacementBanner banners={heroBanners} locale={locale} variant="hero">{panel}</PlacementBanner>
      </section>
    );
  }

  return (
    <section className="hero hero-banner-fallback">
      <HeroArtwork />
      <div className="hero-persistent-overlay">{panel}</div>
    </section>
  );
}
