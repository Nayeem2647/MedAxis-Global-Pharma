# MedAxis Global Pharma — Database Design

Version: 1.0 | Release: 1 | Date: 2026-11-13

Sources: [DFD.md](DFD.md), [PRD.md](PRD.md), [Architecture.md](Architecture.md). This is a proposed implementation specification, not an existing database deployment. MongoDB stores business documents; AWS S3 stores files. All ten requested topics apply to this business.

## 1. Collection List

DFD store IDs are logical groups, not physical collection counts. This design has 21 collections. Operational collections omitted from the DFD dictionary are explicitly identified below.

| Collection | DFD mapping | Purpose |
|---|---|---|
| products | D1 | Multilingual medicine SKUs; no public prices |
| manufacturers | D2 | Direct licensed manufacturer records |
| generics | D3 | Active ingredient and SEO hubs |
| categories | D4 | Therapeutic categories |
| customers | D7 | B2B/B2C directory; no buyer accounts/passwords |
| rfqs | D5 | Inquiry, contact snapshot and embedded request items |
| rfq_idempotency_keys | D6 | Submission deduplication for 24 hours |
| prescriptions | D12 metadata | Optional encrypted medical file metadata |
| quotations | D8 | Stable quotation identity and current version pointer |
| quotation_versions | D8 | Versioned commercial snapshots and fulfillment |
| quotation_internal_costs | D9 | Private line costs, manufacturer attribution and margins |
| exchange_rates | D10 | Current live and manual BDT conversion rates |
| audit_logs | D11 | Append-only security and business events |
| notification_logs | D11 | Durable email outbox, delivery status and retries |
| clarification_messages | D13 | Questions, replies and offline communication notes |
| cms_banners | Catalog/CMS extension | Localized announcements |
| url_redirects | Catalog/SEO extension | Historical slug redirects |
| admins | Process 6 operational extension | Single Super Admin credentials and TOTP |
| admin_sessions | Process 6 operational extension | Revocable sessions and idle expiry |
| auth_attempts | Process 6 operational extension | Atomic brute-force counters/lockouts |
| platform_settings | Configuration extension | Packaging units, bank instructions, payment/shipping presets |

No separate `rfq_items`, `quotation_items` or product translation collections: these bounded child records are embedded. S3 buckets/prefixes contain prescription ciphertext, product images and quotation/proforma PDFs; S3 is outside MongoDB.

## 2. Schema

All schema definitions and conventions are maintained in [Database-Schema.md](Database-Schema.md).

## 3. Relationship

| Parent → Child | Cardinality / enforcement |
|---|---|
| Manufacturer → Product | 1:N; product must reference an active licensed manufacturer on publish |
| Generic → Product | 1:N; combination medicines can use a named combination generic in Release 1 |
| Category ↔ Product | M:N through bounded `category_ids` on products |
| Customer → RFQ | 1:N; preserve historical contact snapshots |
| RFQ → embedded items | 1:1..100; child UUIDs permit stable line matching |
| RFQ → Prescription / Clarification | 1:0..N; upload/replies optional |
| RFQ → Quotation | 1:0..N; Release 1 permits one ACTIVE quotation per RFQ |
| Quotation → Version | 1:1..N; unique version number; one current pointer |
| Version → embedded items | 1:1..100; copied snapshots never live product joins |
| Version → Internal costs | 1:1 by issue time; private collection |
| Admin → Session / Audit | 1:N; buyer/system audit actor may have no admin ID |

No cascading delete of financial records. Verify RFQ/customer/version ownership in the service. Public requests derive version identity from the validated token; never trust a caller-supplied customer ID. Database roles separate public catalog reads, private commercial operations and append-only audit writes.

## 4. Index

All collections receive the default unique `_id` index. Create other indexes in controlled migrations, not automatically on every production startup. `U` = unique; `P` = partial.

| Collection | Additional indexes |
|---|---|
| products | `sku` U; each localized slug U/P string; `{status:1,manufacturer_id:1}`; `{status:1,generic_id:1}`; `{status:1,category_ids:1}` |
| manufacturers, generics, categories | each localized slug U/P string; `{is_active:1}` |
| customers | `email` U/P string; `whatsapp_number` nonunique; `wechat_id` P string |
| rfqs | `rfq_number` U; `{customer_id:1,created_at:-1}`; `{status:1,created_at:-1}` |
| rfq_idempotency_keys | `key` U; `expires_at` TTL 0 |
| prescriptions | `rfq_id`; `{purge_status:1,purge_scheduled_at:1}`; `{purge_status:1,next_retry_at:1}` |
| quotations | `quotation_number` U; `customer_id`; `{rfq_id:1}` U/P `overall_status:ACTIVE` |
| quotation_versions | `{quotation_id:1,version_number:1}` U; token hash U/P string; `{status:1,valid_until:1}`; `{status:1,reservation_expires_at:1}`; `{status:1,accepted_at:1}` |
| quotation_internal_costs | `quotation_version_id` U |
| exchange_rates | `currency_code` U |
| audit_logs | `{actor_id:1,created_at:-1}`; `{entity_type:1,entity_id:1,created_at:-1}` |
| notification_logs | `dedupe_key` U; `{status:1,next_retry_at:1}`; `{status:1,lease_until:1}`; `provider_message_id` P string |
| clarification_messages | `{rfq_id:1,created_at:-1}`; `{customer_id:1,created_at:-1}`; `{thread_id:1,created_at:1}`; `provider_event_id` U/P string |
| cms_banners | `{is_active:1,sort_order:1}` |
| url_redirects | `source_path` U |
| admins | `singleton_key` U; `email` U |
| admin_sessions | `token_hash` U; `{admin_id:1,revoked_at:1}`; `expires_at` TTL 0 |
| auth_attempts | `scope_key` U; `expires_at` TTL 0 |
| platform_settings | `key` U |

Normalize email by trimming and lowercasing; omit absent email. Do not use unsupported “email != null” partial-index pseudocode. For example:

