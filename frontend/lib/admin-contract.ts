import { z } from 'zod';

export const ADMIN_COOKIE = 'medaxis_admin_session';
export const PRE_AUTH_COOKIE = 'pre_auth_session';
export const ADMIN_IDLE_MS = 30 * 60_000;
export const adminPrivateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' };
export const loginBody = z.strictObject({ email: z.string().trim().email().max(200), password: z.string().min(1).max(1024) });
export const totpBody = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
export const backupBody = z.strictObject({ backup_code: z.string().trim().min(1).max(72) });
export const mfaResult = z.object({ admin: z.object({ id: z.uuidv4(), email: z.email() }), session_id: z.uuidv4(), expires_at: z.iso.datetime() });
export const loginResult = z.discriminatedUnion('requires_2fa', [
  z.object({ requires_2fa: z.literal(true), expires_at: z.iso.datetime() }),
  mfaResult.extend({ requires_2fa: z.literal(false) }),
]);
export const logoutResult = z.object({ logged_out: z.literal(true) });
export const MAX_ADMIN_AVATAR_LENGTH = 262_144;
export const adminProfileSchema = z.object({
  id: z.uuidv4(), email: z.email(), display_name: z.string(), phone_number: z.string(),
  avatar_url: z.preprocess((value) => value === '' ? null : value, z.url().max(MAX_ADMIN_AVATAR_LENGTH).nullable()),
});
export const adminProfileBody = z.strictObject({
  email: z.email().max(200), display_name: z.string().trim().min(1).max(120), phone_number: z.string().trim().max(25),
  avatar_url: z.string().min(1).max(MAX_ADMIN_AVATAR_LENGTH).nullable().optional(),
  current_password: z.string().min(1).max(1024).optional(),
});
export const adminPasswordBody = z.strictObject({ current_password: z.string().min(1).max(1024), new_password: z.string().min(12).max(1024), confirm_password: z.string().min(12).max(1024) }).refine((value) => value.new_password === value.confirm_password);
export const forgotPasswordBody = z.strictObject({ email: z.string().trim().email().max(200) });
export const forgotPasswordResult = z.object({ requested: z.literal(true) });
export const resetPasswordBody = z.strictObject({ token: z.string().trim().min(16).max(256), new_password: z.string().min(12).max(1024), confirm_password: z.string().min(12).max(1024) }).refine((value) => value.new_password === value.confirm_password);
export const resetPasswordResult = z.object({ reset: z.literal(true) });
export type AdminProfile = z.infer<typeof adminProfileSchema>;
export const revokeResult = z.object({ revoked_count: z.number().int().nonnegative() });
export const sessionSchema = z.object({ id: z.uuidv4(), current: z.boolean(), ip_address: z.string().max(100),
  geo: z.object({ country: z.string().max(2).nullable().optional(), city: z.string().max(200).nullable().optional() }),
  user_agent: z.string().max(2000).nullable(), last_active_at: z.iso.datetime(), expires_at: z.iso.datetime() });
export const sessionsSchema = z.array(sessionSchema).max(1000).refine((rows) => rows.filter((row) => row.current).length === 1, 'A current full session is required.');
export type AdminSession = z.infer<typeof sessionSchema>;
export const rfqStatuses = ['SUBMITTED', 'UNDER_REVIEW', 'NEED_CLARIFICATION', 'QUOTED', 'CONVERTED', 'CLOSED', 'CANCELLED'] as const;
export const adminRfqSchema = z.object({ _id: z.uuidv4(), rfq_number: z.string().min(1).max(200), inquiry_type: z.enum(['QUICK_QUOTE', 'CART_RFQ']),
  contact_snapshot: z.object({ full_name: z.string().max(200), customer_type: z.enum(['B2B_WHOLESALE', 'B2C_PATIENT']), company_name: z.string().max(200).optional(), email: z.email().optional() }),
  destination_country: z.string().regex(/^[A-Z]{2}$/), status: z.enum(rfqStatuses), has_prescription: z.boolean(), created_at: z.iso.datetime(), updated_at: z.iso.datetime(),
}).transform(({ _id, ...value }) => ({ id: _id, ...value }));
export const adminRfqsSchema = z.array(adminRfqSchema).max(100);
export type AdminRfq = z.infer<typeof adminRfqSchema>;
const decimal = z.string().regex(/^\d+(?:\.\d+)?(?:E[+-]?\d+)?$/i).max(80);
const fxCurrency = z.enum(['USD', 'EUR', 'CNY']);
export const adminFxSchema = z.object({ last_error_code: z.string().regex(/^[A-Z_]{1,100}$/).nullable(), rates: z.array(z.discriminatedUnion('available', [
  z.object({ currency: fxCurrency, available: z.literal(false) }),
  z.object({ currency: fxCurrency, available: z.literal(true), live_rate_to_bdt: decimal, manual_rate_to_bdt: decimal.optional(), active_rate_to_bdt: decimal,
    mode: z.enum(['LIVE', 'MANUAL_FIXED']), stale: z.boolean(), live_fetched_at: z.iso.datetime(), cached_at: z.iso.datetime(), cache_expires_at: z.iso.datetime(), live_stale_at: z.iso.datetime() }),
])).max(3) });
export type AdminFx = z.infer<typeof adminFxSchema>;

