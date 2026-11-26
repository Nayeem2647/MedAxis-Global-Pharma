'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Facebook, Instagram, Linkedin, Mail, MessageCircle, Phone, Twitter } from 'lucide-react';
import type { ContactConfig } from '../../lib/public-config';
import { browseProductsBy } from '../../lib/catalog-path';

export function Footer({ contact, onContact, onQuickQuote }: { contact: ContactConfig; onContact(): void; onQuickQuote?(): void }) {
  const locale = useLocale();
  const t = useTranslations('Shell');
  const [subscribeEmail, setSubscribeEmail] = useState('');
  const [subscribeState, setSubscribeState] = useState<'idle' | 'invalid' | 'success'>('idle');

  const phone = '+8801560064010';
  const email = contact.email || 'info@medaxisglobalpharma.com';
  const year = new Date().getFullYear();

  function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = subscribeEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setSubscribeState('invalid');
      return;
    }
    setSubscribeState('success');
    setSubscribeEmail('');
  }

  return <footer className="site-footer">
    <div className="site-container footer-main">
      <div className="footer-brand-col">
        <Link href={`/${locale}`} className="footer-brand" aria-label="MedAxis Global Pharma">
          <Image src="/images/medaxis-logo.png" alt="MedAxis Global Pharma" width={818} height={196} unoptimized className="footer-logo" />
        </Link>
        <p className="footer-tagline">{t('directSourcing')}</p>

        <div className="footer-subscribe">
          <h2>{t('subscribeNow')}</h2>
          <form className="footer-subscribe-form" onSubmit={handleSubscribe} noValidate>
            <div className="footer-subscribe-input-wrap">
              <Mail size={16} aria-hidden="true" />
              <input
                type="email"
                value={subscribeEmail}
                onChange={(e) => {
                  setSubscribeEmail(e.target.value);
                  if (subscribeState !== 'idle') setSubscribeState('idle');
                }}
                placeholder={t('subscribePlaceholder')}
                aria-label={t('subscribePlaceholder')}
              />
            </div>
            <button type="submit" className="footer-subscribe-btn">{t('subscribeAction')}</button>
          </form>
          {subscribeState === 'invalid' && <p className="footer-subscribe-msg is-error" role="alert">{t('subscribeInvalid')}</p>}
          {subscribeState === 'success' && <p className="footer-subscribe-msg is-success" role="status">{t('subscribeSuccess')}</p>}
        </div>
      </div>

      <nav className="footer-col" aria-label={t('footerInfoHeading')}>
        <h2>{t('footerInfoHeading')}</h2>
        <ul className="footer-link-list">
          <li><Link href={`/${locale}/about#overview`}>{t('about')}</Link></li>
          <li><Link href={`/${locale}/products`}>{t('products')}</Link></li>
          <li><Link href={`/${locale}/blog`}>{t('blog')}</Link></li>
          <li><Link href={`/${locale}/about#news`}>{t('newsEvents')}</Link></li>
          <li><Link href={browseProductsBy(locale, 'manufacturer')}>{t('manufacturers')}</Link></li>
        </ul>
      </nav>

      <nav className="footer-col" aria-label={t('footerHelpfulHeading')}>
        <h2>{t('footerHelpfulHeading')}</h2>
        <ul className="footer-link-list">
          <li><Link href={`/${locale}/services`}>{t('services')}</Link></li>
          <li><Link href={browseProductsBy(locale, 'generic')}>{t('generics')}</Link></li>
          <li><Link href={`/${locale}/categories`}>{t('compareProducts')}</Link></li>
          <li><Link href={`/${locale}/blog#guides`}>{t('buyerGuides')}</Link></li>
          <li>
            {onQuickQuote
              ? <button type="button" className="footer-text-action" onClick={onQuickQuote}>{t('quickQuote')}</button>
              : <Link href="#regulatory-notice">{t('regulatoryNotice')}</Link>}
          </li>
        </ul>
      </nav>

      <nav className="footer-col" aria-label={t('footerServicesHeading')}>
        <h2>{t('footerServicesHeading')}</h2>
        <ul className="footer-link-list">
          <li><Link href={`/${locale}/services#sourcing`}>{t('globalPharmaSourcing')}</Link></li>
          <li><Link href={`/${locale}/services#cold-chain`}>{t('coldChainLogistics')}</Link></li>
          <li><Link href={`/${locale}/services#coa-support`}>{t('complianceCoa')}</Link></li>
          <li><Link href={`/${locale}/services#emergency-delivery`}>{t('emergencyDelivery')}</Link></li>
          <li><Link href={`/${locale}/services#bulk-order`}>{t('bulkFulfillment')}</Link></li>
        </ul>
      </nav>

      <div className="footer-col footer-contact-col">
        <h2>{t('stayConnected')}</h2>
        <ul className="footer-contact-list">
          <li>
            <a href={`tel:${phone}`} className="footer-contact-item" aria-label={t('phoneLabel', { phone })}>
              <Phone size={16} aria-hidden="true" />
              <span>{phone}</span>
            </a>
          </li>
          <li>
            <a href={`mailto:${email}`} rel="nofollow" className="footer-contact-item" aria-label={t('emailLabel', { email })}>
              <Mail size={16} aria-hidden="true" />
              <span>{email}</span>
            </a>
          </li>
          <li>
            <button type="button" className="footer-contact" onClick={onContact}>
              <MessageCircle size={16} aria-hidden="true" />
              <span>WhatsApp / WeChat</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </li>
        </ul>
        <div className="footer-socials" aria-label={t('socialMedia')}>
          <a href="https://www.facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="footer-social-link">
            <Facebook size={16} aria-hidden="true" />
          </a>
          <a href="https://www.linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className="footer-social-link">
            <Linkedin size={16} aria-hidden="true" />
          </a>
          <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter" className="footer-social-link">
            <Twitter size={16} aria-hidden="true" />
          </a>
          <a href="https://www.instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="footer-social-link">
            <Instagram size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>

    <div className="site-container regulatory" id="regulatory-notice">
      <p>{t('disclaimer')}</p>
      <p>{t('prescriptionDisclaimer')}</p>
    </div>

    <div className="site-container footer-bottom">
      <span className="footer-copy">© {year} MedAxis Global Pharma. {t('allRightsReserved')}</span>
      <nav aria-label={t('utilityNavigation')}>
        <Link href={`/${locale}/privacy`} rel="nofollow">{t('privacy')}</Link>
        <Link href={`/${locale}/terms`} rel="nofollow">{t('terms')}</Link>
        <Link href="/admin/login" rel="nofollow">{t('admin')}</Link>
      </nav>
    </div>
  </footer>;
}
