import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : defaultLocale;
  const messages = locale === 'zh-CN'
    ? (await import('../messages/zh-CN.json')).default
    : (await import('../messages/en.json')).default;
  const customer = locale === 'zh-CN' ? (await import('../messages/customer-zh-CN.json')).default : (await import('../messages/customer-en.json')).default;
  return { locale, messages: { ...messages, Customer: customer }, timeZone: 'Asia/Dhaka' };
});
