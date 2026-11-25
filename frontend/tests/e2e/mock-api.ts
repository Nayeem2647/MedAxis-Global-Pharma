import { createProductionWorkflow, handleProductionAdmin, handleProductionGuest, productionWorkflowState } from './production-workflow-fixture.ts';
import { createServer, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { customerFixture } from './customer-fixtures.ts';
import { adminVersionFixture, costFixture, quotationDetailFixture, rfqFixture, workflowIds, workflowSettings } from '../admin-fixtures.ts';

const timestamp = '2026-11-15T12:00:00.000Z';
// Local-only admin transport fixture. Real cryptography is covered by backend auth tests.
interface AdminFixture { id: string; email: string; scenario: string; full: string; pre: string; verified: boolean; revoked: boolean; others: boolean; calls: { path: string; method: string; cookie?: string; origin?: string; query: string }[]; streams: Set<ServerResponse>; otherStreams: Set<ServerResponse>; connects: number; disconnects: number }
const admins = new Map<string, AdminFixture>();
interface WorkflowFixture { rfq: ReturnType<typeof rfqFixture>; quote: ReturnType<typeof quotationDetailFixture> | null; writes: { path: string; body: unknown }[]; lost: boolean; links: number }
const workflows = new Map<string, WorkflowFixture>();
interface ManagementFixture { resources:Record<string,Record<string,unknown>[]>;settings:Record<string,unknown>;writes:{path:string;body:unknown}[];dryHash?:string;commits:number; }
const management=new Map<string,ManagementFixture>();
function managementFixture():ManagementFixture { const identity={created_at:timestamp,updated_at:timestamp}; const translation=(name:string,slug:string)=>({en:{name,slug,description:'Registered profile.'},zhCN:{name:slug+' \u4e2d\u6587',slug:slug+'-cn'}});const manufacturers=Array.from({length:23},(_,index)=>({_id:index===0?workflowIds.manufacturer:randomUUID(),...identity,translations:translation(index===0?'Fixture manufacturer':'Directory manufacturer '+index,'manufacturer-'+index),country:'BD',certifications:['Supplied certificate'],is_active:index!==22}));
const resources:ManagementFixture['resources']={manufacturers,generics:[{_id:workflowIds.rfq,...identity,translations:translation('Fixture generic','generic-fixture'),therapeutic_indications:['Supplied indication'],is_active:true}],categories:[{_id:workflowIds.quote,...identity,translations:translation('Fixture category','category-fixture'),sort_order:0,is_active:true}],products:['DRAFT','ARCHIVED','PUBLISHED'].map((status,index)=>({_id:index===0?workflowIds.rfq:randomUUID(),...identity,sku:'MANAGE-'+index,manufacturer_id:workflowIds.manufacturer,generic_id:workflowIds.rfq,category_ids:[workflowIds.quote],translations:{en:{brand_name:'Managed medicine '+index,slug:'managed-'+index,description:'Documented medicine'},zhCN:{brand_name:'\u76ee\u5f55\u836f\u54c1 '+index,slug:'\u76ee\u5f55-'+index}},strength:'80 mg',dosage_form:'Tablet',pack_size:'30 tablets',packaging_unit:'BOX',cold_chain_required:false,image_keys:[],status})),banners:[{_id:workflowIds.prescription,...identity,translations:{en:{title:'Scheduled sourcing update',body:'Submit sourcing requirements.'}},is_active:true,sort_order:0,starts_at:'2030-01-01T00:00:00.000Z',link_path:'/en/products'}]};return {resources,settings:structuredClone(workflowSettings),writes:[],commits:0}; }
const fixtureFx=()=>({last_error_code:null,rates:[{currency:'USD',available:true,live_rate_to_bdt:'122.50000000',active_rate_to_bdt:'122.50000000',mode:'LIVE',stale:false,live_fetched_at:timestamp,cached_at:timestamp,cache_expires_at:new Date(Date.now()+300000).toISOString(),live_stale_at:new Date(Date.now()+600000).toISOString()},{currency:'EUR',available:false},{currency:'CNY',available:false}]});

const workflowTokens = new Map<string, { owner: string; version: string; valid: boolean }>();
function workflowLink(owner: string, workflow: WorkflowFixture, version: ReturnType<typeof adminVersionFixture>) {
  for (const entry of workflowTokens.values()) if (entry.owner === owner && entry.version === version.id) entry.valid = false;
  const token = createHash('sha256').update(`${owner}:${++workflow.links}:${version.id}`).digest('hex'); workflowTokens.set(token, { owner, version: version.id, valid: true }); return `https://medaxisglobalpharma.com/q/${token}`;
}
function workflowFixture(scenario: string): WorkflowFixture {
  const rfq = rfqFixture(); const quote = scenario.includes('issue-conflict') || scenario==='workflow-existing-draft' ? quotationDetailFixture('DRAFT') : /sent|accepted|expired|payment|dispatched|conflict/.test(scenario) ? quotationDetailFixture(scenario.includes('payment') ? 'PAYMENT_RECEIVED' : scenario.includes('dispatched') ? 'DISPATCHED' : /accepted|expired/.test(scenario) ? 'ACCEPTED' : 'SENT') : null;
  if (scenario === 'workflow-website-request-empty') rfq.status = 'UNDER_REVIEW';
  if (quote) { rfq.status = 'QUOTED'; const current = quote.versions[0]!; if (/accepted|expired|payment|dispatched/.test(scenario)) { current.reservation_status = /payment|dispatched/.test(scenario) ? 'CONSUMED' : 'ACTIVE'; current.accepted_at = timestamp; current.reservation_expires_at = new Date(Date.now() + (scenario.includes('expired') ? -1000 : 5 * 86_400_000)).toISOString(); } if (/payment|dispatched/.test(scenario)) current.payment = { reference: 'verified-wire', amount: current.total_amount, currency: 'USD', received_at: timestamp }; if (scenario.includes('dispatched')) current.shipment = { courier_name: 'Fixture courier', awb_tracking_number: 'AWB-001', dispatched_at: timestamp }; rfq.quotations = [{ ...quote.quotation, created_at: timestamp }]; }
  return { rfq, quote, writes: [], lost: false, links: 0 };
}
const adminCookie = (pair: string, path: string, clear = false) => `${pair}; Path=${path}; HttpOnly; SameSite=Strict; Secure; Max-Age=${clear ? 0 : path.endsWith('/auth') ? 300 : 1800}`;
const adminSession = (id: string, current: boolean) => ({ id, current, ip_address: '127.0.0.*', geo: { country: 'BD', city: 'Dhaka' }, user_agent: 'Local browser fixture', last_active_at: timestamp, expires_at: new Date(Date.now() + 1800_000).toISOString(), token_hash: 'NEVER_RENDER_ADMIN_HASH' });
const profiles = new Map<string, { id: string; email: string; display_name: string; phone_number: string; avatar_url: string | null }>();
const fixtureAvatar = 'https://fixture-avatars.s3.ap-southeast-1.amazonaws.com/avatars/s3/fixture.jpg?X-Amz-Expires=120&X-Amz-Signature=fixture';
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
    description: '<p>Original English product information.</p>', primary_image_url: 'https://cdn.medaxisglobalpharma.com/products/test-fixture.png', image_urls: ['https://cdn.medaxisglobalpharma.com/products/test-fixture.png', 'https://cdn.medaxisglobalpharma.com/products/test-fixture-back.png'],
    video_url: 'https://cdn.medaxisglobalpharma.com/products/local/videos/product-fixture.mp4',
  }];
}

