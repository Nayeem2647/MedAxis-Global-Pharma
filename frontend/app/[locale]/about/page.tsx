import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Building2, Calendar, Compass, Eye, ShieldCheck } from 'lucide-react';
import { isLocale } from '../../../i18n/routing';
import { buildLocalizedMetadata } from '../../../lib/seo';
import { QuoteButton } from '../../../components/layout/PublicShell';
import { Breadcrumbs } from '../../../components/catalog/Breadcrumbs';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'About' });
  return buildLocalizedMetadata({
    locale,
    enPath: '/en/about',
    zhPath: '/zh-CN/about',
    title: `${t('title')} | MedAxis Global Pharma`,
    description: t('description'),
  });
}

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'About' });
  const h = await getTranslations({ locale, namespace: 'Home' });
  const s = await getTranslations({ locale, namespace: 'Shell' });
  const pillars = [
    { Icon: Compass, title: 'missionTitle', body: 'missionBody' },
    { Icon: Eye, title: 'visionTitle', body: 'visionBody' },
    { Icon: ShieldCheck, title: 'valuesTitle', body: 'valuesBody' },
  ] as const;

  return (
    <main id="main-content">
      <div className="section site-container">
        <Breadcrumbs locale={locale} entries={[{ name: s('about'), href: `/${locale}/about` }]} />
        <header className="service-hero">
          <p className="eyebrow">MEDAXIS GLOBAL PHARMA</p>
          <h1>{t('title')}</h1>
          <p>{t('description')}</p>
          <div className="state-actions">
            <QuoteButton>{h('request')}</QuoteButton>
            <Link className="button secondary" href={`/${locale}/products`}>{h('browse')}</Link>
          </div>
        </header>

        <section id="overview" className="info-section">
          <p className="eyebrow">{s('companyInfo')}</p>
          <h2>{t('overviewTitle')}</h2>
          <p className="muted">{t('overviewSubtitle')}</p>
          <div className="service-cards">
            {pillars.map(({ Icon, title, body }) => (
              <article key={title}>
                <Icon size={30} />
                <h3>{t(title)}</h3>
                <p>{t(body)}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="news" className="info-section">
          <h2>{t('newsTitle')}</h2>
          <p className="muted">{t('newsSubtitle')}</p>
          <div className="service-cards">
            <article>
              <Building2 size={30} />
              <h3>{t('newsOneTitle')}</h3>
              <p>{t('newsOneBody')}</p>
            </article>
            <article>
              <Calendar size={30} />
              <h3>{t('newsTwoTitle')}</h3>
              <p>{t('newsTwoBody')}</p>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}
