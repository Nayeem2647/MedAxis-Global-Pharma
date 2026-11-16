import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '../../i18n/routing';
import { serializeStructuredData } from '../../lib/catalog-seo';
import { siteOrigin } from '../../lib/seo';

export async function Breadcrumbs({ locale, entries }: { locale: Locale; entries: { name: string; href: string }[] }) {
  const t = await getTranslations({ locale, namespace: 'Catalog' });
  const items = [{ name: t('home'), href: `/${locale}` }, ...entries];
  const schema = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: `${siteOrigin()}${item.href}` })) };
  return <><nav className="breadcrumbs" aria-label={t('breadcrumbs')}><ol>{items.map((item, index) => <li key={item.href}>{index === items.length - 1 ? <span aria-current="page">{item.name}</span> : <Link href={item.href}>{item.name}</Link>}</li>)}</ol></nav><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeStructuredData(schema) }}/></>;
}
