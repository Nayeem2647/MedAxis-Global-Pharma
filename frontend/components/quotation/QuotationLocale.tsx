'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import type { Locale } from '../../i18n/routing';

const LocaleContext = createContext<{ locale: Locale; setLocale(locale: Locale): void } | null>(null);
export function QuotationLocale({ initialLocale, messages, children }: { initialLocale: Locale; messages: Record<Locale, AbstractIntlMessages>; children: ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <LocaleContext.Provider value={{ locale, setLocale }}><NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">{children}</NextIntlClientProvider></LocaleContext.Provider>;
}
export function QuotationLanguage() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('QuotationLanguage requires its independent locale provider.');
  return <div className="quotation-languages" role="group" aria-label="English / 简体中文">
    <button type="button" lang="en" aria-pressed={context.locale === 'en'} onClick={() => context.setLocale('en')}>English</button><span aria-hidden="true">|</span>
    <button type="button" lang="zh-CN" aria-pressed={context.locale === 'zh-CN'} onClick={() => context.setLocale('zh-CN')}>简体中文</button>
  </div>;
}
