import { defineRouting } from 'next-intl/routing';

export const locales = ['en', 'zh-CN'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh-CN';
}

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeDetection: false,
  alternateLinks: false,
  localeCookie: { name: 'medaxis_locale', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', path: '/' },
});
