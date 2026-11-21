import { getTranslations } from 'next-intl/server';
import type { Locale } from '../i18n/routing';
import type { HeroPanelCopy } from '../components/home/HeroPanel';

export async function getHeroCopy(locale: Locale): Promise<HeroPanelCopy> {
  const [home, catalog] = await Promise.all([
    getTranslations({ locale, namespace: 'Home' }),
    getTranslations({ locale, namespace: 'Catalog' }),
  ]);
  return {
    kicker: home('heroKicker'), title: home('title'), description: home('description'), note: home('heroNote'),
    request: home('heroRequest'), browse: home('heroBrowse'),
    manufacturer: home('heroManufacturer'), coordination: home('heroCoordination'),
    allCategories: catalog('allCategories'), searchPlaceholder: home('heroSearchPlaceholder'),
  };
}
