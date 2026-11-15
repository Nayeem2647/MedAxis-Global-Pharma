# MedAxis Global Pharma — Database Schema

Source: [Database.md](Database.md). Section numbering is preserved for cross-references.

## 2. Schema

### 2.1 Common conventions

- Preserve the DFD/PRD UUID decision: `_id` and references are UUID v4 strings, not ObjectIds. Store dates as UTC BSON Date, expose ISO 8601 strings.
- Use `snake_case`. Mutable documents have `created_at`, `updated_at`; append-only documents have `created_at`. Omit optional fields rather than inserting empty strings/null.
- Money, FX and percentages use BSON Decimal128. API values are decimal strings; calculations use decimal arithmetic. Round final currency amounts to two decimal places with one documented rounding policy, and retain FX precision. Never calculate commercial totals with JavaScript binary floating point.
- `translations` has `en` and optional `zhCN` objects. API locale `zh-CN` maps to `zhCN`. Translation fields: `name` (product: `brand_name`), `slug`, `description`, `seo_title`, `meta_description`; products also include indication, usage, storage and image-alt text.
- References are application-enforced; MongoDB does not provide SQL foreign keys or automatic row-level security. Archive referenced master records instead of deleting them.
- Proposed guardrails: 100 items per RFQ/version, bounded notes/text fields, and bounded image arrays. These limits require product review if business volumes exceed them; never approach MongoDB's document size limit.

Notation below: `!` required; `?` optional; `UUID` string reference; `Decimal` Decimal128; `Date` BSON Date. Every collection has `_id`.

### 2.2 Catalog and customer documents

| Collection | Fields |
|---|---|
| manufacturers | `translations!`, `country!`, `certifications:[string]`, `is_active:boolean!` |
| generics | `translations!`, `therapeutic_indications:[string]`, `is_active:boolean!` |
| categories | `translations!`, `sort_order:int!`, `is_active:boolean!` |
| products | `sku:string!`, `manufacturer_id:UUID!`, `generic_id:UUID!`, `category_ids:[UUID]!`, `translations!`, `strength:string!`, `dosage_form:string!`, `pack_size:string!`, `packaging_unit:string!`, `cold_chain_required:boolean!`, `storage_condition:string?`, `image_keys:[string]`, `status:DRAFT/PUBLISHED/ARCHIVED!` |
| customers | `full_name:string!`, `customer_type:B2B_WHOLESALE/B2C_PATIENT!`, `company_name?`, `email?`, `whatsapp_number?`, `wechat_id?`, `country!`, `city?`, `preferred_locale:en/zh-CN!` |

Products intentionally contain no procurement price. If an indicative catalog cost is later required, store it in an admin-only collection rather than adding it to public product documents. Product/manufacturer descriptions are sanitized before rendering.

### 2.3 RFQ and medical documents

| Collection | Fields |
|---|---|
| rfqs | `rfq_number:string!`, `customer_id:UUID!`, `inquiry_type:QUICK_QUOTE/CART_RFQ!`, `contact_snapshot:object!`, `destination_country!`, `destination_city_port?`, `preferred_currency:USD/CNY/EUR/BDT!`, `status!`, `has_prescription:boolean!`, `close_reason?`, `closed_at:Date?`, `terminal_at:Date?`, `items:[RfqItem]!` |
| rfq_idempotency_keys | `key:string!`, `request_hash:string!`, `rfq_id:UUID!`, `response_snapshot:object!`, `expires_at:Date!`, `created_at:Date!` |
| prescriptions | `rfq_id:UUID!`, `customer_id:UUID!`, `r2_storage_key:string?`, `mime_type!`, `file_size_bytes:int!`, `encryption:{algorithm,key_id,iv,auth_tag}?`, `uploaded_at:Date!`, `purge_scheduled_at:Date!`, `purge_status:PENDING/DELETING/PURGED!`, `purged_at:Date?`, `retry_count:int!`, `next_retry_at:Date?` |

`contact_snapshot` copies name, customer type, company, contact channels and locale at submission; customer profile edits never modify it. Email is optional at intake, but at least one usable contact channel is required. B2B requires company name. A valid recipient email is required before automated quote issuance; China communications use email with manual WeChat contact available.

