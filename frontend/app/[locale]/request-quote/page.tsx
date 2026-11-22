import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isLocale } from '../../../i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Shell' });
  return { title: `${t('quickQuote')} | MedAxis Global Pharma`, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

// PublicShell keeps the enquiry mounted across client navigation so its draft and
// any unresolved submission remain in memory until the buyer explicitly exits.
export default function RequestQuotePage() {
  return null;
}
