import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const timestamp = '2026-11-15T12:00:00.000Z';
// Local-only admin transport fixture. Real cryptography is covered by backend auth tests.
interface AdminFixture { id: string; email: string; scenario: string; full: string; pre: string; verified: boolean; revoked: boolean; others: boolean; calls: { path: string; method: string; cookie?: string; origin?: string; query: string }[]; streams: Set<ServerResponse>; otherStreams: Set<ServerResponse>; connects: number; disconnects: number }
const admins = new Map<string, AdminFixture>();
const adminCookie = (pair: string, path: string, clear = false) => `${pair}; Path=${path}; HttpOnly; SameSite=Strict; Secure; Max-Age=${clear ? 0 : path.endsWith('/auth') ? 300 : 1800}`;
const adminSession = (id: string, current: boolean) => ({ id, current, ip_address: '127.0.0.*', geo: { country: 'BD', city: 'Dhaka' }, user_agent: 'Local browser fixture', last_active_at: timestamp, expires_at: new Date(Date.now() + 1800_000).toISOString(), token_hash: 'NEVER_RENDER_ADMIN_HASH' });
const meta = { timestamp, request_id: '8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c', internal_margin: 'NEVER_RENDER_INTERNAL_MARGIN' };
const productId = '82f591d0-346b-4cc4-8d67-e25358fa0272';
const englishId = '92f591d0-346b-4cc4-8d67-e25358fa0272';
const catalog = {
  products: [{ en: 'osimert-80mg', zhCN: '奥希替尼-80mg', updated_at: timestamp }, { en: 'english-only-medicine', zhCN: null, updated_at: timestamp }],
  generics: [{ en: 'osimertinib', zhCN: 'osimertinib-cn', updated_at: timestamp }],
  manufacturers: [{ en: 'beacon', zhCN: 'beacon-cn', updated_at: timestamp }],
  categories: [{ en: 'oncology', zhCN: 'oncology-cn', updated_at: timestamp }],
};

const master = (id: string, en: string, zh: string, slug: string, chinese: boolean) => ({
  id, name: chinese ? zh : en, slug: chinese ? `${slug}-cn` : slug, alternate_slugs: { en: slug, zhCN: `${slug}-cn` },
  description: chinese ? '<p>已发布的目录资料。</p>' : '<p>Published catalog profile.</p>',
  unit_price: 'NEVER_RENDER_PRIVATE_PRICE', internal_notes: 'NEVER_RENDER_INTERNAL_COST',
});