`RfqItem`: `_id:UUID!`, `product_id:UUID?`, `is_uncatalogued:boolean!`, `product_snapshot:object?`, `custom_medicine_name?`, `custom_strength?`, `quantity:positive integer!`, `packaging_unit!`, `item_availability_status:AVAILABLE/UNAVAILABLE/SOURCING!`, `customer_facing_note?`, `internal_note?`, `line_notes?`. Catalogued lines require a valid product; uncatalogued lines require custom medicine name. Keep internal notes out of buyer output.

RFQ statuses: `SUBMITTED`, `UNDER_REVIEW`, `NEED_CLARIFICATION`, `QUOTED`, `CONVERTED`, `CLOSED`, `CANCELLED`. When a customer accepts an issued quotation version, the parent RFQ transitions to `CONVERTED`. Unable to supply is `CLOSED` plus `close_reason:UNABLE_TO_SUPPLY`; it is not a second competing status.

Prescription upload is optional throughout fulfillment. Allow JPEG/PNG/PDF only, maximum 5 MiB (5,242,880 bytes; explicit implementation interpretation of PRD “5MB”). Verify actual file content, not only the supplied MIME type. Store encryption keys outside MongoDB; metadata holds only key identifiers, nonce and authentication tag. No medical bytes or original file names in logs.

### 2.4 Quotation documents

| Collection | Fields |
|---|---|
| quotations | `quotation_number:string!`, `rfq_id:UUID!`, `customer_id:UUID!`, `current_version:int!`, `current_version_id:UUID!`, `overall_status:ACTIVE/COMPLETED/DECLINED/EXPIRED!` |
| quotation_versions | `quotation_id:UUID!`, `version_number:int!`, `status!`, `contact_snapshot:object!`, `items:[QuoteItem]!`, `billing_currency!`, `subtotal_amount:Decimal!`, `freight_cost:Decimal!`, `insurance_cost:Decimal!`, `total_amount:Decimal!`, `shipping_terms:object!`, `payment_terms:string!`, `bank_details_snapshot:object?`, `fx_snapshot:object?`, `issued_at:Date?`, `valid_until:Date?`, `magic_link_token_hash:string?`, `accepted_at:Date?`, `acceptance_evidence:object?`, `reservation_expires_at:Date?`, `reservation_status:NONE/ACTIVE/CONSUMED/RELEASED!`, `payment:object?`, `shipment:object?`, `delivered_at:Date?`, `decline_reason?`, `decline_notes?`, `revision_request:object?`, `pdf:object?` |
| quotation_internal_costs | `quotation_version_id:UUID!`, `items:[{rfq_item_id,manufacturer_id,procurement_unit_cost_bdt:Decimal,quantity,markup_percent:Decimal}]!`, `procurement_cost_bdt:Decimal!`, `target_markup_percent:Decimal!`, `calculated_base_bdt:Decimal!`, `effective_gross_margin_percent:Decimal?`, `internal_procurement_notes?` |
| exchange_rates | `_id:USD/CNY/EUR! (PK)`, `live_rate_to_bdt:Decimal!`, `live_fetched_at:Date!`, `manual_rate_to_bdt:Decimal?`, `mode:LIVE/MANUAL_FIXED!`, `updated_by:UUID?` |

`QuoteItem`: `_id`, `rfq_item_id`, optional `product_id`, `manufacturer_id`, immutable `brand_name_snapshot`, `generic_name_snapshot`, `strength_snapshot`, `dosage_form_snapshot`, `pack_size_snapshot`, `packaging_unit`, positive integer `quantity`, `availability_status`, optional `customer_facing_note`, `unit_quoted_price:Decimal`, `total_line_price:Decimal`. Price fields are required for AVAILABLE lines; UNAVAILABLE lines have no payable total and remain visible with a note. Do not issue while any line remains SOURCING or no line is AVAILABLE.

`fx_snapshot`: `mode`, `captured_at`, `rates_to_bdt:{USD:Decimal,CNY:Decimal,EUR:Decimal}`. Convention: **1 foreign currency unit = rate_to_bdt BDT**; BDT rate is implicitly 1. Quote foreign price = marked-up BDT price / rate_to_bdt. Never invert silently when ingesting a provider feed. Lock rates, commercial lines, totals, contact and bank snapshots at issuance. FX updates never reprice an issued version.

