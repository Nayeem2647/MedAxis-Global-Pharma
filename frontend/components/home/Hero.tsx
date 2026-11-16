import { getTranslations } from 'next-intl/server';
import { ArrowDown, ArrowRight, Globe2, ShieldCheck } from 'lucide-react';
import type { Locale } from '../../i18n/routing';
import { QuoteButton } from '../layout/PublicShell';
import { HeroArtwork } from './HeroArtwork';
import { SearchForm } from '../catalog/SearchForm';

export async function Hero({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  return <section className="hero">
    <HeroArtwork/>
    <div className="site-container hero-copy">
      <p className="eyebrow"><span/>{t('heroKicker')}</p>
      <h1>{t('title')}</h1>
      <p className="hero-description">{t('description')}</p>
      <p className="hero-note">{t('heroNote')}</p>
      <SearchForm locale={locale}/>
      <div className="hero-actions"><QuoteButton>{t('request')}<ArrowRight size={18}/></QuoteButton><a className="button secondary" href={`/${locale}/products`}>{t('browse')}<ArrowDown size={17}/></a></div>
      <div className="hero-assurance"><span><ShieldCheck size={17}/>{t('manufacturerDirect')}</span><span><Globe2 size={17}/>{t('globalCoordination')}</span></div>
    </div>
  </section>;
}