/** Copy opaque signed values only. This module never signs, decrypts or validates a session. */
export function adminCookieHeader(value: string | null, preAuth = false): string {
  const names = preAuth ? [PRE_AUTH_COOKIE] : [ADMIN_COOKIE];
  const found = new Map<string, string>();
  for (const part of (value ?? '').split(';')) {
    const index = part.indexOf('='); if (index < 1) continue;
    const name = part.slice(0, index).trim(); const raw = part.slice(index + 1).trim();
    if (!names.includes(name)) continue;
    if (found.has(name) || !raw || raw.length > 2048 || /[\s\r\n,;]/.test(raw)) throw new Error('Invalid admin cookie header.');
    found.set(name, raw);
  }
  return [...found].map(([name, raw]) => `${name}=${raw}`).join('; ');
}
export function mappedAdminCookies(headers: Headers, production = process.env.NODE_ENV === 'production'): string[] {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : (headers.get('set-cookie') ?? '').split(/,(?=\s*[\w-]+=)/);
  const mapped = new Map<string, string>();
  for (const value of values) {
    const parts = value.split(';').map((part) => part.trim()); const pair = parts.shift() ?? ''; const name = pair.slice(0, pair.indexOf('='));
    if (name !== ADMIN_COOKIE && name !== PRE_AUTH_COOKIE) continue;
    const expectedPath = name === ADMIN_COOKIE ? '/v1/admin' : '/v1/admin/auth';
    if (parts.find((part) => /^path=/i.test(part))?.slice(5) !== expectedPath || !parts.some((part) => /^httponly$/i.test(part)) || !parts.some((part) => /^samesite=strict$/i.test(part)) || production && !parts.some((part) => /^secure$/i.test(part))) throw new Error('Unsafe upstream admin cookie attributes.');
    const safe = parts.filter((part) => !/^(?:path|domain)=/i.test(part));
    mapped.set(name, `${pair}; Path=${name === ADMIN_COOKIE ? '/' : '/api/admin/auth'}; ${safe.join('; ')}`);
  }
  return [...mapped.values()]; // Last renewal/clear for a name wins; no duplicate path variants.
}
export function expiredAdminCookie(production = process.env.NODE_ENV === 'production'): string {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${production ? '; Secure' : ''}`;
}
export function adminFrontendOrigin(): URL {
  const value = process.env.ADMIN_FRONTEND_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL;
  if (!value) throw new Error('Configure the admin frontend origin.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password || process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Invalid admin frontend origin.');
  return url;
}

export interface AdminProxyRule { kind: 'json' | 'multipart' | 'binary' | 'sse'; preAuth?: boolean; anonymous?: boolean; query: readonly string[] }
const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
export function adminProxyRule(path: string, method: string): AdminProxyRule | null {
  if (!/^[a-zA-Z0-9/-]+$/.test(path) || path.includes('//')) return null;
  const json = (query: readonly string[] = []): AdminProxyRule => ({ kind: 'json', query });
  if (path === 'auth/login' && method === 'POST') return { ...json(), anonymous: true };
  if (/^auth\/(?:forgot|reset)-password$/.test(path) && method === 'POST') return { ...json(), anonymous: true };
  if (/^auth\/verify-(?:totp|backup-code)$/.test(path) && method === 'POST') return { ...json(), preAuth: true };
  if (path === 'auth/sessions' && method === 'GET' || /^auth\/(?:logout|revoke-sessions|2fa\/enroll)$/.test(path) && method === 'POST') return json();
  if (path === 'auth/profile' && ['GET', 'PATCH'].includes(method) || path === 'auth/change-password' && method === 'POST') return json();
  if (path === 'rfqs' && method === 'GET') return json(['page', 'limit', 'status', 'buyer_type', 'q', 'date_from', 'date_to']);
  if (path === 'rfq-workflow' && method === 'GET') return json(['page', 'limit', 'q', 'country', 'status', 'queue', 'scope']);
  if (new RegExp(`^rfq-workflow/${uuid}$`).test(path) && method === 'GET' || new RegExp(`^rfq-workflow/${uuid}/(?:review|respond|payment-request|guest-link)$`).test(path) && method === 'POST') return json();
  if (new RegExp(`^rfqs/${uuid}$`).test(path) && method === 'GET' || new RegExp(`^rfqs/${uuid}/(?:status|items/${uuid})$`).test(path) && method === 'PATCH' || new RegExp(`^rfqs/${uuid}/(?:request-clarification|unable-to-supply|notes)$`).test(path) && method === 'POST') return json();
  if (path === 'fx-rates' && ['GET', 'PATCH'].includes(method) || path === 'settings' && ['GET', 'PATCH'].includes(method)) return json();
  if (path === 'stream' && method === 'GET') return { kind: 'sse', query: [] };
  if (new RegExp(`^prescriptions/${uuid}/stream$`).test(path) && method === 'GET') return { kind: 'binary', query: [] };
  if (path === 'quotations/draft' && method === 'POST' || new RegExp(`^quotations/${uuid}$`).test(path) && method === 'GET' || new RegExp(`^quotations/${uuid}/(?:send|revise|resend)$`).test(path) && method === 'POST' || new RegExp(`^quotations/${uuid}/fulfillment$`).test(path) && method === 'PATCH') return json();
  if (path === 'catalog/videos' && method === 'POST') return { kind: 'multipart', query: [] };
  if (path === 'catalog/translate-indications' && method === 'POST') return json();
  if (path === 'catalog/images' && method === 'POST') return { kind: 'multipart', query: [] };
  if (path === 'catalog/import-csv' && method === 'POST') return { kind: 'multipart', query: ['dry_run'] };
  if (path === 'catalog/products' && method === 'GET') return json(['page','limit','q','status','manufacturer_id','generic_id','category_id']);
  if (/^catalog\/(?:manufacturers|generics|categories)$/.test(path) && method === 'GET') return json(['page','limit','q','is_active']);
  if (new RegExp(`^catalog/(?:products|manufacturers|generics|categories)/${uuid}$`).test(path) && method === 'GET') return json();
  if (new RegExp(`^catalog/(?:products|manufacturers|generics|categories)/${uuid}$`).test(path) && method === 'DELETE') return json();
  if (path === 'cms/banners' && method === 'GET') return json(['page','limit','q','is_active','placement']);
  if (new RegExp(`^cms/banners/${uuid}$`).test(path) && method === 'GET') return json();
  if (new RegExp(`^cms/banners/${uuid}$`).test(path) && method === 'DELETE') return json();
  if (path === 'cms/blogs' && method === 'GET') return json(['page','limit','q','is_active','category']);
  if (new RegExp(`^cms/blogs/${uuid}$`).test(path) && method === 'GET') return json();
  if (new RegExp(`^cms/blogs/${uuid}$`).test(path) && method === 'DELETE') return json();
  if (path === 'quotations' && method === 'GET') return json(['page','limit','q','rfq_id','overall_status','status','reservation_before','worklist']);
  if (path === 'quotations/summary' && method === 'GET') return json(['window_hours']);
  if (new RegExp(`^quotations/${uuid}/draft$`).test(path) && method === 'PATCH') return json();
  if (/^catalog\/(?:products|generics|manufacturers|categories)$/.test(path) && method === 'POST' || new RegExp(`^catalog/products/${uuid}$`).test(path) && method === 'PATCH' || (path === 'cms/banners' || path === 'cms/blogs') && method === 'POST') return json();
  if (path === 'customers' && method === 'GET') return json(['page', 'limit', 'q', 'buyer_type', 'country']);
  if (new RegExp(`^customers/${uuid}$`).test(path) && method === 'GET') return json(['page', 'limit']);
  if (path === 'audit-logs' && method === 'GET') return json(['page', 'limit', 'actor_type', 'actor_id', 'action', 'entity_type', 'entity_id', 'date_from', 'date_to']);
  return null;
}
