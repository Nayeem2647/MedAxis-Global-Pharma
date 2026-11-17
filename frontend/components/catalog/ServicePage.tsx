import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FileCheck2, Snowflake, Truck } from 'lucide-react';
import { isLocale } from '../../i18n/routing';
import { buildLocalizedMetadata } from '../../lib/seo';
import { QuoteButton } from '../layout/PublicShell';
import { Breadcrumbs } from './Breadcrumbs';

export type ServiceProps = { params: Promise<{ locale: string }> };
export async function serviceMetadata({ params }: ServiceProps, detail = false): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'Services' });
  const suffix = `/services${detail ? '/pharmaceutical-sourcing' : ''}`;
  return buildLocalizedMetadata({ locale, enPath: `/en${suffix}`, zhPath: `/zh-CN${suffix}`, title: `${t(detail ? 'sourcingTitle' : 'title')} | MedAxis Global Pharma`, description: t('description') });
}

export async function ServicePage({ params, detail = false }: ServiceProps & { detail?: boolean }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Services' });
  const h = await getTranslations({ locale, namespace: 'Home' });
  const path = `/${locale}/services${detail ? '/pharmaceutical-sourcing' : ''}`;
  const capabilities = [{ id: 'cold-chain', Icon: Snowflake, title: 'temperatureTitle', body: 'temperatureBody' }, { id: 'compliance', Icon: FileCheck2, title: 'documentationTitle', body: 'documentationBody' }, { id: 'delivery', Icon: Truck, title: 'coordinationTitle', body: 'coordinationBody' }] as const;
  return <main id="main-content"><div className="section site-container"><Breadcrumbs locale={locale} entries={[{ name: t('title'), href: `/${locale}/services` }, ...(detail ? [{ name: t('sourcingTitle'), href: path }] : [])]}/>
    <header className="service-hero"><p className="eyebrow">MEDAXIS GLOBAL PHARMA</p><h1>{t(detail ? 'sourcingTitle' : 'title')}</h1><p>{t('description')}</p><div className="state-actions"><QuoteButton>{h('request')}</QuoteButton><Link className="button secondary" href={`/${locale}/products`}>{h('browse')}</Link></div></header>
    <div className="service-cards">{capabilities.map(({ id, Icon, title, body }) => <article key={title} id={id}><Icon size={30}/><h2>{h(title)}</h2><p>{h(body)}</p></article>)}</div>
    <section className="sourcing-explainer" id="bulk"><h2>{t('sourcingTitle')}</h2><p>{t('sourcingBody')}</p><p>{t('destinationNote')}</p>{!detail && <Link className="button secondary" href={`/${locale}/services/pharmaceutical-sourcing`}>{t('exploreSourcing')}</Link>}</section>
    <section className="process-section"><h2>{h('processTitle')}</h2><ol className="process-grid">{([['stepOneTitle', 'stepOneBody'], ['stepTwoTitle', 'stepTwoBody'], ['stepThreeTitle', 'stepThreeBody']] as const).map(([title, body], index) => <li key={title}><span>0{index + 1}</span><h3>{h(title)}</h3><p>{h(body)}</p></li>)}</ol></section>
  </div></main>;
}