```javascript
db.customers.createIndex({ email: 1 }, {
  unique: true, partialFilterExpression: { email: { $type: 'string' } }
});
db.customers.createIndex({ wechat_id: 1 }, {
  partialFilterExpression: { wechat_id: { $type: 'string' } }
});
db.rfq_idempotency_keys.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
db.quotation_versions.createIndex({ quotation_id: 1, version_number: 1 }, { unique: true });
```

TTL cleanup is asynchronous. Application code rejects expired sessions/keys immediately even if the document still exists. Never TTL-delete prescription metadata before confirming S3 deletion. Never TTL-delete financial records or audit logs.

Atlas Search is a separate search-index definition, not a normal B-tree index. Index only catalog name/strength/descriptive fields and materialized generic/manufacturer search labels; update those labels when master names change. Apply PUBLISHED filtering and explicit result projections; keep all commercial/private fields outside the search index.

## 5. Validation

Use request validation, Mongoose validation and MongoDB collection validators together. Request input must be allowlisted; no arbitrary MongoDB operators. Install `$jsonSchema` validators with `validationLevel:strict` and `validationAction:error` through migrations for all 21 collections using Section 2's field contracts. UUID strings use a UUID pattern, enum strings use explicit lists, money uses `bsonType:decimal`, counts use integer BSON types, and dates use `bsonType:date`.

Example database-level validator fragment for RFQs (the production migration must include all fields from Section 2):

```javascript
db.runCommand({ collMod: 'rfqs', validator: { $jsonSchema: {
  bsonType: 'object',
  required: ['_id', 'rfq_number', 'customer_id', 'contact_snapshot', 'items', 'status'],
  properties: {
    _id: { bsonType: 'string' },
    status: { enum: ['SUBMITTED','UNDER_REVIEW','NEED_CLARIFICATION','QUOTED','CONVERTED','CLOSED','CANCELLED'] },
    has_prescription: { bsonType: 'bool' },
    items: { bsonType: 'array', minItems: 1, maxItems: 100, items: {
      bsonType: 'object', required: ['_id','quantity','packaging_unit'],
      properties: { quantity: { bsonType: ['int','long'], minimum: 1 } }
    } }
  }
} }, validationLevel: 'strict', validationAction: 'error' });
```

Cross-document and transition rules belong in transactional services: valid references; current version identity; positive applicable FX rates; line total = quantity × unit price; total = payable available lines + freight + insurance; nonnegative costs; no decision on an expired/superseded version. Unavailable lines do not inflate totals. Validate bank instructions before issuance and payment currency before recording payment. Dispatch requires payment, courier and AWB; delivery requires dispatch. Accepted financial snapshots are immutable.

Password is transmitted over TLS and hashed server-side (Argon2id); the client does not submit an Argon2 hash as a credential. Require TOTP for full admin sessions. Enforce five failed attempts per configured lockout window and 30-minute idle sessions; proposed lockout duration is 15 minutes because DFD does not specify duration. Check session revocation/generation and expiry in middleware; TTL is cleanup only.

Medical purge deadline = `min(uploaded_at + 90 days, earliest relevant terminal_at + 14 days)`. Terminal events include delivered, declined, unable to supply/closed and payment expired. Use the quotation terminal event linked to the RFQ rather than expecting `rfqs.status=DELIVERED`. Schedule purge at the deadline; workers must run frequently enough to meet it and alert on overdue failures. An hourly sweep is proposed instead of a daily job that could exceed “within 14 days.” Deletion removes the S3 object, then clears storage/encryption metadata and records a minimal purge receipt. Redact medical information from clarification text/logs as well; raw email bodies are not retained indiscriminately.

## 6. Aggregation

Run administrative pipelines only behind admin authorization. Paginate before large joins where possible; examine query plans with realistic data before adding more indexes.

```javascript
// RFQ dashboard counts.
db.rfqs.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);

// Collected payments by currency: fulfillment continues after payment.
db.quotation_versions.aggregate([
  { $match: { status: { $in: ['PAYMENT_RECEIVED','DISPATCHED','DELIVERED'] } } },
  { $group: { _id: '$payment.currency', amount: { $sum: '$payment.amount' }, count: { $sum: 1 } } }
]);

// Repeat-customer inquiry history; private admin view.
db.rfqs.aggregate([
  { $match: { customer_id: customerId } },
  { $sort: { created_at: -1 } }, { $limit: 20 },
  { $lookup: { from: 'quotations', localField: '_id', foreignField: 'rfq_id', as: 'quotations' } },
  { $project: { rfq_number: 1, status: 1, created_at: 1,
    'quotations.quotation_number': 1, 'quotations.overall_status': 1 } }
]);
```

Do not sum USD, CNY, EUR and BDT into one revenue number. If a BDT report is required, convert each record with its locked issuance snapshot and label the result separately from actual bank receipts. Margin reports may join internal costs only in admin-only services. Public catalog aggregation uses explicit allowed fields, never a whole-document return.

## 7. Transaction

Use MongoDB transactions on a replica set/Atlas. Use snapshot reads, majority writes and the driver's transaction retry mechanism. Generate stable operation IDs before retries. External calls never run inside a transaction callback.

| Operation | Atomic boundary |
|---|---|
| RFQ intake | Insert unique idempotency key + resolve/upsert customer + RFQ + audit + confirmation outbox. Store request hash and response; same key/different request is conflict. |
| Issue/revise quotation | Check quotation pointer/status, validate draft, snapshot FX/terms/items, write cost document, issue new version, supersede old SENT version, move parent pointer and enqueue PDF/email work. |
| Accept quotation | Guard current SENT version and validity; set accepted date/reservation, update parent, audit and unique outbox events in one commit. |
| Record payment | Guard ACCEPTED plus unexpired reservation, write verified payment, consume reservation, audit and enqueue confirmation. |
| Dispatch/delivery | Guard predecessor state, write milestone, update parent on delivery, schedule prescription purge, audit/outbox. |
| Expiry/decline/close | Guard eligible state, release logical allocation where relevant, update parent, schedule earliest purge and write audit/outbox. |
| Slug change | Update master slug plus unique historical redirect; prevent redirect loops/chains. |

