'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { Check } from 'lucide-react';
import { locales, type Locale } from '../../i18n/routing';
import { counterpartPath, localizedCatalogSearch, type CatalogLocaleFilter } from '../../lib/locale-navigation';

export function LocaleSwitcher({ enPath, zhPath }: { enPath?: string; zhPath?: string }) {
  const locale = useLocale();
  const t = useTranslations('Shell');
  const pathname = usePathname();
  const router = useRouter();
  function switchLocale(event: MouseEvent<HTMLAnchorElement>, target: Locale) {
    const provided = target === 'en' ? enPath : zhPath;
    const metadata = document.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${target}"]`)?.href;
    const path = counterpartPath(target, pathname, provided ?? metadata);
    const filters: CatalogLocaleFilter[] = Array.from(document.querySelectorAll<HTMLOptionElement>('select[data-catalog-filter] option[data-en-slug]')).flatMap((option) => {
      const field = option.parentElement?.getAttribute('data-catalog-filter');
      const en = option.dataset.enSlug;
      return en && (field === 'manufacturer' || field === 'generic' || field === 'category') ? [{ field, en, zhCN: option.dataset.zhSlug ?? null }] : [];
    });
    const href = `${path}${localizedCatalogSearch(window.location.search, target, filters)}${window.location.hash}`;
    document.cookie = `medaxis_locale=${target}; Max-Age=31536000; Path=/; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    event.currentTarget.href = href;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
      event.preventDefault(); router.push(href);
    }
  }
  return <nav className="locale-switcher" aria-label={t('language')}>
    {locales.map((target) => <a key={target} href={counterpartPath(target, pathname, target === 'en' ? enPath : zhPath)} lang={target} hrefLang={target}
      aria-current={target === locale ? 'true' : undefined} onClick={(event) => switchLocale(event, target)}><span>{target === 'en' ? 'English' : '简体中文'}</span><Check className="locale-switcher-check" size={13} strokeWidth={2.5} aria-hidden="true"/></a>)}
  </nav>;
}
