import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isLocale } from '../../i18n/routing';
import { buildLocalizedMetadata } from '../../lib/seo';

export type UtilityProps = { params: Promise<{ locale: string }> };
type Kind = 'privacy' | 'terms';
export async function utilityMetadata({ params }: UtilityProps, kind: Kind): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Utility' });
  return { ...buildLocalizedMetadata({ locale, enPath: `/en/${kind}`, zhPath: `/zh-CN/${kind}`, title: t(kind === 'privacy' ? 'privacyTitle' : 'termsTitle'), description: t(kind === 'privacy' ? 'privacyBody' : 'termsBody') }), robots: { index: false, follow: false } };
}
export async function UtilityPage({ params, kind }: UtilityProps & { kind: Kind }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Utility' });
  return <main id="main-content" className="section site-container utility-page"><p className="eyebrow">MEDAXIS GLOBAL PHARMA</p><h1>{t(kind === 'privacy' ? 'privacyTitle' : 'termsTitle')}</h1><p>{t(kind === 'privacy' ? 'privacyBody' : 'termsBody')}</p>{kind === 'privacy' && <p>{t('analyticsBody')}</p>}<Link className="button secondary" href={`/${locale}`}>{t('back')}</Link></main>;
}
