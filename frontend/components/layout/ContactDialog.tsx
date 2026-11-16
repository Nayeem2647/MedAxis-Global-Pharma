'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Check } from 'lucide-react';
import type { ContactConfig } from '../../lib/public-config';
import { Modal } from './Modal';

// Needs only next-intl and its contact props; no public shell/cart/analytics context.
export function ContactChannels({ contact }: { contact: ContactConfig }) {
  const t = useTranslations('Contact');
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const wechat = <div className="contact-channel"><h3>WeChat</h3>
    {contact.wechatId ? <><p className="wechat-id">{contact.wechatId}</p><button type="button" className="button secondary" onClick={async () => {
      try { await navigator.clipboard.writeText(contact.wechatId ?? ''); setCopied(true); } catch { setCopied(false); }
    }}>{copied ? <><Check size={16}/>{t('copied')}</> : t('copy')}</button></> : !contact.wechatQr && <p className="muted">{t('unavailable')}</p>}
    {contact.wechatQr && <><p className="small muted">{t('scanWechat')}</p><Image src={contact.wechatQr} alt={t('qrAlt')} width={616} height={624} unoptimized className="wechat-qr"/>
      <a className="text-button qr-original" href={contact.wechatQr} target="_blank" rel="noopener noreferrer nofollow">{t('openQr')}</a></>}
  </div>;
  const whatsapp = <div className="contact-channel"><h3>WhatsApp</h3>{contact.whatsapp
    ? <a className="button secondary" href={contact.whatsapp} target="_blank" rel="noopener noreferrer nofollow">{t('openWhatsapp')}<ArrowRight size={17}/></a>
    : <p className="muted">{t('unavailable')}</p>}</div>;

  return <>
    <div className={`contact-grid${contact.wechatQr ? ' with-qr' : ''}`}>{locale === 'zh-CN' ? <>{wechat}{whatsapp}</> : <>{whatsapp}{wechat}</>}</div>
    {contact.email && <a className="contact-email" href={`mailto:${contact.email}`} rel="nofollow">{contact.email}</a>}
  </>;
}

export function ContactDialog({ contact, onClose }: { contact: ContactConfig; onClose(): void }) {
  const t = useTranslations('Contact');
  return <Modal title={t('title')} onClose={onClose}>
    <p className="muted">{t('intro')}</p><ContactChannels contact={contact}/>
    <p className="small muted">{t('chinaEmail')}</p>
  </Modal>;
}
