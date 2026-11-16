import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isLocale, locales } from '../../i18n/routing';
import { CartProvider } from '../../components/layout/CartProvider';
import { PublicShell } from '../../components/layout/PublicShell';
import { PublicAnalytics } from '../../components/layout/PublicAnalytics';
import { getAnalyticsConfig, getContactConfig } from '../../lib/public-config';
import '../globals.css';

export function generateStaticParams() { return locales.map((locale) => ({ locale })); }

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const analytics = getAnalyticsConfig();
  return <html lang={locale}><body><NextIntlClientProvider><CartProvider><PublicShell contact={getContactConfig()}>{children}</PublicShell></CartProvider>
    {analytics && <PublicAnalytics {...analytics}/>}</NextIntlClientProvider></body></html>;
}
