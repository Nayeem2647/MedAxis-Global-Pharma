'use client';

import { useTranslations } from 'next-intl';

export default function ErrorPage({ reset }: { reset(): void }) {
  const t = useTranslations('Catalog');
  return <main id="main-content" className="section site-container catalog-state"><h1>{t('unavailable')}</h1><p>{t('tryAgainHelp')}</p><button className="button primary" onClick={reset}>{t('tryAgain')}</button></main>;
}
