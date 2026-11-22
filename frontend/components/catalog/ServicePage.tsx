import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isLocale } from '../../i18n/routing';
import { getContactConfig } from '../../lib/public-config';
import { buildLocalizedMetadata } from '../../lib/seo';
import { Breadcrumbs } from './Breadcrumbs';
import { ServicesExperience } from '../services/ServicesExperience';

export type ServiceProps = { params: Promise<{ locale: string }> };

export async function serviceMetadata({ params }: ServiceProps, detail = false): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Services' });
  const suffix = `/services${detail ? '/pharmaceutical-sourcing' : ''}`;
  return buildLocalizedMetadata({
    locale,
    enPath: `/en${suffix}`,
    zhPath: `/zh-CN${suffix}`,
    title: `${t(detail ? 'sourcingTitle' : 'title')} | MedAxis Global Pharma`,
    description: t('description'),
  });
}

export async function ServicePage({ params, detail = false }: ServiceProps & { detail?: boolean }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Services' });
  const contact = getContactConfig();
  const path = `/${locale}/services${detail ? '/pharmaceutical-sourcing' : ''}`;
  const breadcrumbs = (
    <Breadcrumbs
      locale={locale}
      entries={[
        { name: t('title'), href: `/${locale}/services` },
        ...(detail ? [{ name: t('sourcingTitle'), href: path }] : []),
      ]}
    />
  );
  return <ServicesExperience routeLocale={locale} detail={detail} contact={contact} breadcrumbs={breadcrumbs} />;
}