Acceptance service outline (JavaScript pseudocode; date arithmetic helper uses Asia/Dhaka calendar rules):

```javascript
await session.withTransaction(async () => {
  const quote = await Quotations.findOne({
    _id: quotationId, current_version_id: versionId, overall_status: 'ACTIVE'
  }).session(session);
  if (!quote) throw conflict('Version is not current');
  const version = await Versions.findOneAndUpdate({
    _id: versionId, quotation_id: quote._id,
    magic_link_token_hash: tokenHash, status: 'SENT', valid_until: { $gt: now }
  }, { $set: {
    status: 'ACCEPTED', accepted_at: now,
    acceptance_evidence: { accepted_at: now, client_ip: clientIp, user_agent: userAgent, terms_accepted: true },
    reservation_status: 'ACTIVE', reservation_expires_at: addBusinessCalendarDays(now, 5)
  } }, { new: true, session, runValidators: true });
  if (!version) {
    const existing = await Versions.findOne({
      _id: versionId, magic_link_token_hash: tokenHash
    }).session(session);
    if (existing && ['ACCEPTED','PAYMENT_RECEIVED','DISPATCHED','DELIVERED'].includes(existing.status)) {
      return; // HTTP layer returns existing success, without changing deadlines.
    }
    throw conflict('Quotation cannot be accepted');
  }
  // Writing parent also serializes acceptance against revision issuance.
  await Quotations.updateOne({ _id: quote._id, current_version_id: versionId },
    { $set: { updated_at: now } }, { session });
  // Atomically transition parent RFQ to CONVERTED
  await Rfqs.updateOne({ _id: quote.rfq_id },
    { $set: { status: 'CONVERTED', updated_at: now } }, { session });
  await Audit.create([acceptanceAudit(version)], { session });
  await Notifications.create(acceptanceOutbox(version), { session });
});
```

Authenticate token and derive `quotationId`/`versionId` server-side before this operation; set `now` at each transaction attempt. Payment and expiry race using opposing guarded writes on the same version. The expiry worker changes only ACCEPTED records with `reservation_expires_at <= now`; a recorded payment cannot be overwritten by expiry.

Single-document changes can use atomic conditional updates without a transaction if no dependent records must commit. FX fetch itself is outside MongoDB; copying selected rate values into an issued snapshot is part of the issue transaction, not a transaction with the FX provider.

S3/email/PDF/SSE are outside database atomicity. Commit outbox work, then workers claim jobs with a lease, perform effects and record results. Recover expired leases, use stable dedupe keys, verify webhook signatures and deduplicate provider events. Email delivery is at least once unless the provider supports idempotency; a crash after send can cause a duplicate. Retry failures up to three times with backoff, then mark DEAD and alert the admin. PDF failure must not undo a committed acceptance.

RFQ uploads use staged encrypted S3 keys before transaction commit; delete abandoned staged uploads after a bounded grace period. An S3 object deletion is retried before metadata is marked PURGED. Release 1 reservation is a commercial allocation flag, not proof of manufacturer inventory: no warehouse stock ledger exists in the source model.

## 8. Sample Data

Illustrative `mongosh` fixtures below use synthetic `.example` contacts and fictional catalog names/prices. Decimal128 and dates use BSON constructors. These are linked happy-path documents, not medical/product claims or a complete production seed. Seed referenced category, generic and manufacturer documents first.