function products(chinese: boolean) {
  const common = {
    manufacturer: { ...master('2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', 'Beacon Pharmaceuticals PLC', 'Beacon 制药', 'beacon', chinese), country: 'BD', certifications: ['Manufacturer documentation — test fixture'] },
    generic: { ...master('1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d', 'Osimertinib', '奥希替尼', 'osimertinib', chinese), therapeutic_indications: ['Published ingredient context — test fixture'] },
    categories: [master('3c4d5e6f-7a8b-4c0d-9e2f-3a4b5c6d7e8f', 'Oncology', '肿瘤科', 'oncology', chinese)],
    strength: '80 mg', dosage_form: 'Tablet', pack_size: '30 tablets', packaging_unit: 'BOX',
    cold_chain_required: true, primary_image_url: null, image_urls: [],
    storage_condition: chinese ? '按制药企业说明储存。' : 'Store according to manufacturer instructions.',
    unit_price: 'NEVER_RENDER_PRIVATE_PRICE', procurement_cost_bdt: 'NEVER_RENDER_INTERNAL_COST',
    pricing: { wholesale: 'USD 9876.54', retail: '￥7654.32', currency: 'CNY' },
    prescription_required: true, reviewed_at: 'NEVER_INVENT_REVIEW_DATE',
  };
  const description = chinese ? '<p>已发布的产品资料。</p>' : '<p>Published product information.</p>';
  return [{ ...common,
    id: productId, sku: 'OSIMERT-80', locale: chinese ? 'zh-CN' : 'en', brand_name: chinese ? '奥希替尼 80mg' : 'Osimert 80mg', slug: chinese ? '奥希替尼-80mg' : 'osimert-80mg',
    alternate_slugs: { en: 'osimert-80mg', zhCN: '奥希替尼-80mg' },
    translations: { en: { brand_name: 'Osimert 80mg', slug: 'osimert-80mg', description: '<p>English information.</p>', internal_margin: 'NEVER_RENDER_INTERNAL_MARGIN' }, zhCN: { brand_name: '奥希替尼 80mg', slug: '奥希替尼-80mg', description } },
    description: `${description}<script>globalThis.NEVER_EXECUTE_CATALOG_SCRIPT=true</script>`,
    indication_summary: chinese ? '<p>请咨询专业医护人员。</p>' : '<p>Consult a qualified healthcare professional.</p>',
    usage_notes: '<img src=x onerror="globalThis.NEVER_EXECUTE_CATALOG_SCRIPT=true">Manufacturer instructions apply.',
  }, { ...common,
    id: englishId, sku: 'ENGLISH-ONLY', locale: 'en', brand_name: 'English-only medicine', slug: 'english-only-medicine', cold_chain_required: false,
    alternate_slugs: { en: 'english-only-medicine', zhCN: null }, translations: { en: { brand_name: 'English-only medicine', slug: 'english-only-medicine' } },
    description: '<p>Original English product information.</p>', primary_image_url: 'https://cdn.medaxisglobalpharma.com/products/test-fixture.png', image_urls: ['https://cdn.medaxisglobalpharma.com/products/test-fixture.png'],
  }];
}

function success(res: ServerResponse, data: unknown, page?: number, limit?: number, total?: number) {
  const pages = page && limit ? Math.max(1, Math.ceil((total ?? 0) / limit)) : 1;
  res.end(JSON.stringify({ success: true, data, meta: { ...meta, ...(page && limit ? { pagination: { page, limit, total_items: total, total_pages: pages, has_next: page < pages, has_prev: page > 1 } } : {}) } }));
}

