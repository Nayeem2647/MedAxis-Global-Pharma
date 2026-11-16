import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies, headers } from 'next/headers';
import { QuotationLocale } from '../../components/quotation/QuotationLocale';
import { isLocale } from '../../i18n/routing';
import en from '../../messages/en.json';
import zh from '../../messages/zh-CN.json';
import '../globals.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const metadata: Metadata = {
  title: 'Private quotation | MedAxis Global Pharma', referrer: 'no-referrer',
  robots: { index: false, follow: false, noarchive: true, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
};

export default async function QuotationLayout({ children }: { children: ReactNode }) {
  const preference = (await cookies()).get('medaxis_locale')?.value;
  const locale = isLocale(preference) ? preference : /^zh/i.test((await headers()).get('accept-language') ?? '') ? 'zh-CN' : 'en';
  const messages = { en: { Quotation: en.Quotation, Contact: en.Contact, Shell: { close: en.Shell.close } }, 'zh-CN': { Quotation: zh.Quotation, Contact: zh.Contact, Shell: { close: zh.Shell.close } } };
  return <html lang={locale}><body className="quotation-body"><QuotationLocale initialLocale={locale} messages={messages}>{children}</QuotationLocale></body></html>;
}