```javascript
const manufacturerId = '00000000-0000-4000-8000-000000000001';
const genericId = '00000000-0000-4000-8000-000000000002';
const categoryId = '00000000-0000-4000-8000-000000000003';
const productId = '00000000-0000-4000-8000-000000000004';
const customerId = '00000000-0000-4000-8000-000000000005';
const rfqId = '00000000-0000-4000-8000-000000000006';
const itemId = '00000000-0000-4000-8000-000000000007';
const quoteId = '00000000-0000-4000-8000-000000000008';
const versionId = '00000000-0000-4000-8000-000000000009';
const now = ISODate('2026-11-13T06:00:00Z');
const timestamps = { created_at: now, updated_at: now };

db.manufacturers.insertOne({ _id: manufacturerId, translations: {
  en: { name: 'Demo Manufacturer', slug: 'demo-manufacturer' }
}, country: 'BD', certifications: [], is_active: true, ...timestamps });
db.generics.insertOne({ _id: genericId, translations: {
  en: { name: 'Demo Ingredient', slug: 'demo-ingredient' }
}, therapeutic_indications: [], is_active: true, ...timestamps });
db.categories.insertOne({ _id: categoryId, translations: {
  en: { name: 'Demo Category', slug: 'demo-category' }
}, sort_order: 1, is_active: true, ...timestamps });
db.products.insertOne({ _id: productId, sku: 'DEMO-001', manufacturer_id: manufacturerId,
  generic_id: genericId, category_ids: [categoryId], translations: {
    en: { brand_name: 'Demo Medicine', slug: 'demo-medicine' }
  }, strength: 'Demo strength', dosage_form: 'Tablet', pack_size: '10 tablets',
  packaging_unit: 'BOX', cold_chain_required: false, storage_condition: 'Store below 25°C', image_keys: [], status: 'PUBLISHED', ...timestamps });
db.customers.insertOne({ _id: customerId, full_name: 'Demo Buyer',
  customer_type: 'B2B_WHOLESALE', company_name: 'Example Clinic',
  email: 'buyer@clinic.example', country: 'SG', preferred_locale: 'en', ...timestamps });
const contact = { full_name: 'Demo Buyer', customer_type: 'B2B_WHOLESALE',
  company_name: 'Example Clinic', email: 'buyer@clinic.example', preferred_locale: 'en' };
db.rfqs.insertOne({ _id: rfqId, rfq_number: 'RFQ-2026-DEMO-001', customer_id: customerId,
  inquiry_type: 'CART_RFQ', contact_snapshot: contact, destination_country: 'SG',
  destination_city_port: 'Singapore', preferred_currency: 'USD', status: 'QUOTED', has_prescription: false,
  items: [{ _id: itemId, product_id: productId, is_uncatalogued: false,
    product_snapshot: { brand_name: 'Demo Medicine', pack_size: '10 tablets' },
    quantity: 10, packaging_unit: 'BOX', item_availability_status: 'AVAILABLE' }], ...timestamps });
db.quotations.insertOne({ _id: quoteId, quotation_number: 'Q-2026-DEMO-001',
  rfq_id: rfqId, customer_id: customerId, current_version: 1,
  current_version_id: versionId, overall_status: 'ACTIVE', ...timestamps });
db.quotation_versions.insertOne({ _id: versionId, quotation_id: quoteId,
  version_number: 1, status: 'SENT', contact_snapshot: contact,
  items: [{ _id: '00000000-0000-4000-8000-000000000010', rfq_item_id: itemId,
    product_id: productId, manufacturer_id: manufacturerId,
    brand_name_snapshot: 'Demo Medicine', generic_name_snapshot: 'Demo Ingredient',
    strength_snapshot: 'Demo strength', dosage_form_snapshot: 'Tablet',
    pack_size_snapshot: '10 tablets', packaging_unit: 'BOX', quantity: 10,
    availability_status: 'AVAILABLE', unit_quoted_price: NumberDecimal('10.00'),
    total_line_price: NumberDecimal('100.00') }], billing_currency: 'USD',
  subtotal_amount: NumberDecimal('100.00'), freight_cost: NumberDecimal('20.00'),
  insurance_cost: NumberDecimal('0.00'), total_amount: NumberDecimal('120.00'),
  shipping_terms: { method: 'EXPRESS_COURIER', named_place: 'Singapore', cold_chain_required: false },
  payment_terms: 'BANK_WIRE_TT', bank_details_snapshot: { bank_name: 'DEMO ONLY',
    account_name: 'DEMO ONLY', account_number: 'NON-PAYABLE-DEMO', swift_bic: 'DEMO ONLY' },
  fx_snapshot: { mode: 'MANUAL_FIXED', captured_at: now, rates_to_bdt: {
    USD: NumberDecimal('120'), CNY: NumberDecimal('16'), EUR: NumberDecimal('130') } },
  issued_at: now, valid_until: ISODate('2026-11-20T06:00:00Z'),
  magic_link_token_hash: 'a'.repeat(64), // Fixture only; never a real token hash.
  acceptance_evidence: null, reservation_status: 'NONE', ...timestamps });
db.quotation_internal_costs.insertOne({ _id: '00000000-0000-4000-8000-000000000011',
  quotation_version_id: versionId, items: [{ rfq_item_id: itemId,
    manufacturer_id: manufacturerId, procurement_unit_cost_bdt: NumberDecimal('1000'),
    quantity: 10, markup_percent: NumberDecimal('20') }],
  procurement_cost_bdt: NumberDecimal('10000'), target_markup_percent: NumberDecimal('20'),
  calculated_base_bdt: NumberDecimal('12000'), ...timestamps });
```

Example has no prescription: the absence of a prescription document must not block acceptance or dispatch. Quoted goods are BDT 12,000 / 120 = USD 100; freight makes the total USD 120. Production issuance must create corresponding audit/outbox records transactionally.

## 9. Mongoose Schema

Production-grade Mongoose models below implement UUID identity, embedded lines, conditional fields, decimal-independent quantity validation, Decimal128 money fields, and indexes across all core business domains (Catalog, Inquiries, Customers, Quotations, Costs, and Prescriptions). These schemas enforce application-level invariants alongside Section 5's database-level `` validators.

