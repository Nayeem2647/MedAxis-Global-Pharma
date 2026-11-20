import { publicAssetUrl } from './public-catalog';
import { siteOrigin } from './seo';

export interface ContactConfig {
  whatsapp: string | null;
  wechatId: string | null;
  wechatQr: string | null;
  email: string | null;
  phone?: string | null;
}

export function getContactConfig(): ContactConfig {
  const phone = (process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? '+8801560066410').replace(/[\s()+-]/g, '');
  const contactPhone = (process.env.NEXT_PUBLIC_CONTACT_PHONE ?? '+8801560064010').replace(/[\s()+-]/g, '');
  const wechatId = process.env.NEXT_PUBLIC_WECHAT_ID?.trim();
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return {
    phone: /^[1-9]\d{6,14}$/.test(contactPhone) ? `+${contactPhone}` : null,
    whatsapp: phone && /^[1-9]\d{6,14}$/.test(phone) ? `https://wa.me/${phone}` : null,
    wechatId: wechatId && /^[a-zA-Z0-9_-]{2,100}$/.test(wechatId) ? wechatId : null,
    wechatQr: publicAssetUrl(process.env.NEXT_PUBLIC_WECHAT_QR_URL || '/images/wechat-contact.jpeg'),
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
  };
}

export function getAnalyticsConfig() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  const script = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL;
  if (!domain || !script || !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(domain)) return null;
  try {
    const url = new URL(script, 'https://medaxisglobalpharma.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.pathname.endsWith('.js')) return null;
    const collector = new URL(process.env.NEXT_PUBLIC_PLAUSIBLE_API_HOST ?? (script.startsWith('/') ? siteOrigin() : url.origin));
    if (collector.protocol !== 'https:' || collector.username || collector.password || collector.search || collector.hash || collector.pathname !== '/') return null;
    return { domain, src: script, endpoint: `${collector.origin}/api/event` };
  } catch { return null; }
}
