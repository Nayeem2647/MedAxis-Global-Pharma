'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronDown, Mail, MessageCircle, MessagesSquare, Phone, X } from 'lucide-react';
import type { ContactConfig } from '../../lib/public-config';
import { useProductTools } from '../catalog/ProductToolsProvider';

function ChatLogo() {
  const id = useId();
  return <svg className="floating-chat-logo" viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id={`${id}-green`} cx=".38" cy=".25" r=".8"><stop stopColor="#43ff92"/><stop offset=".52" stopColor="#08dc66"/><stop offset=".82" stopColor="#00bc43"/><stop offset="1" stopColor="#009734"/></radialGradient>
      <linearGradient id={`${id}-rim`} x1="18" y1="6" x2="61" y2="72" gradientUnits="userSpaceOnUse"><stop stopColor="#9effc4" stopOpacity=".65"/><stop offset=".45" stopColor="#1ee875" stopOpacity="0"/><stop offset="1" stopColor="#007e2c" stopOpacity=".45"/></linearGradient>
      <linearGradient id={`${id}-bubble`} x1="32" y1="18" x2="45" y2="60" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset=".5" stopColor="#f3fbf5"/><stop offset="1" stopColor="#c3dfcd"/></linearGradient>
      <radialGradient id={`${id}-eyes`} cx=".3" cy=".25" r=".75"><stop stopColor="#60f79a"/><stop offset=".45" stopColor="#06c55a"/><stop offset="1" stopColor="#009e3c"/></radialGradient>
      <filter id={`${id}-shadow`} x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.25" floodColor="#075a2c" floodOpacity=".3"/></filter>
    </defs>
    <circle cx="40" cy="40" r="38" fill={`url(#${id}-green)`} stroke="#04ae46" strokeWidth=".7"/>
    <circle cx="40" cy="40" r="36.5" stroke={`url(#${id}-rim)`} strokeWidth="1.8"/>
    <path d="M53 33c0 9.4-9.2 17-20.5 17-2.7 0-5.3-.4-7.7-1.3l-7.6 3.8 1.8-8C14.6 41.4 12 37.4 12 33c0-9.4 9.2-17 20.5-17S53 23.6 53 33Z" fill={`url(#${id}-bubble)`} filter={`url(#${id}-shadow)`}/>
    <g fill={`url(#${id}-eyes)`}><circle cx="25.5" cy="27.5" r="2.9"/><circle cx="39.5" cy="27.5" r="2.9"/></g>
    <path d="M67 45.5c0 3.7-1.6 7.1-4.4 9.7l1.8 6.7-7.1-3.1c-2 .6-4.1.9-6.3.9-9.1 0-16.5-6.4-16.5-14.2S41.9 31.3 51 31.3 67 37.7 67 45.5Z" fill={`url(#${id}-bubble)`} filter={`url(#${id}-shadow)`}/>
    <g fill={`url(#${id}-eyes)`}><circle cx="45.5" cy="41" r="2.15"/><circle cx="57" cy="41" r="2.15"/></g>
  </svg>;
}

export function FloatingChat({ contact }: { contact: ContactConfig }) {
  const t = useTranslations('Contact');
  const locale = useLocale();
  const pathname = usePathname();
  const { selected } = useProductTools();
  const [open, setOpen] = useState(false);
  const [wechatOpen, setWechatOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bottom, setBottom] = useState(20);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const qrId = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpen(false); setWechatOpen(false); setCopied(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useEffect(() => { close(); }, [pathname, close]);
  useEffect(() => {
    const tray = document.querySelector('.comparison-tray');
    if (!tray) { setBottom(20); return; }
    const position = () => setBottom(Math.ceil(tray.getBoundingClientRect().height) + 34);
    position();
    const observer = new ResizeObserver(position);
    observer.observe(tray);
    return () => observer.disconnect();
  }, [selected.length]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('.floating-chat-channels a, .floating-chat-channels button')?.focus();
    const onPointerDown = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(true); } };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open, close]);

  const whatsapp = contact.whatsapp && <a className="floating-chat-channel" href={contact.whatsapp} target="_blank" rel="noopener noreferrer nofollow">
    <span className="chat-channel-icon chat-whatsapp" aria-hidden="true"><MessageCircle size={23}/></span><span><strong>WhatsApp</strong><span>{t('openWhatsapp')}</span></span>
  </a>;
  const wechat = (contact.wechatQr || contact.wechatId) && <button type="button" className="floating-chat-channel" aria-expanded={wechatOpen} aria-controls={qrId} onClick={() => setWechatOpen((value) => !value)}>
    <span className="chat-channel-icon chat-wechat" aria-hidden="true"><MessagesSquare size={23}/></span><span><strong>WeChat</strong><span>{t('wechatChatHint')}</span></span><ChevronDown size={17} className={wechatOpen ? 'chat-chevron is-open' : 'chat-chevron'} aria-hidden="true"/>
  </button>;

  return <div className={`floating-chat${open ? ' is-open' : ''}`} ref={root} style={{ '--chat-bottom': `${bottom}px` } as CSSProperties} onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    {open && <section className="floating-chat-panel" id={panelId} role="dialog" aria-modal="false" aria-labelledby={`${panelId}-title`}>
      <div className="floating-chat-heading"><div><h2 id={`${panelId}-title`}>{t('supportTitle')}</h2><p>{t('supportIntro')}</p></div><button type="button" className="chat-close" aria-label={t('closeChat')} onClick={() => close(true)}><X size={19}/></button></div>
      <div className="floating-chat-channels">
        {locale === 'zh-CN' ? <>{wechat}{whatsapp}</> : <>{whatsapp}{wechat}</>}
        {wechatOpen && <div className="floating-chat-wechat" id={qrId}>
          {contact.wechatQr && <><p>{t('scanWechat')}</p><Image src={contact.wechatQr} alt={t('qrAlt')} width={224} height={227} unoptimized/><a href={contact.wechatQr} target="_blank" rel="noopener noreferrer nofollow">{t('openQr')}</a></>}
          {contact.wechatId && <button className="chat-copy-id" type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(contact.wechatId!); setCopied(true); } catch { setCopied(false); }
          }}>{copied && <Check size={15} aria-hidden="true"/>}{copied ? t('copied') : `${t('copy')}: ${contact.wechatId}`}</button>}
        </div>}
        {contact.phone && <a className="floating-chat-channel" href={`tel:${contact.phone}`}><span className="chat-channel-icon chat-phone" aria-hidden="true"><Phone size={22}/></span><span><strong>{t('callUs')}</strong><span>{contact.phone}</span></span></a>}
        {contact.email && <a className="floating-chat-channel" href={`mailto:${contact.email}`}><span className="chat-channel-icon chat-email" aria-hidden="true"><Mail size={22}/></span><span><strong>{t('emailUs')}</strong><span>{contact.email}</span></span></a>}
      </div>
    </section>}
    <span className="floating-chat-hint" aria-hidden="true">{t('chatHint')}</span>
    <button ref={trigger} type="button" className="floating-chat-trigger" aria-label={t(open ? 'closeChat' : 'openChat')} title={t(open ? 'closeChat' : 'openChat')} aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog" onClick={() => open ? close(true) : setOpen(true)}>
      {open ? <X size={27} aria-hidden="true"/> : <ChatLogo/>}
    </button>
  </div>;
}