`javascript
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const { Schema } = mongoose;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (required = true) => ({ type: String, required, match: uuidPattern });
const moneyField = { type: Schema.Types.Decimal128, required: true };
const opts = { strict: 'throw', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } };

// ============================================================================
// 1. PRODUCT & CATALOG SCHEMAS
// ============================================================================
const ProductTranslation = new Schema({
  brand_name: { type: String, required: true, trim: true, maxlength: 200 },
  slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
  description: { type: String, maxlength: 5000 },
  indication_summary: { type: String, maxlength: 2000 },
  usage_notes: { type: String, maxlength: 2000 },
  storage_condition: { type: String, maxlength: 500 },
  seo_title: { type: String, maxlength: 200 },
  meta_description: { type: String, maxlength: 500 },
  image_alt_text: { type: String, maxlength: 200 }
}, { _id: false });

const Product = new Schema({
  _id: { ...uuid(), default: randomUUID },
  sku: { type: String, required: true, uppercase: true, trim: true },
  manufacturer_id: { ...uuid(), ref: 'Manufacturer' },
  generic_id: { ...uuid(), ref: 'Generic' },
  category_ids: { type: [String], required: true, validate: v => v.length >= 1 },
  translations: {
    en: { type: ProductTranslation, required: true },
    zhCN: { type: ProductTranslation, required: false }
  },
  strength: { type: String, required: true, maxlength: 100 },
  dosage_form: { type: String, required: true, maxlength: 100 },
  pack_size: { type: String, required: true, maxlength: 100 },
  packaging_unit: { type: String, required: true, maxlength: 40 },
  cold_chain_required: { type: Boolean, required: true, default: false },
  storage_condition: { type: String, maxlength: 200 },
  image_keys: { type: [String], default: [] },
  status: { type: String, required: true, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT' }
}, opts);

Product.index({ sku: 1 }, { unique: true });
Product.index({ 'translations.en.slug': 1 }, { unique: true, sparse: true });
Product.index({ 'translations.zhCN.slug': 1 }, { unique: true, sparse: true });
Product.index({ status: 1, manufacturer_id: 1 });
Product.index({ status: 1, generic_id: 1 });
Product.index({ status: 1, category_ids: 1 });
export const ProductModel = mongoose.model('Product', Product, 'products');

// ============================================================================
// 2. CUSTOMER SCHEMA
// ============================================================================
const Customer = new Schema({
  _id: { ...uuid(), default: randomUUID },
  full_name: { type: String, required: true, trim: true, maxlength: 200 },
  customer_type: { type: String, required: true, enum: ['B2B_WHOLESALE', 'B2C_PATIENT'] },
  company_name: { type: String, trim: true, maxlength: 200 },
  email: { type: String, trim: true, lowercase: true, maxlength: 200 },
  whatsapp_number: { type: String, trim: true, maxlength: 50 },
  wechat_id: { type: String, trim: true, maxlength: 100 },
  country: { type: String, required: true, match: /^[A-Z]{2}$/ },
  city: { type: String, trim: true, maxlength: 100 },
  preferred_locale: { type: String, required: true, enum: ['en', 'zh-CN'], default: 'en' }
}, opts);

Customer.pre('validate', function () {
  if (!this.email && !this.whatsapp_number && !this.wechat_id) {
    this.invalidate('email', 'At least one contact channel (email, WhatsApp, WeChat) is required');
  }
  if (this.customer_type === 'B2B_WHOLESALE' && !this.company_name) {
    this.invalidate('company_name', 'Company name is mandatory for B2B wholesale buyers');
  }
});

Customer.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
Customer.index({ whatsapp_number: 1 });
Customer.index({ wechat_id: 1 }, { partialFilterExpression: { wechat_id: { $type: 'string' } } });
export const CustomerModel = mongoose.model('Customer', Customer, 'customers');

// ============================================================================
// 3. RFQ & INQUIRY SCHEMA
// ============================================================================
const RfqItem = new Schema({
  _id: { ...uuid(), default: randomUUID },
  product_id: { ...uuid(false), ref: 'Product' },
  is_uncatalogued: { type: Boolean, required: true },
  custom_medicine_name: { type: String, trim: true, maxlength: 200 },
  custom_strength: { type: String, maxlength: 100 },
  product_snapshot: { brand_name: String, pack_size: String },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  packaging_unit: { type: String, required: true, maxlength: 40 },
  item_availability_status: { type: String, required: true,
    enum: ['AVAILABLE', 'UNAVAILABLE', 'SOURCING'], default: 'SOURCING' },
  customer_facing_note: { type: String, maxlength: 2000 },
  internal_note: { type: String, maxlength: 2000, select: false },
  line_notes: { type: String, maxlength: 2000 }
}, { strict: 'throw' });

RfqItem.pre('validate', function () {
  if (this.is_uncatalogued && !this.custom_medicine_name) {
    this.invalidate('custom_medicine_name', 'Custom medicine name is required for uncatalogued items');
  }
  if (!this.is_uncatalogued && !this.product_id) {
    this.invalidate('product_id', 'Catalogued item requires a valid product_id');
  }
});

const ContactSnapshot = new Schema({
  full_name: { type: String, required: true, maxlength: 200 },
  customer_type: { type: String, required: true, enum: ['B2B_WHOLESALE', 'B2C_PATIENT'] },
  company_name: String,
  email: String,
  whatsapp_number: String,
  wechat_id: String,
  preferred_locale: { type: String, enum: ['en', 'zh-CN'], required: true }
}, { _id: false, strict: 'throw' });

const Rfq = new Schema({
  _id: { ...uuid(), default: randomUUID },
  rfq_number: { type: String, required: true },
  customer_id: { ...uuid(), ref: 'Customer' },
  inquiry_type: { type: String, required: true, enum: ['QUICK_QUOTE', 'CART_RFQ'] },
  contact_snapshot: { type: ContactSnapshot, required: true, immutable: true },
  destination_country: { type: String, required: true, match: /^[A-Z]{2}$/ },
  destination_city_port: { type: String, maxlength: 200 },
  preferred_currency: { type: String, required: true, enum: ['USD', 'CNY', 'EUR', 'BDT'] },
  status: { type: String, required: true, default: 'SUBMITTED',
    enum: ['SUBMITTED', 'UNDER_REVIEW', 'NEED_CLARIFICATION', 'QUOTED', 'CONVERTED', 'CLOSED', 'CANCELLED'] },
  has_prescription: { type: Boolean, required: true, default: false },
  close_reason: String,
  closed_at: Date,
  terminal_at: Date,
  items: { type: [RfqItem], required: true, validate: v => v.length >= 1 && v.length <= 100 }
}, opts);

Rfq.index({ rfq_number: 1 }, { unique: true });
Rfq.index({ customer_id: 1, created_at: -1 });
Rfq.index({ status: 1, created_at: -1 });
export const RfqModel = mongoose.model('Rfq', Rfq, 'rfqs');

// ============================================================================
// 4. QUOTATION & VERSION SCHEMAS
// ============================================================================
const Quotation = new Schema({
  _id: { ...uuid(), default: randomUUID },
  quotation_number: { type: String, required: true },
  rfq_id: { ...uuid(), ref: 'Rfq' },
  customer_id: { ...uuid(), ref: 'Customer' },
  current_version: { type: Number, required: true, default: 1 },
  current_version_id: { ...uuid(), ref: 'QuotationVersion' },
  overall_status: { type: String, required: true, enum: ['ACTIVE', 'COMPLETED', 'DECLINED', 'EXPIRED'], default: 'ACTIVE' }
}, opts);

Quotation.index({ quotation_number: 1 }, { unique: true });
Quotation.index({ customer_id: 1 });
Quotation.index({ rfq_id: 1 }, { unique: true, partialFilterExpression: { overall_status: 'ACTIVE' } });
export const QuotationModel = mongoose.model('Quotation', Quotation, 'quotations');

const QuoteItem = new Schema({
  _id: { ...uuid(), default: randomUUID },
  rfq_item_id: { ...uuid() },
  product_id: { ...uuid(false), ref: 'Product' },
  manufacturer_id: { ...uuid(), ref: 'Manufacturer' },
  brand_name_snapshot: { type: String, required: true },
  generic_name_snapshot: { type: String, required: true },
  strength_snapshot: { type: String, required: true },
  dosage_form_snapshot: { type: String, required: true },
  pack_size_snapshot: { type: String, required: true },
  packaging_unit: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  availability_status: { type: String, required: true, enum: ['AVAILABLE', 'UNAVAILABLE', 'SOURCING'] },
  customer_facing_note: { type: String, maxlength: 2000 },
  unit_quoted_price: { type: Schema.Types.Decimal128 },
  total_line_price: { type: Schema.Types.Decimal128 }
}, { strict: 'throw' });

const QuotationVersion = new Schema({
  _id: { ...uuid(), default: randomUUID },
  quotation_id: { ...uuid(), ref: 'Quotation' },
  version_number: { type: Number, required: true, min: 1 },
  status: { type: String, required: true, default: 'DRAFT',
    enum: ['DRAFT', 'SENT', 'ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED', 'DECLINED', 'VALIDITY_EXPIRED', 'SUPERSEDED', 'PAYMENT_EXPIRED'] },
  contact_snapshot: { type: ContactSnapshot, required: true, immutable: true },
  items: { type: [QuoteItem], required: true, validate: v => v.length >= 1 && v.length <= 100 },
  billing_currency: { type: String, required: true, enum: ['USD', 'CNY', 'EUR', 'BDT'] },
  subtotal_amount: moneyField,
  freight_cost: moneyField,
  insurance_cost: moneyField,
  total_amount: moneyField,
  shipping_terms: {
    method: { type: String, required: true, enum: ['INCOTERM', 'EXPRESS_COURIER'] },
    incoterm: { type: String, enum: ['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF'] },
    named_place: { type: String, required: true },
    cold_chain_required: { type: Boolean, required: true, default: false },
    temperature_range: String
  },
  payment_terms: { type: String, required: true, default: 'BANK_WIRE_TT' },
  bank_details_snapshot: { type: Schema.Types.Mixed },
  fx_snapshot: {
    mode: { type: String, enum: ['LIVE', 'MANUAL_FIXED'] },
    captured_at: Date,
    rates_to_bdt: {
      USD: Schema.Types.Decimal128,
      CNY: Schema.Types.Decimal128,
      EUR: Schema.Types.Decimal128
    }
  },
  issued_at: Date,
  valid_until: Date,
  magic_link_token_hash: { type: String, length: 64 },
  accepted_at: Date,
  acceptance_evidence: {
    accepted_at: Date,
    client_ip: String,
    user_agent: String,
    terms_accepted: Boolean
  },
  reservation_expires_at: Date,
  reservation_status: { type: String, required: true, enum: ['NONE', 'ACTIVE', 'CONSUMED', 'RELEASED'], default: 'NONE' },
  payment: {
    reference: String,
    amount: Schema.Types.Decimal128,
    currency: String,
    received_at: Date,
    recorded_by: { ...uuid(false) }
  },
  shipment: {
    courier_name: String,
    awb_number: String,
    dispatched_at: Date,
    estimated_delivery: Date
  },
  delivered_at: Date,
  decline_reason: { type: String, enum: ['PRICE', 'LEAD_TIME', 'SPECIFICATION', 'OTHER'] },
  decline_notes: String,
  revision_request: { type: Schema.Types.Mixed },
  pdf: { type: Schema.Types.Mixed }
}, opts);

QuotationVersion.index({ quotation_id: 1, version_number: 1 }, { unique: true });
QuotationVersion.index({ magic_link_token_hash: 1 }, { unique: true, sparse: true });
QuotationVersion.index({ status: 1, valid_until: 1 });
QuotationVersion.index({ status: 1, reservation_expires_at: 1 });
QuotationVersion.index({ status: 1, accepted_at: 1 });
export const QuotationVersionModel = mongoose.model('QuotationVersion', QuotationVersion, 'quotation_versions');

// ============================================================================
// 5. INTERNAL COST SCHEMA (ISOLATED)
// ============================================================================
const InternalCostItem = new Schema({
  rfq_item_id: { ...uuid() },
  manufacturer_id: { ...uuid(), ref: 'Manufacturer' },
  procurement_unit_cost_bdt: moneyField,
  quantity: { type: Number, required: true, min: 1 },
  markup_percent: moneyField
}, { _id: false });

const QuotationInternalCost = new Schema({
  _id: { ...uuid(), default: randomUUID },
  quotation_version_id: { ...uuid(), ref: 'QuotationVersion' },
  items: { type: [InternalCostItem], required: true },
  procurement_cost_bdt: moneyField,
  target_markup_percent: moneyField,
  calculated_base_bdt: moneyField,
  effective_gross_margin_percent: { type: Schema.Types.Decimal128 },
  internal_procurement_notes: String
}, opts);

QuotationInternalCost.index({ quotation_version_id: 1 }, { unique: true });
export const QuotationInternalCostModel = mongoose.model('QuotationInternalCost', QuotationInternalCost, 'quotation_internal_costs');

// ============================================================================
// 6. PRESCRIPTION METADATA SCHEMA
// ============================================================================
const Prescription = new Schema({
  _id: { ...uuid(), default: randomUUID },
  rfq_id: { ...uuid(), ref: 'Rfq' },
  customer_id: { ...uuid(), ref: 'Customer' },
  object_key: String,
  mime_type: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'application/pdf'] },
  file_size_bytes: { type: Number, required: true, max: 5242880 },
  encryption: {
    algorithm: { type: String, default: 'aes-256-gcm' },
    key_id: String,
    iv: String,
    auth_tag: String
  },
  uploaded_at: { type: Date, required: true, default: Date.now },
  purge_scheduled_at: { type: Date, required: true },
  purge_status: { type: String, required: true, enum: ['PENDING', 'DELETING', 'PURGED'], default: 'PENDING' },
  purged_at: Date,
  retry_count: { type: Number, default: 0 },
  next_retry_at: Date
}, opts);

Prescription.index({ rfq_id: 1 });
Prescription.index({ purge_status: 1, purge_scheduled_at: 1 });
Prescription.index({ purge_status: 1, next_retry_at: 1 });
export const PrescriptionModel = mongoose.model('Prescription', Prescription, 'prescriptions');
`

