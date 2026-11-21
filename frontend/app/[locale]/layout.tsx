import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isLocale, locales } from '../../i18n/routing';
import { CartProvider } from '../../components/layout/CartProvider';
import { PublicShell } from '../../components/layout/PublicShell';
import { PublicAnalytics } from '../../components/layout/PublicAnalytics';
import { CustomerAccountProvider } from '../../components/customer/CustomerAccountProvider';
import { getAnalyticsConfig, getContactConfig } from '../../lib/public-config';
import { getBanners } from '../../lib/public-catalog';
import '../globals.css';

export function generateStaticParams() { return locales.map((locale) => ({ locale })); }

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const analytics = getAnalyticsConfig();
  const announcements = (await getBanners(locale)).filter((banner) => banner.placement === 'ANNOUNCEMENT');
  return <html lang={locale}><body><NextIntlClientProvider><CartProvider><CustomerAccountProvider><PublicShell contact={getContactConfig()} announcements={announcements}>{children}</PublicShell></CustomerAccountProvider></CartProvider>
    {analytics && <PublicAnalytics {...analytics}/>}</NextIntlClientProvider></body></html>;
}