function detailPreviewProducts(chinese: boolean) {
  const template = products(chinese)[0]!;
  const description = (chinese ? '这是制药企业提供的产品资料，采购详情应按已发布的信息确认。' : 'Published manufacturer information describes the supplied product, packaging and documented sourcing requirements. ').repeat(24);
  const descriptionHtml = `<h3>${chinese ? '产品资料' : 'Published details'}</h3><p>${description}</p><ul><li>Manufacturer instructions apply.</li></ul><script>globalThis.NEVER_EXECUTE_CATALOG_SCRIPT=true</script>`;
  return Array.from({ length: 8 }, (_, index) => {
    const slug = `detail-preview-${index}`;
    const name = `Detail preview medicine ${index}`;
    const zhName = `产品资料示例 ${index}`;
    return { ...template, id: `a2f591d0-346b-4cc4-8d67-e25358fa02${String(index).padStart(2, '0')}`, sku: `DETAIL-PREVIEW-${index}`, brand_name: chinese ? zhName : name, slug: chinese ? `${slug}-cn` : slug,
      alternate_slugs: { en: slug, zhCN: `${slug}-cn` }, translations: { en: { brand_name: name, slug, description }, zhCN: { brand_name: zhName, slug: `${slug}-cn`, description } },
      description, description_html: descriptionHtml,
      generic: master('b2f591d0-346b-4cc4-8d67-e25358fa0272', 'Detail preview generic', '产品资料通用名', 'detail-preview-generic', chinese),
      categories: [master('c2f591d0-346b-4cc4-8d67-e25358fa0272', 'Detail preview category', '产品资料分类', 'detail-preview-category', chinese)],
    };
  });
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
const fixtureRatings = new Map<string, Map<string, number>>();
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:4100');
  res.setHeader('Content-Type', 'application/json');
  if (await customerFixture(req, res, url)) return;
  if (url.pathname.startsWith('/v1/public/products')) {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3100');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  }
  if (url.pathname === '/health') { res.end(JSON.stringify({ ok: true })); return; }
  if (url.pathname === '/__test__/admin' && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += String(chunk);
    const { email, scenario } = z.object({ email: z.email(), scenario: z.string().default('normal') }).parse(JSON.parse(raw)); const id = randomUUID();
    admins.set(email, { id, email, scenario, full: `s%3A${id}.FIXTURE-FULL`, pre: `s%3A${id}.FIXTURE-PRE`, verified: false, revoked: false, others: true, calls: [], streams: new Set(), otherStreams: new Set(), connects: 0, disconnects: 0 }); const directoryFixture = managementFixture(); if (scenario === 'dropdown-controls') directoryFixture.resources.categories!.push({ _id: workflowIds.prescription, created_at: timestamp, updated_at: timestamp, translations: { en: { name: 'Additional category', slug: 'additional-category' }, zhCN: { name: '\u6d4b\u8bd5\u5206\u7c7b', slug: 'additional-category-cn' } }, sort_order: 1, is_active: true }); management.set(id,directoryFixture); if (scenario === 'workflow-production') createProductionWorkflow(id); if (scenario.startsWith('workflow')) workflows.set(id, workflowFixture(scenario)); success(res, { configured: true }); return;
  }
  if (url.pathname === '/__test__/admin') {
    const state = admins.get(url.searchParams.get('email') ?? '');
    if (!state) { res.writeHead(404); res.end('{}'); return; }
    if (req.method === 'POST') { res.writeHead(405); res.end(); return; }
    if (url.searchParams.get('action') === 'event') { if (state.scenario === 'workflow-website-request-empty') workflows.get(state.id)!.rfq.status = 'SUBMITTED'; const eventId = randomUUID(); const frame = `id: ${eventId}\nevent: NEW_RFQ\ndata: ${JSON.stringify({ rfq_id: productId, rfq_number: 'RFQ-LIVE-001', created_at: timestamp, private_extra: 'NEVER_RENDER_ADMIN_EVENT' })}\n\n`; for (const stream of state.streams) stream.write('id: fake\nevent: NEW_RFQ\ndata: broken\n\n' + frame + frame); }
    if (url.searchParams.get('action') === 'disconnect') for (const stream of state.streams) stream.end();
    if (url.searchParams.get('action') === 'expire') { state.revoked = true; for (const stream of state.streams) stream.end(); }
    if(url.searchParams.get('action')==='management'){success(res,management.get(state.id));return;}
    if (url.searchParams.get('action') === 'workflow') { success(res, productionWorkflowState(state.id) ?? workflows.get(state.id)); return; }
    success(res, { calls: state.calls, connects: state.connects, disconnects: state.disconnects, active: state.streams.size, verified: state.verified, revoked: state.revoked, ...(url.searchParams.get('action') === 'other-session' && state.verified && state.others ? { other_cookie: state.full.replace('FIXTURE-FULL', 'FIXTURE-OTHER') } : {}) }); return;
  }
  if (url.pathname.startsWith('/v1/public/rfq-workflow/')) { let raw = ''; for await (const chunk of req) raw += String(chunk); if (await handleProductionGuest(url, req.method ?? 'GET', raw, res, (owner) => [...admins.values()].find((entry) => entry.id === owner)?.streams ?? new Set())) return; }
  if (url.pathname.startsWith('/v1/admin/')) {
    const path = url.pathname.slice('/v1/admin/'.length); const rawCookie = req.headers.cookie ?? ''; const pair = (name: string) => rawCookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
    let input: unknown; let multipart:FormData|undefined; if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') { const chunks:Buffer[]=[]; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const bytes=new Uint8Array(Buffer.concat(chunks)); try { if(req.headers['content-type']?.startsWith('multipart/form-data'))multipart=await new Request('http://fixture.test',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData();else input=JSON.parse(new TextDecoder().decode(bytes)); } catch { quoteError(res,400,'INVALID_REQUEST');return; } }
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
    if (handleProductionAdmin(state.id, url, req.method ?? 'GET', input, res, state.streams)) return;
    if (path === 'auth/logout') { state.revoked = true; for (const stream of state.streams) stream.end(); res.setHeader('Set-Cookie', [adminCookie(`medaxis_admin_session=${state.full}`, '/v1/admin'), adminCookie('medaxis_admin_session=', '/v1/admin', true), adminCookie('pre_auth_session=', '/v1/admin/auth', true)]); success(res, { logged_out: true }); return; }
    if (path === 'auth/revoke-sessions') { const count = state.others ? 1 : 0; state.others = false; for (const stream of state.otherStreams) stream.end(); success(res, { revoked_count: count }); return; }
    if (path === 'auth/sessions') { success(res, [adminSession(state.id, !other), ...(state.others ? [adminSession(englishId, other)] : [])]); return; }
    if (path === 'auth/profile') {
      const current = profiles.get(state.id) ?? { id: state.id, email: state.email, display_name: 'Admin', phone_number: '', avatar_url: null };
      if (req.method === 'PATCH') {
        const body = z.object({ email: z.email(), display_name: z.string(), phone_number: z.string(), avatar_url: z.string().nullable().optional(), current_password: z.string().optional() }).safeParse(input);
        if (!body.success || body.data.email !== current.email && body.data.current_password !== 'fixture-password') { quoteError(res, 422, 'VALIDATION_FAILED'); return; }
        const updated = { id: state.id, email: body.data.email, display_name: body.data.display_name, phone_number: body.data.phone_number, avatar_url: body.data.avatar_url === undefined ? current.avatar_url : body.data.avatar_url ? fixtureAvatar : null };
        profiles.set(state.id, updated); success(res, updated); return;
      }
      success(res, current); return;
    }
    if (path === 'auth/change-password') {
      const body = z.object({ current_password: z.string(), new_password: z.string().min(12), confirm_password: z.string() }).safeParse(input);
      if (!body.success || body.data.current_password !== 'fixture-password' || body.data.new_password !== body.data.confirm_password) { quoteError(res, 422, 'VALIDATION_FAILED'); return; }
      state.others = false; success(res, { changed: true }); return;
    }
    if (path === 'catalog/translate-indications' && req.method === 'POST') {
      const body = z.object({ text: z.string().min(1).max(5000) }).safeParse(input);
      if (!body.success) { quoteError(res, 422, 'VALIDATION_FAILED'); return; }
      if (!state.scenario.startsWith('generic-translation')) { quoteError(res, 503, 'TRANSLATION_NOT_CONFIGURED'); return; }
      if (body.data.text.includes('Slow')) await new Promise((resolve) => setTimeout(resolve, 1000));
      success(res, { translated_text: body.data.text.includes('Updated') ? '\u66f4\u65b0\u540e\u7684\u9002\u5e94\u75c7\u8bf4\u660e\u3002EGFR T790M\u3002' : '\u7ecf\u6838\u5b9e\u7684\u9002\u5e94\u75c7\u8bf4\u660e\u3002EGFR T790M\u3002', source_language: 'en', target_language: 'zh-CN' }); return;
    }
    const mg=management.get(state.id)!;const mgData=z.record(z.string(),z.unknown()).safeParse(input);const mgBody=mgData.success?mgData.data:{};
    if (state.scenario === 'manufacturer-logo-down' && path === 'catalog/manufacturers' && req.method === 'POST' && typeof mgBody.logo_data_url === 'string') {
      quoteError(res, 503, 'MANUFACTURER_LOGO_UPLOAD_FAILED');
      return;
    }
    if(path==='auth/2fa/enroll'){state.others=false;success(res,{qr_data_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',backup_codes:Array.from({length:8},(_,i)=>'BACKUP-ONCE-'+i)});return;}
    const resource=/^(?:catalog|cms)\/(products|manufacturers|generics|categories|banners)(?:\/([a-f0-9-]+))?$/.exec(path);
    if(resource && !(state.scenario.startsWith('workflow')&&path==='catalog/products'&&req.method==='POST')) {
      const kind=resource[1]!; const records=mg.resources[kind]!; const id=resource[2];
      if(req.method==='GET') {
        if(id) {
          const found=records.find((row)=>row._id===id && !row.deleted_at);
          if(!found)quoteError(res,404,'RESOURCE_NOT_FOUND');else success(res,{...found,internal_secret:'NEVER_RENDER_MANAGEMENT_SECRET'});
          return;
        }
        let rows=records.filter((row)=>!row.deleted_at).filter((row)=>!url.searchParams.has('is_active')||String(row.is_active)===url.searchParams.get('is_active')).filter((row)=>!url.searchParams.has('status')||row.status===url.searchParams.get('status'));
        if(kind==='banners' && url.searchParams.has('placement')) rows=rows.filter((row)=>(row.placement??'ANNOUNCEMENT')===url.searchParams.get('placement'));
        const q=url.searchParams.get('q')?.toLowerCase();if(q)rows=rows.filter((row)=>JSON.stringify(row.translations).toLowerCase().includes(q));
        const pg=Number(url.searchParams.get('page')??1),limit=Number(url.searchParams.get('limit')??20);
        success(res,rows.slice((pg-1)*limit,pg*limit),pg,limit,rows.length);return;
      }
      mg.writes.push({path,body:input});
      if(req.method==='DELETE' && id) {
        const record=records.find((row)=>row._id===id);
        if(!record){quoteError(res,404,'RESOURCE_NOT_FOUND');return;}
        if(record.deleted_at){success(res,{id,deleted:true});return;}
        if(state.scenario==='delete-conflict' && mg.writes.filter((write)=>write.path===path).length===1)record.updated_at=new Date().toISOString();
        if(record.updated_at!==mgBody.expected_updated_at){quoteError(res,409,'RESOURCE_STATE_CONFLICT');return;}
        if(kind==='banners') {
          mg.resources[kind]=records.filter((row)=>row._id!==id) as never;
          success(res,{id,deleted:true});return;
        }
        if(kind!=='products') {
          const used=mg.resources.products!.some((product)=>!product.deleted_at && (kind==='manufacturers'?product.manufacturer_id===id:kind==='generics'?product.generic_id===id:Array.isArray(product.category_ids)&&product.category_ids.includes(id)));
          if(used){quoteError(res,422,'VALIDATION_FAILED');return;}
        }
        record.deleted_at=new Date().toISOString();if(kind==='products')record.status='ARCHIVED';else record.is_active=false;
        if(state.scenario==='delete-loss'){quoteError(res,500,'INTERNAL_SERVER_ERROR');return;}
        success(res,{id,deleted:true});return;
      }
      const recordId=id??(typeof mgBody.id==='string'?mgBody.id:randomUUID());const old=records.find((row)=>row._id===recordId);const record:Record<string,unknown>={...old,...mgBody,_id:recordId,created_at:old?.created_at??timestamp,updated_at:new Date().toISOString()};delete record.id;if(record.logo_data_url===null)delete record.logo_data_url;if(record.review_metadata===null)delete record.review_metadata;const translations=z.record(z.string(),z.unknown()).safeParse(record.translations);if(translations.success&&translations.data.zhCN===null)delete translations.data.zhCN;if(translations.success){for(const value of Object.values(translations.data)){if(value&&typeof value==='object')for(const [key,entry]of Object.entries(value))if(entry===null)delete (value as Record<string,unknown>)[key];}record.translations=translations.data;}
      if(kind==='banners') {
        for(const key of ['starts_at','ends_at','link_path','media_type','media_key','resource_type','resource_id','show_overlay'])if(mgBody[key]===undefined)delete record[key];
        if(typeof record.media_key==='string') record.media_url='https://cdn.medaxisglobalpharma.com/'+record.media_key;
        else delete record.media_url;
      }
      for(const key of ['video_key','seo_image_key','storage_condition'])if(record[key]===null)delete record[key];const index=records.findIndex((row)=>row._id===recordId);if(index<0)records.push(record);else records[index]=record;success(res,record);return;
    }
    if(path==='catalog/images'){
      mg.writes.push({path,body:{multipart:true}});const file=multipart?.get('image');if(!(file instanceof File)){quoteError(res,422,'VALIDATION_FAILED');return;}
      const key=state.scenario.startsWith('product-form')?'products/s3/'+randomUUID()+'.png':'products/s3/fixture-upload.png';
      success(res,{object_key:key,url:'https://cdn.medaxisglobalpharma.com/'+key,mime_type:file.type,file_size_bytes:file.size});return;
    }
    if(path==='catalog/videos'){
      mg.writes.push({path,body:{multipart:true}});const file=multipart?.get('video');if(!(file instanceof File)){quoteError(res,422,'VALIDATION_FAILED');return;}
      const key='products/s3/videos/'+randomUUID()+'.webm';
      success(res,{object_key:key,url:'https://cdn.medaxisglobalpharma.com/'+key,mime_type:'video/webm',file_size_bytes:file.size});return;
    }
    if(path==='catalog/import-csv'){const file=multipart?.get('file');if(!(file instanceof File)){quoteError(res,422,'VALIDATION_FAILED');return;}const raw=await file.text();const hash=createHash('sha256').update(raw).digest('hex');const dry=url.searchParams.get('dry_run')==='true';const valid=!raw.includes('invalid-row');if(!dry&&mg.dryHash!==hash){quoteError(res,422,'VALIDATION_FAILED');return;}mg.writes.push({path,body:{dry_run:dry,hash}});if(dry&&valid)mg.dryHash=hash;if(!dry&&valid)mg.commits++;if(!dry&&state.scenario.includes('import-loss')){loseQuotationResponse(res);return;}res.statusCode=dry?200:202;success(res,{dry_run:dry,valid,total_rows:1,valid_rows:valid?1:0,committed:!dry&&valid?1:0,rows:[{row:2,sku:'CSV-FIXTURE',valid,errors:valid?[]:[{field:'manufacturer_slug',issue:'Master not found.'}]}]});return;}
    if(path==='settings'&&!state.scenario.includes('config-down')){if(req.method==='PATCH'){mg.writes.push({path,body:input});for(const [key,value]of Object.entries(mgBody))mg.settings[key]={value,updated_at:new Date().toISOString()};}success(res,mg.settings);return;}
    if(path==='fx-rates'&&req.method==='PATCH'){mg.writes.push({path,body:input});success(res,fixtureFx());return;}
    if(path==='customers'||path.startsWith('customers/')){const customer={_id:workflowIds.manufacturer,full_name:'Customer profile fixture',customer_type:'B2B_WHOLESALE',company_name:'Verified buyer',email:'customer@fixture.example',preferred_locale:'zh-CN',country:'CN',city:'Shanghai',created_at:timestamp,updated_at:timestamp};if(path==='customers')success(res,[customer],Number(url.searchParams.get('page')??1),20,1);else success(res,{customer,history:[{_id:workflowIds.rfq,rfq_number:'RFQ-WORKFLOW-001',inquiry_type:'CART_RFQ',status:'SUBMITTED',created_at:timestamp,quotations:[]}]},Number(url.searchParams.get('page')??1),20,1);return;}
    if(path==='audit-logs'){success(res,[{id:workflowIds.prescription,actor_type:'SUPER_ADMIN',actor_id:state.id,action:'PRODUCT_SAVED',entity_type:'products',entity_id:workflowIds.rfq,request_id:meta.request_id,metadata:{status:'DRAFT',medical_secret:'NEVER_RENDER_AUDIT_SECRET'},created_at:timestamp}],1,20,1);return;}
    if(path==='quotations/summary'){
      const wf=workflows.get(state.id); const current=wf?.quote?.versions.find((version)=>version.id===wf.quote?.quotation.current_version_id);
      const active=wf?.quote?.quotation.overall_status==='ACTIVE';
      const pending=!!(active&&current?.status==='ACCEPTED'&&current.reservation_status==='ACTIVE'&&Date.parse(current.reservation_expires_at??'')>Date.now());
      success(res,{as_of:new Date().toISOString(),window_hours:24,active_quotations:wf?Number(active):7,drafts:Number(active&&current?.status==='DRAFT'),sent:Number(active&&current?.status==='SENT'),accepted_payment_pending:wf?Number(pending):3,ready_to_dispatch:wf?Number(active&&current?.status==='PAYMENT_RECEIVED'&&current.reservation_status==='CONSUMED'&&!!current.payment):2,expiring_allocations:wf?Number(pending&&Date.parse(current?.reservation_expires_at??'')<=Date.now()+86400000):1});return;
    }
    if(path==='quotations'){
      const wf=workflows.get(state.id); const quote=wf?.quote; const current=quote?.versions.find((version)=>version.id===quote.quotation.current_version_id);
      let rows=quote&&current?[{...quote.quotation,rfq_number:wf!.rfq.rfq_number,customer:current.contact,created_at:timestamp,updated_at:timestamp,version:current}]:[];
      for(const key of ['status','overall_status','rfq_id']){const value=url.searchParams.get(key);if(value)rows=rows.filter((row)=>key==='status'?row.version.status===value:key==='overall_status'?row.overall_status===value:row.rfq_id===value);}
      const worklist=url.searchParams.get('worklist');if(worklist)rows=rows.filter((row)=>row.overall_status==='ACTIVE'&&(worklist==='READY_TO_DISPATCH'?row.version.status==='PAYMENT_RECEIVED'&&row.version.reservation_status==='CONSUMED'&&!!row.version.payment:row.version.status==='ACCEPTED'&&row.version.reservation_status==='ACTIVE'&&Date.parse(row.version.reservation_expires_at??'')>Date.now()&&(worklist!=='EXPIRING'||Date.parse(row.version.reservation_expires_at??'')<=Date.now()+86400000)));
      const term=url.searchParams.get('q')?.toLowerCase();if(term)rows=rows.filter((row)=>[row.quotation_number,row.rfq_number,row.customer.full_name,row.customer.company_name,row.customer.email].some((value)=>value?.toLowerCase().includes(term)));
      const pg=Number(url.searchParams.get('page')??1),limit=Number(url.searchParams.get('limit')??20);success(res,rows.slice((pg-1)*limit,pg*limit),pg,limit,rows.length);return;
    }
    const workflow = workflows.get(state.id);
    if (workflow) {
      const wf = workflow; const rfqPath = `rfqs/${workflowIds.rfq}`; const quotePath = `quotations/${workflowIds.quote}`; const body = z.record(z.string(), z.unknown()).safeParse(input); const data = body.success ? body.data : {};
      if (path === 'rfqs' && state.scenario.startsWith('workflow-website-request')) {
        if (state.scenario === 'workflow-website-request-down') { success(res, { malformed: true }); return; }
        const status = url.searchParams.get('status');
        const rows = !status || wf.rfq.status === status ? [wf.rfq] : [];
        success(res, rows, Number(url.searchParams.get('page') ?? 1), Number(url.searchParams.get('limit') ?? 20), rows.length); return;
      }
      if (state.scenario.includes('config-down') && ['settings', 'fx-rates'].includes(path)) { quoteError(res, 502, 'SERVICE_UNAVAILABLE'); return; }
      if (path === 'settings') { success(res, workflowSettings); return; }
      if (path === rfqPath && req.method === 'GET') { success(res, wf.rfq); return; }
      if (path === quotePath && req.method === 'GET') { if (!wf.quote) quoteError(res, 404, 'RESOURCE_NOT_FOUND'); else success(res, wf.quote); return; }
      if (path.startsWith(`${rfqPath}/`) && ['POST', 'PATCH'].includes(req.method ?? '')) {
        wf.writes.push({ path, body: input });
        if (path.endsWith('/notes') || path.endsWith('/request-clarification')) { const id = randomUUID(); const clarify = path.endsWith('/request-clarification'); wf.rfq.clarification_messages.push({ _id: id, body: String(data.body), direction: clarify ? 'ADMIN_TO_BUYER' : 'INTERNAL_NOTE', channel: clarify ? String(data.channel) : 'ADMIN', status: clarify ? 'PENDING_BUYER' : 'RESOLVED', created_at: timestamp }); if (clarify) wf.rfq.status = 'NEED_CLARIFICATION'; success(res, clarify ? { message_id: id, thread_id: id, status: wf.rfq.status } : { note_id: id }); return; }
        if (path.includes('/items/')) { const line = wf.rfq.items.find((item) => item._id === path.split('/').at(-1)); if (!line) { quoteError(res, 404, 'RESOURCE_NOT_FOUND'); return; } line.item_availability_status = String(data.item_availability_status); if (data.customer_facing_note) line.customer_facing_note = String(data.customer_facing_note); }
        if (path.endsWith('/status')) wf.rfq.status = String(data.status); if (path.endsWith('/unable-to-supply')) wf.rfq.status = 'CLOSED'; success(res, wf.rfq); return;
      }
      if (path === 'catalog/products' && req.method === 'POST') { wf.writes.push({ path, body: input }); success(res, { _id: randomUUID(), ...data }); return; }
      if (path === `prescriptions/${workflowIds.prescription}/stream`) { if (state.scenario.includes('pdf-html')) { res.writeHead(502, { 'Content-Type': 'text/html' }); res.end('<html>NEVER_RENDER_WORKFLOW_SECRET</html>'); } else { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end('%PDF-1.4\n%private fixture'); } return; }
      if (path === 'quotations/draft' || path.startsWith(`${quotePath}/`)) {
        wf.writes.push({ path, body: input }); const current = wf.quote?.versions.find((version) => version.id === wf.quote!.quotation.current_version_id);
        if (path === 'quotations/draft') { if (wf.quote) { quoteError(res, 409, 'CONFLICT'); return; } wf.quote = quotationDetailFixture(); wf.rfq.quotations = [{ ...wf.quote.quotation, created_at: timestamp }]; if (state.scenario.includes('loss') && !wf.lost) { wf.lost = true; loseQuotationResponse(res); return; } success(res, { quotation_id: workflowIds.quote, version: wf.quote.versions[0], fx_preview: { rates_to_bdt: { USD: '122.50000000', EUR: '130', CNY: '17' }, stale: false, captured_at: timestamp } }); return; }
        if (!wf.quote || !current) { quoteError(res, 404, 'RESOURCE_NOT_FOUND'); return; }
        if (data.expected_version_id && data.expected_version_id !== current.id || data.expected_current_version_id && data.expected_current_version_id !== current.id || state.scenario.includes('conflict') && !wf.lost) { wf.lost = true; quoteError(res, 409, 'QUOTATION_VERSION_CONFLICT'); return; }
        if (path.endsWith('/send') && state.scenario.includes('send-500')) { quoteError(res, 500, 'INTERNAL_SERVER_ERROR'); return; }
        if (path.endsWith('/send')) { current.status = 'SENT'; current.issued_at = timestamp; wf.rfq.status = 'QUOTED'; }
        if(path.endsWith('/draft')){if(current.status!=='DRAFT'||mgBody.expected_updated_at!==current.updated_at){quoteError(res,409,'QUOTATION_VERSION_CONFLICT');return;}current.updated_at=new Date(Date.now()+1).toISOString();current.freight_cost=String(mgBody.freight_amount);success(res,{version:current,fx_preview:{rates_to_bdt:{USD:'122.5',EUR:'130',CNY:'17'},stale:false,captured_at:timestamp}});return;}
        if (path.endsWith('/revise')) { current.status = 'SUPERSEDED'; const next = adminVersionFixture(data.issue_immediately ? 'SENT' : 'DRAFT', 2); wf.quote.versions.push(next); wf.quote.internal_costs.push(costFixture(next.id)); wf.quote.quotation.current_version = 2; wf.quote.quotation.current_version_id = next.id; wf.rfq.quotations = [{ ...wf.quote.quotation, created_at: timestamp }]; success(res, { version: next, fx_preview: { rates_to_bdt: { USD: '122.5', EUR: '130', CNY: '17' }, stale: false, captured_at: timestamp }, ...(data.issue_immediately ? { magic_link_url: workflowLink(state.id, wf, next) } : {}) }); return; }
        if (path.endsWith('/fulfillment')) { if (state.scenario.includes('fulfillment-concurrent') && !wf.lost) { wf.lost = true; current.status = 'PAYMENT_RECEIVED'; current.reservation_status = 'CONSUMED'; current.payment = { reference: 'OTHER-ADMIN-WIRE', amount: current.total_amount, currency: current.billing_currency, received_at: timestamp }; quoteError(res, 409, 'CONFLICT'); return; } if (data.status === 'PAYMENT_RECEIVED') { if (current.status !== 'ACCEPTED' || !current.reservation_expires_at || Date.parse(current.reservation_expires_at) <= Date.now()) { quoteError(res, 409, 'CONFLICT'); return; } current.payment = { reference: String(data.wire_reference), amount: String(data.amount), currency: String(data.currency), received_at: timestamp }; current.reservation_status = 'CONSUMED'; } else if (data.status === 'DISPATCHED') { if (current.status !== 'PAYMENT_RECEIVED') { quoteError(res, 409, 'CONFLICT'); return; } current.shipment = { courier_name: String(data.courier_name), awb_tracking_number: String(data.awb_tracking_number), dispatched_at: timestamp, ...(data.estimated_delivery ? { estimated_delivery: String(data.estimated_delivery) } : {}) }; } else { if (current.status !== 'DISPATCHED') { quoteError(res, 409, 'CONFLICT'); return; } current.delivered_at = timestamp; wf.quote.quotation.overall_status = 'COMPLETED'; } current.status = String(data.status); if (state.scenario.includes('fulfillment-timeout') && !wf.lost) { wf.lost = true; setTimeout(() => { if (!res.destroyed) success(res, current); }, 22_000); return; } if (state.scenario.includes('fulfillment-loss') && !wf.lost) { wf.lost = true; loseQuotationResponse(res); return; } success(res, current); return; }
        const link = workflowLink(state.id, wf, current); if (path.endsWith('/resend') && state.scenario.includes('resend-loss') && !wf.lost) { wf.lost = true; loseQuotationResponse(res); return; } success(res, { version: current, magic_link_url: link }); return;
      }
    }
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
    const workflowToken = workflowTokens.get(quoteMatch[2]!);
    if (workflowToken) {
      const wf = workflows.get(workflowToken.owner); const version = wf?.quote?.versions.find((item) => item.id === workflowToken.version);
      if (!workflowToken.valid || !wf || !version) { quoteError(res, 404, 'RESOURCE_NOT_FOUND'); return; }
      if (wf.quote?.quotation.current_version_id !== version.id || version.status === 'SUPERSEDED') { quoteError(res, 409, 'QUOTATION_VERSION_CONFLICT'); return; }
      if (quoteMatch[1] !== 'token') { quoteError(res, 404, 'RESOURCE_NOT_FOUND'); return; }
      success(res, { ...version, availability: { available: version.items.filter((line) => line.availability_status === 'AVAILABLE').length, unavailable: version.items.filter((line) => line.availability_status === 'UNAVAILABLE').length, sourcing: version.items.filter((line) => line.availability_status === 'SOURCING').length }, procurement_cost_bdt: 'NEVER_RENDER_COST', procurement_unit_cost_bdt: 'NEVER_RENDER_COST', markup_percent: 'NEVER_RENDER_MARKUP', gross_margin_bdt: 'NEVER_RENDER_MARGIN', internal_procurement_notes: 'NEVER_RENDER_NOTES', internal_costs: wf.quote?.internal_costs }); return;
    }
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
  const ratingMatch = /^\/v1\/public\/products\/([a-f0-9-]{36})\/ratings$/.exec(url.pathname);
  if (ratingMatch) {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3100');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const visitor = /medaxis_fixture_rating=([a-f0-9-]+)/.exec(req.headers.cookie ?? '')?.[1] ?? randomUUID();
    const votes = fixtureRatings.get(ratingMatch[1]) ?? new Map<string, number>();
    if (req.method === 'PUT') {
      let raw = ''; for await (const chunk of req) raw += String(chunk);
      const body = JSON.parse(raw) as { score: number };
      if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5) { quoteError(res, 422, 'VALIDATION_FAILED'); return; }
      votes.set(visitor, body.score); fixtureRatings.set(ratingMatch[1], votes);
      res.setHeader('Set-Cookie', `medaxis_fixture_rating=${visitor}; Path=/v1/public/products; HttpOnly; SameSite=Lax`);
    }
    success(res, { average: votes.size ? Math.round([...votes.values()].reduce((total, score) => total + score, 0) / votes.size * 10) / 10 : 0, count: votes.size, my_rating: votes.get(visitor) ?? null }); return;
  }
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
  const comparisonFixture = query === 'product-tools' || url.pathname.includes('/comparison-fixture-');
  const baseProducts = products(chinese);
  const extras = ['40', '120'].map((strength, index) => ({ ...baseProducts[1], id: `82f591d0-346b-4cc4-8d67-e25358fa028${index}`, brand_name: `Comparison fixture ${index + 1}`, slug: `comparison-fixture-${index + 1}`, strength: `${strength} mg`, alternate_slugs: { en: `comparison-fixture-${index + 1}`, zhCN: null }, translations: { en: { brand_name: `Comparison fixture ${index + 1}`, slug: `comparison-fixture-${index + 1}` } } }));
  const detailPreviewFixture = url.pathname.includes('/detail-preview-') || ['generic', 'category'].some((key) => url.searchParams.get(key)?.startsWith('detail-preview-'));
  const all = detailPreviewFixture ? detailPreviewProducts(chinese) : comparisonFixture ? [...baseProducts, ...extras] : baseProducts;
  let rows = all.filter((product) => comparisonFixture || !query || `${product.brand_name} ${product.generic.name}`.toLowerCase().includes(query.toLowerCase()));
  for (const key of ['manufacturer', 'generic', 'category'] as const) {
    const slug = url.searchParams.get(key);
    if (slug) rows = rows.filter((product) => key === 'category' ? product.categories.some((category) => category.slug === slug) : product[key].slug === slug);
  }
  if (url.searchParams.has('cold_chain')) rows = rows.filter((product) => product.cold_chain_required === (url.searchParams.get('cold_chain') === 'true'));
  if (url.searchParams.get('dosage_form')) rows = rows.filter((product) => product.dosage_form === url.searchParams.get('dosage_form'));
  const facets = { dosage_forms: rows.length ? [{ name: 'Tablet', count: rows.length }] : [], cold_chain: [true, false].flatMap((required) => { const count = rows.filter((product) => product.cold_chain_required === required).length; return count ? [{ required, count }] : []; }), unknown_prices: ['NEVER_RENDER_PRIVATE_PRICE'] };
  if (url.pathname === '/v1/public/products') { success(res, { products: rows.slice((page - 1) * limit, page * limit), facets }, page, limit, rows.length); return; }
  if (url.pathname === '/v1/public/cms/banners') {
    if (process.env.ANNOUNCEMENT_E2E_FIXTURES === '1') {
      success(res, [
        { id: 'a2f591d0-346b-4cc4-8d67-e25358fa0290', placement: 'ANNOUNCEMENT', title: chinese ? '采购服务公告' : 'Sourcing desk update', body: chinese ? '欢迎提交您的采购需求。' : 'Medicine sourcing enquiries welcome.', sort_order: 0, link_path: '/en/products' },
        { id: 'a2f591d0-346b-4cc4-8d67-e25358fa0291', placement: 'ANNOUNCEMENT', title: chinese ? '产品目录更新' : 'Catalog updates', body: chinese ? '浏览已发布的产品。' : 'Browse our published products.', sort_order: 1, link_path: '/en/products' },
        { id: 'a2f591d0-346b-4cc4-8d67-e25358fa0292', placement: 'ANNOUNCEMENT', title: chinese ? '文件咨询' : 'Documentation enquiries', body: chinese ? '与团队沟通您的需求。' : 'Share your documentation requirements.', sort_order: 2, link_path: '/en/services' },
        { id: 'a2f591d0-346b-4cc4-8d67-e25358fa0293', placement: 'ANNOUNCEMENT', title: chinese ? '联系采购团队' : 'Contact our sourcing team', body: chinese ? '按目的地协调运输。' : 'Coordinate your destination requirements.', sort_order: 3 },
      ]); return;
    }
    if (process.env.BANNER_E2E_FIXTURES === '1') {
      const visual = { media_type: 'IMAGE', media_url: 'https://cdn.medaxisglobalpharma.com/products/s3/banner-fixture.png', sort_order: 0, body: 'Documented sourcing support for your next enquiry.', link_path: '/en/products' };
      success(res, [
        { ...visual, id: 'a2f591d0-346b-4cc4-8d67-e25358fa0280', placement: 'MAIN_HERO', title: 'Your sourcing partner', show_overlay: true },
        { ...visual, id: 'a2f591d0-346b-4cc4-8d67-e25358fa0281', placement: 'MAIN_HERO', title: 'Manufacturer connections', media_type: 'VIDEO', media_url: 'https://cdn.medaxisglobalpharma.com/products/s3/videos/banner-fixture.webm', show_overlay: false },
        { ...visual, id: 'a2f591d0-346b-4cc4-8d67-e25358fa0282', placement: 'PRODUCTS_BANNER', title: 'Explore the catalog', show_overlay: true },
        { ...visual, id: 'a2f591d0-346b-4cc4-8d67-e25358fa0283', placement: 'BLOG_BANNER', title: 'Sourcing insights', show_overlay: true },
        { ...visual, id: 'a2f591d0-346b-4cc4-8d67-e25358fa0284', placement: 'BLOG_BANNER', title: 'Sourcing in motion', media_type: 'VIDEO', media_url: 'https://cdn.medaxisglobalpharma.com/products/s3/videos/banner-fixture.webm', show_overlay: false },
      ]); return;
    }
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