Use explicit collection names in every model. `unique` defines an index, not a Mongoose validator. Handle duplicate-key errors in customer upsert, versioning and idempotency flows. Use `runValidators:true` for query updates, but do not rely on document hooks for transition or cross-field checks on `findOneAndUpdate`. `select:false` is defense in depth; public DTO allowlists and separate cost queries provide the security boundary. Disable automatic production index building.

## 10. ERD

Physical references are UUID strings. Embedded entities below are subdocuments, not additional collections. Supporting configuration/outbox records use polymorphic entity references where indicated.

`mermaid
erDiagram
    MANUFACTURERS ||--o{ PRODUCTS : manufactures
    GENERICS ||--o{ PRODUCTS : identifies
    CATEGORIES }o--o{ PRODUCTS : classifies
    CUSTOMERS ||--o{ RFQS : submits
    RFQS ||--|{ RFQ_ITEMS_EMBEDDED : contains
    PRODUCTS o|--o{ RFQ_ITEMS_EMBEDDED : optional_reference
    RFQS ||--o{ PRESCRIPTIONS : optionally_attaches
    CUSTOMERS ||--o{ PRESCRIPTIONS : owns
    RFQS ||--o{ CLARIFICATION_MESSAGES : discusses
    CUSTOMERS ||--o{ CLARIFICATION_MESSAGES : participates
    RFQS ||--o{ QUOTATIONS : generates
    CUSTOMERS ||--o{ QUOTATIONS : receives
    RFQS ||--o{ RFQ_IDEMPOTENCY_KEYS : deduplicates
    QUOTATIONS ||--|{ QUOTATION_VERSIONS : versions
    QUOTATION_VERSIONS ||--|{ QUOTE_ITEMS_EMBEDDED : snapshots
    QUOTATION_VERSIONS ||--o| QUOTATION_INTERNAL_COSTS : isolates
    MANUFACTURERS ||--o{ QUOTE_ITEMS_EMBEDDED : attributed_to
    ADMINS ||--o{ ADMIN_SESSIONS : authenticates
    ADMINS o|--o{ AUDIT_LOGS : acts
    ADMINS ||--o{ PLATFORM_SETTINGS : configures

    CUSTOMERS {
        string _id PK
        string full_name
        string customer_type "B2B_WHOLESALE | B2C_PATIENT"
        string company_name
        string email UK "Partial unique"
        string whatsapp_number
        string wechat_id "Partial index"
        string country
        string city
        string preferred_locale
    }
    PRODUCTS {
        string _id PK
        string sku UK
        string manufacturer_id FK
        string generic_id FK
        array category_ids FK
        object translations
        string strength
        string dosage_form
        string pack_size
        string packaging_unit
        boolean cold_chain_required
        string storage_condition
        string status "DRAFT | PUBLISHED | ARCHIVED"
    }
    MANUFACTURERS {
        string _id PK
        object translations
        string country
        array certifications
        boolean is_active
    }
    GENERICS {
        string _id PK
        object translations
        array therapeutic_indications
        boolean is_active
    }
    CATEGORIES {
        string _id PK
        object translations
        int sort_order
        boolean is_active
    }
    RFQS {
        string _id PK
        string customer_id FK
        string rfq_number UK
        string inquiry_type "QUICK_QUOTE | CART_RFQ"
        object contact_snapshot
        string destination_country
        string preferred_currency "USD | CNY | EUR | BDT"
        string status "SUBMITTED | UNDER_REVIEW | NEED_CLARIFICATION | QUOTED | CONVERTED | CLOSED | CANCELLED"
        boolean has_prescription
        array items
    }
    PRESCRIPTIONS {
        string _id PK
        string rfq_id FK
        string customer_id FK
        string object_key
        string mime_type
        int file_size_bytes
        object encryption
        date uploaded_at
        date purge_scheduled_at
        string purge_status "PENDING | DELETING | PURGED"
    }
    CLARIFICATION_MESSAGES {
        string _id PK
        string rfq_id FK
        string customer_id FK
        string thread_id
        string direction "ADMIN_TO_BUYER | BUYER_TO_ADMIN | INTERNAL_NOTE"
        string channel "EMAIL | WHATSAPP | WECHAT | ADMIN"
        string body
        string status "PENDING_BUYER | REPLIED | RESOLVED"
    }
    QUOTATIONS {
        string _id PK
        string rfq_id FK
        string customer_id FK
        string quotation_number UK
        string current_version_id FK
        int current_version
        string overall_status "ACTIVE | COMPLETED | DECLINED | EXPIRED"
    }
    QUOTATION_VERSIONS {
        string _id PK
        string quotation_id FK
        int version_number
        string status "DRAFT | SENT | ACCEPTED | PAYMENT_RECEIVED | DISPATCHED | DELIVERED | DECLINED | VALIDITY_EXPIRED | SUPERSEDED | PAYMENT_EXPIRED"
        string magic_link_token_hash UK
        string billing_currency
        decimal subtotal_amount
        decimal freight_cost
        decimal insurance_cost
        decimal total_amount
        object shipping_terms
        string payment_terms
        object bank_details_snapshot
        object fx_snapshot
        date valid_until
        date accepted_at
        object acceptance_evidence
        date reservation_expires_at
        string reservation_status "NONE | ACTIVE | CONSUMED | RELEASED"
        object payment
        object shipment
        array items
    }
    QUOTATION_INTERNAL_COSTS {
        string _id PK
        string quotation_version_id FK UK
        array items
        decimal procurement_cost_bdt
        decimal target_markup_percent
        decimal calculated_base_bdt
        decimal effective_gross_margin_percent
    }
    EXCHANGE_RATES {
        string _id PK "ISO currency: USD | CNY | EUR"
        decimal live_rate_to_bdt
        date live_fetched_at
        decimal manual_rate_to_bdt
        string mode "LIVE | MANUAL_FIXED"
    }
    AUDIT_LOGS {
        string _id PK
        string actor_type "SUPER_ADMIN | BUYER | SYSTEM"
        string actor_id FK
        string action_type
        string entity_type
        string entity_id FK
        string old_status
        string new_status
        object safe_changes
        string ip_address
        string user_agent
        date created_at
    }
    NOTIFICATION_LOGS {
        string _id PK
        string dedupe_key UK
        string entity_type
        string entity_id FK
        string kind "EMAIL | PDF_RENDER | ADMIN_EVENT"
        string recipient
        string status "PENDING | PROCESSING | SENT | DELIVERED | FAILED | BOUNCED | DEAD"
        int attempt_count
        date next_retry_at
    }
    ADMINS {
        string _id PK
        string singleton_key UK
        string email UK
        string password_hash
        string totp_secret_encrypted
        array backup_code_hashes
        boolean is_active
        int session_generation
    }
    ADMIN_SESSIONS {
        string _id PK
        string admin_id FK
        string token_hash UK
        int session_generation
        date last_seen_at
        date expires_at
        date revoked_at
    }
    AUTH_ATTEMPTS {
        string _id PK
        string scope_key UK
        int failed_count
        date window_started_at
        date locked_until
        date expires_at
    }
    CMS_BANNERS {
        string _id PK
        object translations
        boolean is_active
        int sort_order
    }
    URL_REDIRECTS {
        string _id PK
        string source_path UK
        string target_path
        int http_status_code
    }
    PLATFORM_SETTINGS {
        string _id PK
        string key UK
        object value
        string updated_by FK
    }
`

