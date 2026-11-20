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
  const visible = banners.filter(
    (banner) => (!banner.placement || banner.placement === 'ANNOUNCEMENT') && !dismissed.includes(banner.id),
  );
  if (!visible.length) return null;
  return (
    <div>
      {visible.map((banner) => {
        const path = banner.link_path ? publicLocalePath(banner.link_path, locale) : null;
        return (
          <aside className="announcement" key={banner.id}>
            <div className="site-container">
              <div>
                <strong>{banner.title}</strong>
                <span>{banner.body}</span>
                {path && <Link href={path}>{t('learnMore')}</Link>}
              </div>
              <button
                className="icon-button"
                aria-label={t('dismissAnnouncement')}
                onClick={() => setDismissed((current) => [...current, banner.id])}
              >
                <X size={17} />
              </button>
            </div>
          </aside>
        );
      })}
    </div>
  );
}
