import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { adminVersionFixture } from '../admin-fixtures.ts';

const cookieName = 'medaxis_customer_session';
interface Fixture {
  id: string; password: string; verify: string; reset: string;
  profile: { id: string; email: string; email_verified: boolean; full_name: string; customer_type: string; company_name: string; country: string; city: string; whatsapp_number: string; wechat_id: string; preferred_locale: string };
  drafts: Record<string, unknown>[]; revisions: Record<string, unknown>[]; history: Record<string, unknown>[]; rfqs: Record<string, unknown>[];
}
const accounts = new Map<string, Fixture>(); const sessions = new Map<string, Fixture>();
const stamp = () => new Date().toISOString();
const token = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
function send(res: ServerResponse, data: unknown, paged = false) {
  const size = Array.isArray(data) ? data.length : 0;
  res.end(JSON.stringify({ success: true, data, meta: { request_id: randomUUID(), timestamp: stamp(), ...(paged ? { pagination: { page: 1, limit: 20, total_items: size, total_pages: 1, has_next: false, has_prev: false } } : {}) } }));
}
function error(res: ServerResponse, status = 401) { res.writeHead(status); res.end(JSON.stringify({ success: false, error: { status, code: status === 401 ? 'AUTHENTICATION_REQUIRED' : status === 404 ? 'RESOURCE_NOT_FOUND' : 'ACCESS_DENIED', message: 'Fixture request denied.' }, meta: { request_id: randomUUID(), timestamp: stamp() } })); }
function issue(state: Fixture, res: ServerResponse) { const value = `s%3A${randomUUID()}.CUSTOMER-FIXTURE`; sessions.set(value, state); res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/v1/public/customer; HttpOnly; SameSite=Strict; Secure; Max-Age=1800`); }
function activity(state: Fixture, kind: string) { state.history.unshift({ id: randomUUID(), kind, created_at: stamp() }); }
function quote(state: Fixture) {
  const version = adminVersionFixture('SENT');
  const keys = ['id', 'quotation_id', 'version_number', 'status', 'items', 'billing_currency', 'subtotal_amount', 'freight_cost', 'insurance_cost', 'total_amount', 'shipping_terms', 'payment_terms', 'bank_details', 'valid_until', 'issued_at', 'reservation_status', 'created_at', 'updated_at'] as const;
  const fields = Object.fromEntries(keys.map((key) => [key, version[key]])) as Pick<typeof version, typeof keys[number]>;
  return { ...fields, contact: { full_name: state.profile.full_name, email: state.profile.email, customer_type: state.profile.customer_type, preferred_locale: state.profile.preferred_locale, ...(state.profile.company_name ? { company_name: state.profile.company_name } : {}) }, quotation_number: 'QT-CUSTOMER-001', is_current: true, availability: { available: 1, unavailable: 1, sourcing: 0 } };
}
export async function customerFixture(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === '/__test__/customer') {
    const state = accounts.get(url.searchParams.get('email') ?? '');
    if (!state) { error(res, 404); return true; }
    const base = `http://127.0.0.1:3100/${state.profile.preferred_locale}/account`;
    send(res, { verify_url: `${base}/verify#${state.verify}`, reset_url: `${base}/reset#${state.reset}`, drafts: state.drafts.length, revisions: state.revisions.length }); return true;
  }
  if (!url.pathname.startsWith('/v1/public/customer/')) return false;
  const path = url.pathname.slice('/v1/public/customer/'.length);
  res.setHeader('Cache-Control', 'private, no-store');
  let input: Record<string, unknown> = {};
  if (req.method !== 'GET') { let raw = ''; for await (const chunk of req) raw += String(chunk); try { input = JSON.parse(raw || '{}') as Record<string, unknown>; } catch { error(res, 400); return true; } }
  const value = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  let state = value ? sessions.get(value) : undefined;
  if (path === 'auth/session') { send(res, { profile: state?.profile ?? null }); return true; }
  if (path === 'auth/register') {
    const email = String(input.email).toLowerCase();
    if (accounts.has(email)) { error(res, 409); return true; }
    const id = randomUUID();
    state = { id, password: String(input.password), verify: token(), reset: token(), profile: { id, email, email_verified: false, full_name: String(input.full_name), customer_type: String(input.customer_type), company_name: String(input.company_name ?? ''), country: String(input.country), city: '', whatsapp_number: '', wechat_id: '', preferred_locale: String(input.preferred_locale) }, drafts: [], revisions: [], history: [], rfqs: [] };
    accounts.set(email, state); issue(state, res); activity(state, 'REGISTERED'); res.statusCode = 201; send(res, { profile: state.profile, verification_sent: true }); return true;
  }
  if (path === 'auth/login') {
    state = accounts.get(String(input.email).toLowerCase());
    if (!state || state.password !== input.password) { error(res); return true; }
    issue(state, res); activity(state, 'SIGNED_IN'); send(res, { profile: state.profile }); return true;
  }
  if (path === 'auth/verify-email') {
    state = [...accounts.values()].find((item) => item.verify === input.token && !item.profile.email_verified);
    if (!state) { error(res, 400); return true; }
    state.profile.email_verified = true; activity(state, 'EMAIL_VERIFIED');
    state.rfqs.push({ id: randomUUID(), rfq_number: 'RFQ-CUSTOMER-001', status: 'QUOTED', inquiry_type: 'CART_RFQ', destination_country: 'BD', preferred_currency: 'USD', created_at: stamp(), updated_at: stamp(), items: [{ id: randomUUID(), name: 'Catalog medicine fixture', strength: '80 mg', quantity: 2, packaging_unit: 'BOX', availability_status: 'AVAILABLE' }] });
    send(res, { verified: true }); return true;
  }
  if (path === 'auth/forgot-password') { state = accounts.get(String(input.email).toLowerCase()); if (state) state.reset = token(); send(res, { requested: true, email_delivery_available: true }); return true; }
  if (path === 'auth/reset-password') {
    state = [...accounts.values()].find((item) => item.reset === input.token);
    if (!state) { error(res, 400); return true; }
    state.password = String(input.password); state.reset = token(); for (const [session, account] of sessions) if (account.id === state.id) sessions.delete(session); send(res, { reset: true }); return true;
  }
  if (!state) { error(res); return true; }
  if (path === 'auth/logout') { if (value) sessions.delete(value); res.setHeader('Set-Cookie', `${cookieName}=; Path=/v1/public/customer; HttpOnly; SameSite=Strict; Secure; Max-Age=0`); send(res, { logged_out: true }); return true; }
  if (path === 'auth/resend-verification') { send(res, { verification_sent: true, already_verified: state.profile.email_verified }); return true; }
  if (path === 'profile') { if (req.method === 'PATCH') { Object.assign(state.profile, input); activity(state, 'PROFILE_UPDATED'); } send(res, state.profile); return true; }
  if (path === 'overview') { send(res, { drafts: state.drafts.filter((item) => item.status !== 'SUBMITTED').length, rfqs: state.rfqs.length, quotations: state.profile.email_verified ? 1 : 0, packaging_units: ['BOX', 'BOTTLE'] }); return true; }
  if (path === 'history') { send(res, state.history, true); return true; }
  if (path === 'drafts') {
    if (req.method === 'POST') { const id = randomUUID(); state.drafts.push({ ...input, id, status: 'DRAFT', revision: 0, created_at: stamp(), updated_at: stamp() }); activity(state, 'DRAFT_CREATED'); res.statusCode = 201; send(res, { id }); }
    else send(res, state.drafts, true); return true;
  }
  if (path.startsWith('drafts/')) {
    const id = path.split('/')[1]; const draft = state.drafts.find((item) => item.id === id);
    if (!draft) { error(res, 404); return true; }
    if (req.method === 'PATCH') { Object.assign(draft, input, { revision: Number(draft.revision) + 1, updated_at: stamp() }); activity(state, 'DRAFT_UPDATED'); send(res, { saved: true, revision: draft.revision }); }
    else if (req.method === 'DELETE') { state.drafts = state.drafts.filter((item) => item.id !== id); send(res, { deleted: true }); }
    else if (path.endsWith('/submit') && state.profile.email_verified) { if (!draft.rfq_id) { draft.status = 'SUBMITTED'; draft.rfq_id = randomUUID(); draft.rfq_number = 'RFQ-CUSTOMER-002'; state.rfqs.push({ id: draft.rfq_id, rfq_number: draft.rfq_number, status: 'SUBMITTED', inquiry_type: 'CART_RFQ', destination_country: draft.destination_country, preferred_currency: draft.preferred_currency, created_at: stamp(), updated_at: stamp(), items: (draft.items as Record<string, unknown>[]).map((item) => ({ ...item, id: randomUUID(), strength: item.strength ?? '', availability_status: 'SOURCING' })) }); activity(state, 'RFQ_SUBMITTED'); } send(res, { rfq_id: draft.rfq_id, rfq_number: draft.rfq_number, replayed: false }); }
    else error(res, 403); return true;
  }
  if (!state.profile.email_verified) { error(res, 403); return true; }
  if (path === 'rfqs') { send(res, state.rfqs, true); return true; }
  if (path.startsWith('rfqs/')) { const rfq = state.rfqs.find((item) => item.id === path.split('/')[1]); if (rfq) send(res, rfq); else error(res, 404); return true; }
  if (path === 'quotations') { const item = quote(state); send(res, [{ id: item.id, quotation_id: item.quotation_id, quotation_number: item.quotation_number, version_number: item.version_number, status: item.status, billing_currency: item.billing_currency, total_amount: item.total_amount, issued_at: item.issued_at, valid_until: item.valid_until, is_current: true }], true); return true; }
  if (path.startsWith('quotations/')) {
    if (path.endsWith('/pdf')) { res.setHeader('Content-Type', 'application/pdf'); res.end('%PDF-1.7\nCustomer quotation fixture'); }
    else if (path.endsWith('/revisions')) { const id = String(input.request_id); const prior = state.revisions.some((item) => item.id === id); if (!prior) { state.revisions.unshift({ id, quotation_number: 'QT-CUSTOMER-001', body: input.notes, status: 'REPLIED', created_at: stamp() }); activity(state, 'REVISION_REQUESTED'); } send(res, { message_id: id, replayed: prior }); }
    else send(res, quote(state)); return true;
  }
  if (path === 'revisions') { send(res, state.revisions, true); return true; }
  error(res, 404); return true;
}