const requests: string[] = [];
let slowDone = 0;
function quotationFixture(status = 'SENT') {
  const line = { id: productId, rfq_item_id: englishId, manufacturer_id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', brand_name: 'Private medicine', generic_name: 'Private ingredient', strength: '80 mg', dosage_form: 'Tablet', pack_size: '30 tablets', packaging_unit: 'BOX', quantity: 3 };
  return {
    id: productId, quotation_id: englishId, version_number: 2, status,
    contact: { full_name: 'Private Quotation Buyer', company_name: 'Private Buyer Company', email: 'quotation-buyer@example.test', customer_type: 'B2B_WHOLESALE', preferred_locale: 'en', internal_note: 'NEVER_RENDER_QUOTATION_INTERNAL' },
    items: [{ ...line, availability_status: 'AVAILABLE', unit_quoted_price: '123.4500', total_line_price: '370.3500', procurement_cost_bdt: 'NEVER_RENDER_QUOTATION_COST' },
      { ...line, id: '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d', availability_status: 'UNAVAILABLE', customer_facing_note: 'Not available for this quotation.', unit_quoted_price: 'NEVER_RENDER_UNAVAILABLE_AMOUNT', total_line_price: 'NEVER_RENDER_UNAVAILABLE_AMOUNT' },
      { ...line, id: '3c4d5e6f-7a8b-4c0d-9e2f-3a4b5c6d7e8f', availability_status: 'SOURCING', customer_facing_note: 'Awaiting sourcing confirmation.', unit_quoted_price: 'NEVER_RENDER_SOURCING_AMOUNT' }],
    billing_currency: 'USD', subtotal_amount: '370.3500', freight_cost: '12.3400', insurance_cost: '0.5000', total_amount: '383.1900',
    shipping_terms: { method: 'INCOTERM', incoterm: 'CIP', named_place: 'Shanghai airport', cold_chain_required: true, temperature_range: '2–8°C', internal_cost: 'NEVER_RENDER_QUOTATION_COST' },
    payment_terms: 'BANK_WIRE_TT', bank_details: { configured: true, instructions: 'Use the bank details in this quotation.\nConfirm any change with our official team.', beneficiary_name: 'Authorized beneficiary fixture', bank_name: 'Authorized bank fixture', account_number: 'PRIVATE-ACCOUNT-012345', swift_code: 'TESTBDDH', bank_address: 'Dhaka', currency: 'USD', private_admin_note: 'NEVER_RENDER_QUOTATION_INTERNAL' },
    issued_at: timestamp, valid_until: '2030-11-22T10:00:00.000Z', accepted_at: status === 'ACCEPTED' ? '2026-11-16T10:00:00.000Z' : undefined,
    reservation_expires_at: status === 'ACCEPTED' ? '2026-11-21T10:00:00.000Z' : undefined, reservation_status: status === 'ACCEPTED' ? 'ACTIVE' : 'NONE',
    created_at: timestamp, updated_at: timestamp, availability: { available: 1, unavailable: 1, sourcing: 1 },
    quotation_number: 'NEVER_INVENT_BUSINESS_NUMBER', locked_fx_rate_usd: 'NEVER_RENDER_QUOTATION_FX', magic_link_token_hash: 'NEVER_RENDER_TOKEN_HASH', internal_procurement_notes: 'NEVER_RENDER_QUOTATION_INTERNAL',
    gross_margin_bdt: 'NEVER_RENDER_QUOTATION_MARGIN', effective_gross_margin_percent: 'NEVER_RENDER_QUOTATION_MARGIN', internal_cost_data: { calculated_base_bdt: 'NEVER_RENDER_QUOTATION_COST', procurement_unit_cost_bdt: 'NEVER_RENDER_QUOTATION_COST' },
  };
}
interface QuoteScenario { scenario: string; quotation: ReturnType<typeof quotationFixture>; calls: { kind: string; key?: string; body: unknown; referrer?: string }[]; accepted: number; accepts: number }
const quoteStates = new Map<string, QuoteScenario>();
function quoteError(res: ServerResponse, status: number, code: string) {
  res.writeHead(status); res.end(JSON.stringify({ success: false, error: { status, code, message: 'NEVER_RENDER_QUOTATION_ERROR_DETAIL' }, meta }));
}
function loseQuotationResponse(res: ServerResponse) {
  // Start an HTTP response, then lose its body. A bare TCP reset can trigger a
  // browser-level resend independently of the application's retry policy.
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '2048' });
  res.flushHeaders(); res.write('{"success":true,"data":');
  setTimeout(() => res.destroy(), 30);
}
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:4100');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/health') { res.end(JSON.stringify({ ok: true })); return; }
  if (url.pathname === '/__test__/admin' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += String(chunk);
    const { email, scenario } = z.object({ email: z.email(), scenario: z.string().default('normal') }).parse(JSON.parse(raw)); const id = randomUUID();
    admins.set(email, { id, email, scenario, full: `s%3A${id}.FIXTURE-FULL`, pre: `s%3A${id}.FIXTURE-PRE`, verified: false, revoked: false, others: true, calls: [], streams: new Set(), otherStreams: new Set(), connects: 0, disconnects: 0 }); success(res, { configured: true }); return;
  }
  if (url.pathname === '/__test__/admin') {
    const state = admins.get(url.searchParams.get('email') ?? '');
    if (!state) { res.writeHead(404); res.end('{}'); return; }
    if (req.method === 'POST') { res.writeHead(405); res.end(); return; }
    if (url.searchParams.get('action') === 'event') { const eventId = randomUUID(); const frame = `id: ${eventId}\nevent: NEW_RFQ\ndata: ${JSON.stringify({ rfq_id: productId, rfq_number: 'RFQ-LIVE-001', created_at: timestamp, private_extra: 'NEVER_RENDER_ADMIN_EVENT' })}\n\n`; for (const stream of state.streams) stream.write('id: fake\nevent: NEW_RFQ\ndata: broken\n\n' + frame + frame); }
    if (url.searchParams.get('action') === 'disconnect') for (const stream of state.streams) stream.end();
    if (url.searchParams.get('action') === 'expire') { state.revoked = true; for (const stream of state.streams) stream.end(); }
    success(res, { calls: state.calls, connects: state.connects, disconnects: state.disconnects, active: state.streams.size, verified: state.verified, revoked: state.revoked, ...(url.searchParams.get('action') === 'other-session' && state.verified && state.others ? { other_cookie: state.full.replace('FIXTURE-FULL', 'FIXTURE-OTHER') } : {}) }); return;
  }
  if (url.pathname.startsWith('/v1/admin/')) {
    const path = url.pathname.slice('/v1/admin/'.length); const rawCookie = req.headers.cookie ?? ''; const pair = (name: string) => rawCookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
    let input: unknown; if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += String(chunk); try { input = JSON.parse(raw); } catch { quoteError(res, 400, 'INVALID_REQUEST'); return; } }
    const login = z.object({ email: z.email(), password: z.string() }).safeParse(input);
    const state = path === 'auth/login' && login.success ? admins.get(login.data.email) : [...admins.values()].find((entry) => entry.full === pair('medaxis_admin_session') || entry.full.replace('FIXTURE-FULL', 'FIXTURE-OTHER') === pair('medaxis_admin_session') || entry.pre === pair('pre_auth_session'));
    if (!state) { quoteError(res, 401, 'AUTHENTICATION_REQUIRED'); return; }
    state.calls.push({ path, method: req.method ?? '', cookie: rawCookie, origin: req.headers.origin, query: url.search });
    if (req.headers.origin !== 'http://127.0.0.1:3100') { quoteError(res, 403, 'ACCESS_DENIED'); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    if (path === 'auth/login') {
      if (state.scenario === 'lockout') { res.setHeader('Retry-After', '900'); quoteError(res, 403, 'ACCESS_DENIED'); return; }
      if (!login.success || login.data.password !== 'fixture-password') { quoteError(res, 401, 'AUTHENTICATION_REQUIRED'); return; }
      res.setHeader('Set-Cookie', adminCookie(`pre_auth_session=${state.pre}`, '/v1/admin/auth')); success(res, { requires_2fa: true, expires_at: new Date(Date.now() + 300_000).toISOString() }); return;
    }
    if (path === 'auth/verify-totp' || path === 'auth/verify-backup-code') {
      const parsed = z.object({ code: z.literal('123456') }).safeParse(input); const backup = z.object({ backup_code: z.literal('FIXTURE-BACKUP') }).safeParse(input);
      if (pair('pre_auth_session') !== state.pre || state.verified || !(path === 'auth/verify-totp' ? parsed.success : backup.success)) { quoteError(res, 401, 'AUTHENTICATION_REQUIRED'); return; }
      state.verified = true; res.setHeader('Set-Cookie', [adminCookie(`pre_auth_session=`, '/v1/admin/auth', true), adminCookie(`medaxis_admin_session=${state.full}`, '/v1/admin')]); success(res, { admin: { id: state.id, email: state.email, password_hash: 'NEVER_RENDER_ADMIN_HASH' }, session_id: state.id, expires_at: new Date(Date.now() + 1800_000).toISOString() }); return;
    }
    const other = pair('medaxis_admin_session') === state.full.replace('FIXTURE-FULL', 'FIXTURE-OTHER');
    if (!state.verified || state.revoked || (!other && pair('medaxis_admin_session') !== state.full) || other && !state.others) { quoteError(res, 401, 'AUTHENTICATION_REQUIRED'); return; }
    res.setHeader('Set-Cookie', adminCookie(`medaxis_admin_session=${pair('medaxis_admin_session')}`, '/v1/admin'));
    if (path === 'auth/logout') { state.revoked = true; for (const stream of state.streams) stream.end(); res.setHeader('Set-Cookie', [adminCookie(`medaxis_admin_session=${state.full}`, '/v1/admin'), adminCookie('medaxis_admin_session=', '/v1/admin', true), adminCookie('pre_auth_session=', '/v1/admin/auth', true)]); success(res, { logged_out: true }); return; }
    if (path === 'auth/revoke-sessions') { const count = state.others ? 1 : 0; state.others = false; for (const stream of state.otherStreams) stream.end(); success(res, { revoked_count: count }); return; }
    if (path === 'auth/sessions') { success(res, [adminSession(state.id, !other), ...(state.others ? [adminSession(englishId, other)] : [])]); return; }
    if (path === 'rfqs') {
      if (state.scenario === 'proxy') { res.writeHead(502, { 'Content-Type': 'text/html' }); res.end('<html>NEVER_RENDER_ADMIN_PROXY</html>'); return; }
      const page = Number(url.searchParams.get('page') ?? 1); const empty = url.searchParams.get('q') === 'no-matches';
      res.end(JSON.stringify({ success: true, data: empty ? [] : [{ _id: productId, rfq_number: `RFQ-2026-${page === 1 ? '001' : '002'}`, inquiry_type: 'CART_RFQ', contact_snapshot: { full_name: 'Authorized buyer fixture', customer_type: 'B2B_WHOLESALE', company_name: 'Authorized wholesaler', email: 'buyer@fixture.example', internal_note: 'NEVER_RENDER_ADMIN_INTERNAL' }, destination_country: 'CN', status: 'SUBMITTED', has_prescription: true, created_at: timestamp, updated_at: timestamp, internal_notes: 'NEVER_RENDER_ADMIN_INTERNAL' }], meta: { ...meta, pagination: { page, limit: 20, total_items: empty ? 0 : 47, total_pages: empty ? 0 : 3, has_next: !empty && page < 3, has_prev: !empty && page > 1 } } })); return;
    }
    if (path === 'fx-rates') { success(res, { last_error_code: null, rates: [{ currency: 'USD', available: true, live_rate_to_bdt: '122.50000000', active_rate_to_bdt: '122.50000000', mode: 'LIVE', stale: false, live_fetched_at: timestamp, cached_at: timestamp, cache_expires_at: new Date(Date.now() + 300_000).toISOString(), live_stale_at: new Date(Date.now() + 600_000).toISOString(), internal_provider_key: 'NEVER_RENDER_ADMIN_INTERNAL' }, { currency: 'EUR', available: false }, { currency: 'CNY', available: false }] }); return; }
    if (path === 'stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }); res.write('retry: 5000\n\n: connected\n\n'); state.streams.add(res); if (other) state.otherStreams.add(res); state.connects++;
      const timer = setInterval(() => res.write(': ping\n\n'), 25_000); res.on('close', () => { clearInterval(timer); state.streams.delete(res); state.otherStreams.delete(res); state.disconnects++; }); return;
    }
    quoteError(res, 404, 'RESOURCE_NOT_FOUND'); return;
  }
  if (url.pathname === '/__test__/quotation' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += String(chunk);
    const input: unknown = JSON.parse(raw);
    const { token, scenario } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), scenario: z.string() }).parse(input);
    quoteStates.set(token, { scenario, quotation: quotationFixture(scenario === 'accepted' ? 'ACCEPTED' : 'SENT'), calls: [], accepted: 0, accepts: 0 });
    success(res, { configured: true }); return;
  }
  if (url.pathname.startsWith('/__test__/quotation/')) { res.end(JSON.stringify(quoteStates.get(url.pathname.split('/').at(-1) ?? ''))); return; }
  const quoteMatch = /^\/v1\/public\/quotation\/(token|accept|pdf|request-revision|request-refresh|decline)\/([a-f0-9]{64})$/.exec(url.pathname);
  if (quoteMatch) {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3100'); res.setHeader('Access-Control-Allow-Headers', 'content-type,x-idempotency-key'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, Retry-After');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const state = quoteStates.get(quoteMatch[2]!); if (!state) { quoteError(res, 404, 'RESOURCE_NOT_FOUND'); return; }
    const kind = quoteMatch[1]!;
    let input: unknown = undefined;
    if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += String(chunk); input = JSON.parse(raw); }
    state.calls.push({ kind, key: typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'] : undefined, body: input, referrer: req.headers.referer });
    if (state.scenario === 'missing') { quoteError(res, 404, 'RESOURCE_NOT_FOUND'); return; }
    if (state.scenario === 'superseded') { quoteError(res, 409, 'QUOTATION_VERSION_CONFLICT'); return; }
    const expired = state.scenario.startsWith('expired') || state.quotation.status === 'VALIDITY_EXPIRED';
    if (kind === 'token') {
      if (expired) { quoteError(res, 403, 'QUOTATION_TOKEN_EXPIRED'); return; }
      if (state.scenario === 'proxy') { res.writeHead(503, { 'Content-Type': 'text/html', 'Retry-After': '0' }); res.end('<html>NEVER_RENDER_QUOTATION_PROXY</html>'); return; }
      if (state.scenario === 'malformed') { res.end('{broken json'); return; }
      success(res, state.quotation); return;
    }
    if (kind === 'pdf') {
      if (state.scenario === 'pdf-expired') { state.quotation.status = 'VALIDITY_EXPIRED'; quoteError(res, 403, 'QUOTATION_TOKEN_EXPIRED'); return; }
      if (state.scenario === 'pdf-proxy') { res.writeHead(503, { 'Content-Type': 'text/html', 'Retry-After': '0' }); res.end('<html>NEVER_RENDER_QUOTATION_PROXY</html>'); return; }
      res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(state.scenario === 'pdf-invalid' ? '<html>NEVER_RENDER_QUOTATION_PROXY</html>' : '%PDF-1.7\nPrivate quotation fixture\n%%EOF'); return;
    }
    if (kind === 'accept') {
      const parsed = z.strictObject({ terms_accepted: z.literal(true) }).safeParse(input);
      if (!parsed.success || !/^[0-9a-f-]{36}$/.test(String(req.headers['x-idempotency-key'] ?? ''))) { quoteError(res, 422, 'VALIDATION_FAILED'); return; }
      state.accepts++;
      if (state.scenario === 'accept-recover' && state.accepts <= 4) { res.setHeader('Retry-After', '0'); quoteError(res, 500, 'INTERNAL_SERVER_ERROR'); return; }
      const already = state.quotation.status === 'ACCEPTED';
      if (!already) { state.accepted++; state.quotation = quotationFixture('ACCEPTED'); }
      if (state.scenario === 'accept-lost' && !already) { res.destroy(); return; }
      success(res, { ...state.quotation, already_accepted: already }); return;
    }
    if (kind === 'request-refresh') {
      if (!expired) { quoteError(res, 409, 'CONFLICT'); return; }
      if (state.scenario === 'expired-uncertain') { loseQuotationResponse(res); return; }
      success(res, { requested: true }); return;
    }
    if (kind === 'request-revision') { if (state.scenario === 'revision-uncertain') loseQuotationResponse(res); else success(res, { message_id: randomUUID() }); return; }
    state.quotation.status = 'DECLINED'; state.quotation.reservation_status = 'RELEASED';
    if (state.scenario === 'decline-uncertain') loseQuotationResponse(res); else success(res, state.quotation); return;
  }
  if (url.pathname === '/__test__/requests') { res.end(JSON.stringify(requests)); return; }
  if (url.pathname === '/__test__/state') { res.end(JSON.stringify({ slowDone })); return; }
  requests.push(url.pathname + url.search);
  const chinese = url.searchParams.get('locale') === 'zh-CN';
  const page = Number(url.searchParams.get('page') ?? 1);
  const limit = Number(url.searchParams.get('limit') ?? 20);
  const match = /^\/v1\/public\/(products|generics|manufacturers|categories)(?:\/([^/]+))?$/.exec(url.pathname);
  const query = url.searchParams.get('q') ?? '';
  if (match && (!match[2] || match[1] !== 'products')) {
    const allowed = new Set(['page', 'limit', 'locale', 'q', 'manufacturer', 'generic', 'category', 'dosage_form', 'cold_chain']);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) || page < 1 || limit < 1 || limit > 100) {
      res.writeHead(400); res.end(JSON.stringify({ success: false, error: { status: 400, code: 'INVALID_REQUEST', message: 'Unsupported query.' }, meta })); return;
    }
  }
  if (match && ['proxy-error', 'malformed', 'rate-limit'].includes(query)) {
    if (query === 'malformed') { res.end('{not-json'); return; }
    res.writeHead(query === 'rate-limit' ? 429 : 503, { 'Content-Type': 'text/html', 'Retry-After': '1' });
    res.end('<html>NEVER_RENDER_PROXY_SECRET</html>'); return;
  }
  if (query === 'slow') { await new Promise((resolve) => setTimeout(resolve, 1800)); slowDone += 1; }
  const all = products(chinese);
  let rows = all.filter((product) => !query || `${product.brand_name} ${product.generic.name}`.toLowerCase().includes(query.toLowerCase()));
  for (const key of ['manufacturer', 'generic', 'category'] as const) {
    const slug = url.searchParams.get(key);
    if (slug) rows = rows.filter((product) => key === 'category' ? product.categories.some((category) => category.slug === slug) : product[key].slug === slug);
  }
  if (url.searchParams.has('cold_chain')) rows = rows.filter((product) => product.cold_chain_required === (url.searchParams.get('cold_chain') === 'true'));
  if (url.searchParams.get('dosage_form')) rows = rows.filter((product) => product.dosage_form === url.searchParams.get('dosage_form'));
  const facets = { dosage_forms: rows.length ? [{ name: 'Tablet', count: rows.length }] : [], cold_chain: [true, false].flatMap((required) => { const count = rows.filter((product) => product.cold_chain_required === required).length; return count ? [{ required, count }] : []; }), unknown_prices: ['NEVER_RENDER_PRIVATE_PRICE'] };
  if (url.pathname === '/v1/public/products') { success(res, { products: rows.slice((page - 1) * limit, page * limit), facets }, page, limit, rows.length); return; }
  if (url.pathname === '/v1/public/cms/banners') {
    success(res, [{ id: '4d5e6f7a-8b9c-4d1e-8f3a-4b5c6d7e8f9a', title: chinese ? '采购服务公告' : 'Sourcing desk update', body: chinese ? '<p>欢迎提交医药采购需求。</p>' : '<p>Medicine sourcing enquiries are welcome.</p>', sort_order: 0 }]); return;
  }
  if (url.pathname === '/v1/public/sitemap-catalog') { success(res, catalog); return; }
  if (match?.[2]) {
    const slug = decodeURIComponent(match[2]);
    if (slug.startsWith('old-') || slug === 'unsafe-redirect') {
      const target = match[1] === 'products' ? (chinese ? '奥希替尼-80mg' : 'osimert-80mg') : match[1] === 'manufacturers' ? (chinese ? 'beacon-cn' : 'beacon') : match[1] === 'generics' ? (chinese ? 'osimertinib-cn' : 'osimertinib') : (chinese ? 'oncology-cn' : 'oncology');
      const location = slug === 'unsafe-redirect' ? 'https://evil.test/en/products/new' : `/${chinese ? 'zh-CN' : 'en'}/${match[1]}/${encodeURIComponent(target)}`;
      res.writeHead(301, { Location: location }); success(res, { redirect: { status: 301, location } }); return;
    }
    if (match[1] === 'products') {
      const product = all.find((entry) => entry.slug === slug);
      if (product) { success(res, product); return; }
    } else {
      const profile = match[1] === 'manufacturers' ? all[0]!.manufacturer : match[1] === 'generics' ? all[0]!.generic : all[0]!.categories[0]!;
      if (profile.slug === slug) { success(res, { ...profile, products: rows.slice((page - 1) * limit, page * limit), facets }, page, limit, rows.length); return; }
    }
  }
  res.writeHead(404); res.end(JSON.stringify({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'Not found.', status: 404 }, meta }));
}).listen(4100, '127.0.0.1');
