import type { Metadata } from 'next';
import type { Locale } from '../i18n/routing';

export function siteOrigin(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://medaxisglobalpharma.com');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin.');
  }
  return url.origin;
}

export function localizedAlternates(locale: Locale, paths: Record<Locale, string>): NonNullable<Metadata['alternates']> {
  return buildLocalizedMetadata({ locale, enPath: `/en${paths.en}`, zhPath: `/zh-CN${paths['zh-CN']}`, title: '', description: '' }).alternates ?? {};
}

export function publicLocalePath(value: string, locale: Locale): string | null {
  try {
    if (decodeURIComponent(value).split('/').some((part) => part === '.' || part === '..')) return null;
    const url = new URL(value, siteOrigin());
    const decoded = decodeURIComponent(url.pathname);
    if (url.origin !== siteOrigin() || url.search || url.hash || !new RegExp(`^/${locale}(?:/|$)`).test(decoded)
      || /[\\\x00-\x20]/.test(decoded) || decoded.includes('//') || /\/(?:q|admin|api|_next)(?:\/|$)/.test(decoded)
      || decoded.split('/').some((part) => part === '.' || part === '..')) return null;
    return url.pathname.replace(/\/$/, '');
  } catch { return null; }
}

export function buildLocalizedMetadata({ locale, enPath, zhPath, title, description, currentPath, noindex = false }: {
  locale: Locale; enPath: string; zhPath: string | null; title: string; description: string; currentPath?: string; noindex?: boolean;
}): Metadata {
  const en = publicLocalePath(enPath, 'en');
  const zh = zhPath === null ? null : publicLocalePath(zhPath, 'zh-CN');
  const fallback = locale === 'zh-CN' && zhPath === null;
  const self = fallback && currentPath ? publicLocalePath(currentPath, 'zh-CN') : locale === 'en' ? en : zh;
  if (!en || (zhPath !== null && !zh) || !self) throw new Error('Metadata requires valid public counterpart paths and an explicit untranslated fallback path.');
  const english = `${siteOrigin()}${en}`;
  const chinese = zh ? `${siteOrigin()}${zh}` : null;
  return { title, description, alternates: {
    canonical: `${siteOrigin()}${self}`,
    languages: { en: english, ...(chinese ? { 'zh-CN': chinese } : {}), 'x-default': english },
  }, ...((fallback || noindex) ? { robots: { index: false, follow: true } } : {}) };
}