An internal cost record is optional while drafting and mandatory before SENT. Exchange rates are copied into snapshots rather than linked for dynamic recalculation. Audit/outbox `entity_id` points to the entity identified by `entity_type`, enforced by services.

## 11. Business relevance and source reconciliation

| Topic | Applies? | MedAxis Global Pharma use |
|---|---|---|
| Collection List / Schema / Relationship | Yes | Catalog, inquiries, customers and versioned commercial records |
| Index / Validation | Yes | Search, queue performance, uniqueness and business integrity |
| Aggregation | Yes | RFQ workload, customer history and currency-specific payment reports |
| Transaction | Yes | Acceptance, deduplication, revision and fulfillment races |
| Sample Data / Mongoose Schema / ERD | Yes | Implementation guidance, reproducible examples and relationship review |

Business exclusions: supplier/broker/vendor entities contradict direct manufacturer sourcing; buyer passwords/OTP contradict passwordless acceptance; automated WhatsApp/WeChat notification delivery is outside Release 1; payment gateways, full order management, warehouse inventory and automated courier tracking belong outside this MVP. Offline bank payment and admin-entered AWB milestones remain in scope. Packaging units/currencies can be validated presets in settings rather than separate collections until their management needs grow.

| Source inconsistency | Decision used in this document |
|---|---|
| DFD says 13 stores; architecture lists a different number of collections | Logical stores are grouped; map them explicitly to 21 physical collections. |
| RFQ_ITEM/QUOTATION_ITEM presented as separate entities | Embed bounded lines; preserve stable child UUIDs and full issued snapshots. |
| UUID identifiers versus typical Mongoose ObjectId defaults | Preserve source UUIDs consistently; do not mix reference types. |
| `Sent`, `Paid`, `Payment_Received`, mixed casing | Normalize enums to uppercase; PAYMENT_RECEIVED is canonical. |
| `validity_date` / `payment_deadline` / `reservation_expires_at` | Use precise `valid_until` and `reservation_expires_at` UTC timestamps. |
| PRD medical retention table says 90 days after delivery/cold archive; enhanced rule says upload+90 or terminal+14 | Use enhanced earliest-deadline permanent purge. No medical cold archive. |
| DFD purge prose refers only to delivered and ambiguous age comparison | Apply all specified terminal states and explicit computed deadlines. |
| Audit and notification records both described as immutable | Audit is append-only; outbox status/retries must be mutable. |
| DFD TTL “exactly 24 hours” | Enforce expiry in application; TTL deletion is eventual. |
| DFD client payload contains password hash/token hash/acceptance timestamp | Client sends password/token/decision; server hashes and timestamps. |
| Supplier-free sourcing versus “release stock to inventory” | Track logical reservation; do not invent a warehouse stock system. |
| Incoterm lists differ; Express Courier appears alongside Incoterms | Store shipping method separately from explicit term and named place. |
| BD-004 / BD-005 both label fixed FX | Implement the same locked per-version rate requirement without depending on inconsistent labels. |
| DFD auth processes omit persistent stores | Add explicit admin, session and lockout collections. |
| DFD claims all balancing checks passed | Treat diagrams as input, not evidence of implemented correctness. DFD itself remains unchanged. |

Before production, business review should settle the proposed item limits, 5 MiB interpretation, lockout duration, dispatch policy for late payment evidence, and retention duration for ordinary commercial/customer/clarification records. Source documents call many commercial records permanent; this design preserves that baseline without inventing a legal retention period. Database/S3 backups must follow the medical purge policy too: track deletion receipts, restrict expired data in restored backups and replay purges before restored systems serve traffic.

Implementation verification checklist: concurrent duplicate RFQ creates one result; altered payload/key conflicts; concurrent acceptance creates one reservation/outbox set; revision and acceptance cannot both win; expiry cannot overwrite payment; later FX/product edits leave issued snapshots unchanged; public APIs/PDFs exclude costs; optional prescription never blocks fulfillment; terminal states shorten purge deadlines; S3 failures retry; revoked/expired sessions fail before TTL cleanup; outbox workers recover abandoned leases.