`shipping_terms`: `method:INCOTERM/EXPRESS_COURIER`, optional `incoterm:FCA/CIP/DAP/CPT/FOB/CIF`, required `named_place`, `cold_chain_required:boolean`, optional `temperature_range`. Express Courier is a shipping method rather than an Incoterm. `payment` contains reference, Decimal amount, currency, received date and recording admin; `shipment` contains courier, AWB, dispatched date and optional estimated delivery. `acceptance_evidence` captures `{ accepted_at: Date, client_ip: string, user_agent: string, terms_accepted: boolean }` directly on the quotation version for permanent non-repudiation and regulatory export compliance.

`pdf` holds object keys/render state for quotation and accepted proforma, never permanent public URLs. Serve through token/admin authorization. Tokens remain readable for historical accepted versions but permit decisions only on the current eligible version.

Version statuses and transitions:

```text
DRAFT -> SENT -> ACCEPTED -> PAYMENT_RECEIVED -> DISPATCHED -> DELIVERED
             -> DECLINED
             -> VALIDITY_EXPIRED
             -> SUPERSEDED (when replacement version is issued)
ACCEPTED -> PAYMENT_EXPIRED (unpaid reservation deadline passed)
```

Revision requests are recorded as feedback; issuing the replacement supersedes the previous SENT version atomically. Accepted or later commercial versions cannot be repriced through ordinary revision. Quote validity defaults to seven days from issuance. Acceptance requires `valid_until > now`; reservation is five calendar days from acceptance using the documented business timezone Asia/Dhaka, then stored in UTC. No OTP. A duplicate acceptance returns the existing success without extending the reservation.

### 2.5 Messaging, security and settings

| Collection | Fields |
|---|---|
| audit_logs | `actor_type:SUPER_ADMIN/BUYER/SYSTEM!`, `actor_id:UUID?`, `action_type!`, `entity_type!`, `entity_id:UUID!`, `old_status?`, `new_status?`, `change_reason?`, `safe_changes:object?`, `request_id?`, `ip_address?`, `user_agent?`, `created_at!` |
| notification_logs | `dedupe_key:string!`, `entity_type!`, `entity_id:UUID!`, `kind:EMAIL/PDF_RENDER/ADMIN_EVENT!`, `recipient?`, `template_id?`, `safe_payload:object!`, `status:PENDING/PROCESSING/SENT/DELIVERED/FAILED/BOUNCED/DEAD!`, `attempt_count:int!`, `next_retry_at:Date!`, `lease_until:Date?`, `provider_message_id?`, `last_error_code?`, `sent_at:Date?` |
| clarification_messages | `rfq_id:UUID!`, `customer_id:UUID!`, `thread_id:UUID!`, `direction:ADMIN_TO_BUYER/BUYER_TO_ADMIN/INTERNAL_NOTE!`, `channel:EMAIL/WHATSAPP/WECHAT/ADMIN!`, `body:string!`, `status:PENDING_BUYER/REPLIED/RESOLVED!`, `provider_event_id?`, `reply_to_id:UUID?`, `actor_id:UUID?` |
| cms_banners | `translations:{en:{title,body},zhCN?:{title,body}}!`, `is_active!`, `sort_order:int!`, `starts_at:Date?`, `ends_at:Date?`, `link_path?` |
| url_redirects | `source_path:string!`, `target_path:string!`, `http_status_code:301!` |
| admins | `singleton_key:SUPER_ADMIN!`, `email!`, `password_hash!`, `totp_secret_encrypted!`, `backup_code_hashes:[string]!`, `is_active!`, `session_generation:int!` |
| admin_sessions | `admin_id:UUID!`, `token_hash:string!`, `session_generation:int!`, `last_seen_at:Date!`, `expires_at:Date!`, `revoked_at:Date?`, `device_label?`, `ip_address?` |
| auth_attempts | `scope_key:string!`, `failed_count:int!`, `window_started_at:Date!`, `locked_until:Date?`, `expires_at:Date!` |
| platform_settings | `key:string!`, `value:object!`, `updated_by:UUID!` |

`kind` extends the notification outbox to durable PDF/SSE work without introducing another queue collection; only EMAIL jobs use email delivery states. Keep long-term payloads free of bearer tokens. If initial email dispatch needs the raw token, hold it only as a short-lived encrypted payload, protect the encryption key separately and erase it after dispatch; manual resend rotates the hash. Neither audit changes nor errors contain credentials, TOTP secrets, tokens or prescriptions.

