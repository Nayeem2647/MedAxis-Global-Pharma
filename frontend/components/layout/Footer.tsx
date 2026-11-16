'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Plus } from 'lucide-react';
import type { ContactConfig } from '../../lib/public-config';

export function Footer({ contact, onContact }: { contact: ContactConfig; onContact(): void }) {
  const locale = useLocale();
  const t = useTranslations('Shell');
  return <footer className="site-footer">
    <div className="site-container footer-main">
      <div><Link href={`/${locale}`} className="footer-brand"><span className="footer-mark" aria-hidden="true"><Plus size={21}/></span>MedAxis Global Pharma</Link><p>{t('sourcingStatement')}</p></div>
      <div><h2>{t('stayConnected')}</h2><button className="footer-contact" onClick={onContact}>WhatsApp / WeChat <ArrowRight size={18}/></button>
        {contact.email && <a href={`mailto:${contact.email}`} rel="nofollow">{contact.email}</a>}
      </div>
    </div>
    <div className="site-container regulatory" id="regulatory-notice"><p>{t('disclaimer')}</p><p>{t('prescriptionDisclaimer')}</p></div>
    <div className="site-container footer-bottom"><span>© MedAxis Global Pharma</span><nav aria-label={t('utilityNavigation')}>
      <Link href={`/${locale}/privacy`} rel="nofollow">{t('privacy')}</Link><Link href={`/${locale}/terms`} rel="nofollow">{t('terms')}</Link><Link href="/admin/login" rel="nofollow">{t('admin')}</Link>
    </nav></div>
  </footer>;
}
