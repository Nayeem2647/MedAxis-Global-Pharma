'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { Banner } from '../../lib/public-catalog';
import { publicLocalePath } from '../../lib/seo';

export function Announcements({ banners }: { banners: Banner[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const t = useTranslations('Home');
  const locale = useLocale();
  return <div>{banners.filter((banner) => !dismissed.includes(banner.id)).map((banner) => {
    const path = banner.link_path ? publicLocalePath(banner.link_path, locale) : null;
    return <aside className="announcement" key={banner.id}><div className="site-container"><div><strong>{banner.title}</strong><span>{banner.body}</span>{path && <Link href={path}>{t('learnMore')}</Link>}</div><button className="icon-button" aria-label={t('dismissAnnouncement')} onClick={() => setDismissed((current) => [...current, banner.id])}><X size={17}/></button></div></aside>;
  })}</div>;
}
