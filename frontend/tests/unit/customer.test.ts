import { beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyCustomer } from '../../lib/customer-proxy';
import { customerProfileSchema, customerProxyRule, CUSTOMER_COOKIE } from '../../lib/customer-contract';
import en from '../../messages/customer-en.json';
import zh from '../../messages/customer-zh-CN.json';
import { meta } from '../fixtures';

beforeEach(() => { vi.stubEnv('ADMIN_FRONTEND_ORIGIN', 'http://localhost:3000'); vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:4000'); vi.stubEnv('API_INTERNAL_BASE_URL', ''); vi.stubEnv('NODE_ENV', 'development'); });
const request = (path: string, method = 'GET', origin = 'http://localhost:3001') => new Request(`http://localhost:3001/api/customer/${path}`, { method, headers: { Origin: origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', Cookie: `${CUSTOMER_COOKIE}=s%3Acustomer.UNCHANGED; medaxis_admin_session=s%3Aadmin.NEVER_FORWARD` }, ...(method === 'GET' ? {} : { body: '{}' }) });
const success = (data: unknown, headers?: HeadersInit) => Response.json({ success: true, data, meta }, { headers });

describe('customer account boundary', () => {
  it('forwards only the customer cookie, retains private headers and maps its exact cookie path', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(success({ profile: null }, { 'set-cookie': `${CUSTOMER_COOKIE}=s%3Anew.UNCHANGED; Path=/v1/public/customer; HttpOnly; SameSite=Strict; Max-Age=1800` }));
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyCustomer(request('auth/session'), ['auth', 'session']);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toContain('Path=/api/customer');
    const headers = new Headers(fetcher.mock.calls[0]![1]?.headers);
    expect(headers.get('cookie')).toBe(`${CUSTOMER_COOKIE}=s%3Acustomer.UNCHANGED`);
    expect(headers.get('origin')).toBe('http://localhost:3000');
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain('NEVER_FORWARD');
  });
  it('rejects cross-origin writes before contacting Express', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    expect((await proxyCustomer(request('auth/login', 'POST', 'https://evil.test'), ['auth', 'login'])).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not let the development port allowance apply in production', async () => {
    vi.stubEnv('NODE_ENV', 'production'); const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    expect((await proxyCustomer(request('profile'), ['profile'])).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['../admin', 'admin/auth/login', 'profile/password_hash', 'drafts/not-an-id', 'quotations/private-token'])('rejects unregistered path %s', (path) => expect(customerProxyRule(path, 'GET')).toBe(false));
  it('rejects duplicate customer cookies and unsupported query keys', async () => {
    const duplicate = request('profile'); duplicate.headers.set('cookie', `${CUSTOMER_COOKIE}=first; ${CUSTOMER_COOKIE}=second`);
    expect((await proxyCustomer(duplicate, ['profile'])).status).toBe(400);
    expect((await proxyCustomer(request('rfqs?customer_id=someone-else'), ['rfqs'])).status).toBe(400);
  });
  it('drops account secrets and does not invent a verified state', () => {
    const profile = customerProfileSchema.parse({ id: '82f591d0-346b-4cc4-8d67-e25358fa0272', email: 'buyer@example.test', email_verified: false, full_name: 'Buyer', customer_type: 'B2C_PATIENT', company_name: '', country: 'BD', city: '', whatsapp_number: '', wechat_id: '', preferred_locale: 'en', password_hash: 'NEVER_RENDER', verification: { token: 'NEVER_RENDER' } });
    expect(profile.email_verified).toBe(false); expect(JSON.stringify(profile)).not.toContain('NEVER_RENDER');
  });
  it('provides the same complete customer translation keys in both languages', () => {
    const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, item]) => typeof item === 'object' && item !== null ? keys(item as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`]);
    expect(keys(en).sort()).toEqual(keys(zh).sort());
  });
});
