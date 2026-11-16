import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLocalizedMetadata } from '../../lib/seo';
import { counterpartPath } from '../../lib/locale-navigation';
import { getAnalyticsConfig, getContactConfig } from '../../lib/public-config';
import { homeProductSchema, plainText, publicAssetUrl } from '../../lib/public-catalog';

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://medaxisglobalpharma.com'));

describe('entity metadata and locale counterparts', () => {
  it.each(['en', 'zh-CN'] as const)('builds reciprocal metadata for %s without collapsing x-default', (locale) => {
    const enPath = '/en/products/osimert-80mg';
    const zhPath = '/zh-CN/products/奥希替尼-80mg';
    const metadata = buildLocalizedMetadata({ locale, enPath, zhPath, title: 'Title', description: 'Description' });
    const zh = `https://medaxisglobalpharma.com/zh-CN/products/${encodeURIComponent('奥希替尼-80mg')}`;
    expect(metadata.title).toBe('Title');
    expect(metadata.alternates).toEqual({ canonical: locale === 'en' ? `https://medaxisglobalpharma.com${enPath}` : zh, languages: { en: `https://medaxisglobalpharma.com${enPath}`, 'zh-CN': zh, 'x-default': `https://medaxisglobalpharma.com${enPath}` } });
  });
  it('uses explicit translated slugs and falls back to prefix replacement for shared paths', () => {
    expect(counterpartPath('zh-CN', '/en/products/old', '/zh-CN/products/translated')).toBe('/zh-CN/products/translated');
    expect(counterpartPath('zh-CN', '/en/privacy')).toBe('/zh-CN/privacy');
  });
  it.each(['https://evil.test/zh-CN/products/evil', '/zh-CN/q/token', '/zh-CN/admin', '/en/products/../products/test', '/zh-CN/products/%2fadmin', '/zh-CN?query=test'])('rejects unsafe metadata/counterpart paths %s', (zhPath) => {
    expect(() => buildLocalizedMetadata({ locale: 'en', enPath: '/en/products/product', zhPath, title: 'Title', description: 'Description' })).toThrow();
  });
});

describe('public configuration and content', () => {
  it('uses the WhatsApp number supplied by the owner', () => {
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_NUMBER', '+8801560066410');
    expect(getContactConfig().whatsapp).toBe('https://wa.me/8801560066410');
  });
  it('uses the owner-supplied QR without inventing a WeChat ID or analytics settings', () => {
    vi.stubEnv('NEXT_PUBLIC_WECHAT_ID', ''); vi.stubEnv('NEXT_PUBLIC_WECHAT_QR_URL', '');
    vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_DOMAIN', ''); vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL', '');
    expect(getContactConfig()).toMatchObject({ wechatId: null, wechatQr: '/images/wechat-contact.jpeg' });
    expect(getAnalyticsConfig()).toBeNull();
  });
  it('supports a configured Plausible installation and separate collector', () => {
    vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_DOMAIN', 'medaxisglobalpharma.com');
    vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL', 'https://analytics.example.test/js/pa-site.js');
    vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_API_HOST', 'https://events.example.test');
    expect(getAnalyticsConfig()).toEqual({ domain: 'medaxisglobalpharma.com', src: 'https://analytics.example.test/js/pa-site.js', endpoint: 'https://events.example.test/api/event' });
  });
  it('renders banner text without executing CMS HTML', () => {
    expect(plainText('<p>Service &amp; sourcing</p><script>alert(1)</script>')).toBe('Service & sourcing');
  });
  it('accepts public CDN images and rejects unknown or signed image URLs', () => {
    expect(publicAssetUrl('/images/wechat-contact.jpeg')).toBe('/images/wechat-contact.jpeg');
    expect(publicAssetUrl('https://cdn.medaxisglobalpharma.com/products/image.webp')).toBeTruthy();
    expect(publicAssetUrl('https://unknown.test/image.webp')).toBeNull();
    expect(publicAssetUrl('https://cdn.medaxisglobalpharma.com/image.webp?private=token')).toBeNull();
  });
  it.each(['/api/private.jpeg', '/q/token.jpeg', '/images/../private.jpeg', '//evil.test/image.jpeg', '/images/%2e%2e/private.jpeg', '/images/wechat-contact.jpeg?token=secret'])('rejects unsafe local image path %s', (path) => {
    expect(publicAssetUrl(path)).toBeNull();
  });
  it('requires runtime validation for product data', () => {
    expect(homeProductSchema.safeParse({ id: 'unexpected', unit_price: 'SECRET' }).success).toBe(false);
  });
});
