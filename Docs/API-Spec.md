# MedAxis Global Pharma — RESTful API Specification
**Document Version:** 1.1  
**Release:** 1 (Core RFQ, Fast-Quote & Passwordless Atomic Fulfillment)  
**Base URL:** https://api.medaxisglobalpharma.com/v1  
**Protocol:** HTTPS (TLS 1.3 only)  
**Content-Type:** application/json (except file uploads and binary streaming)  
**Date:** November 2026  
**Status:** Approved Engineering Baseline  
**Source Documents:** [PRD.md](PRD.md), [Architecture.md](Architecture.md), [DFD.md](DFD.md), [Database.md](Database.md), [Database-Schema.md](Database-Schema.md)

---

## 1. Global Architectural Conventions & Security Standards

### 1.1 Authentication & Authorization Tiers

Every endpoint in this specification is governed by exactly one of three security policies:

| Security Tier | Code | Mechanism | Description |
|---|---|---|---|
| **Public** | PUBLIC | None (Turnstile protected) | Non-authenticated endpoints. Mutations require Cloudflare Turnstile token (cf-turnstile-response). Strict IP rate-limiting applied. |
| **Token Auth** | TOKEN_AUTH | URL Path Token (SHA-256) | Passwordless customer endpoints. Token is a 256-bit CSPRNG hex string in URL path (/v1/public/quotation/*/:token). Hash is verified in MongoDB; referrers are stripped; X-Robots-Tag: noindex, nofollow, noarchive enforced. |
| **Admin Auth** | ADMIN_AUTH | Session Cookie + TOTP 2FA | Super Admin operations. Requires valid, signed, HttpOnly, SameSite=Strict, Secure session cookie (medaxis_admin_session). 30-minute idle expiration, revocable via admin console. |

### 1.2 Global HTTP Headers

#### Standard Request Headers
* Content-Type: application/json (mandatory for POST, PATCH, PUT)
* Accept: application/json
* cf-turnstile-response: <token> (mandatory for public mutations: RFQ submissions and uploads)
* x-idempotency-key: <uuid-v4> (mandatory for RFQ submissions and quotation acceptance)
* cf-ipcountry: <country-code> (forwarded by Cloudflare for geolocation detection)
* cf-connecting-ip: <client-ip> (used for rate-limiting and audit logging)

#### Standard Response Headers
* Content-Type: application/json; charset=utf-8
* Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
* X-Content-Type-Options: nosniff
* X-Frame-Options: DENY
* Content-Security-Policy: default-src 'self'
* Referrer-Policy: no-referrer (strictly emitted on all /v1/public/quotation/* endpoints)
* X-Robots-Tag: noindex, nofollow, noarchive (strictly emitted on all private quotation and PDF views)

### 1.3 Uniform Envelope Shapes

#### Success Envelope (200 OK, 201 Created, 202 Accepted)
`json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-11-13T18:00:00.000Z",
    "request_id": "8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total_items": 142,
      "total_pages": 8,
      "has_next": true,
      "has_prev": false
    }
  }
}
`

#### Error Envelope (MedAxis Global Pharma JSON Error Contract)
`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The submission payload failed validation checks.",
    "status": 422,
    "details": [
      {
        "field": "items.0.quantity",
        "issue": "Quantity must be a positive integer greater than or equal to 1"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-11-13T18:00:00.000Z",
    "request_id": "8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c"
  }
}
`

### 1.4 Global HTTP Status Codes

| Code | Status | Meaning |
|---|---|---|
| 200 | OK | Request succeeded; response payload returned. |
| 201 | Created | New resource created successfully (e.g., RFQ, Quotation Draft). |
| 202 | Accepted | Request accepted for asynchronous processing (e.g., bulk import). |
| 301 | Moved Permanently | Historical slug redirect managed by url_redirects. |
| 400 | Bad Request | Malformed JSON, missing mandatory headers, or invalid UUID formatting. |
| 401 | Unauthorized | Missing or invalid admin session cookie; unverified 2FA. |
| 403 | Forbidden | Expired Magic Link token, invalid Turnstile token, or locked admin account. |
| 404 | Not Found | Resource not found or non-existent slug/token. |
| 409 | Conflict | Concurrency violation (e.g., version conflict, duplicate active quote, idempotency key mismatch). |
| 410 | Gone | Announced API version has been retired; migrate to its supported replacement. |
| 422 | Unprocessable Entity | Semantic validation failure (e.g., missing custom name on uncatalogued item). |
| 429 | Too Many Requests | Rate limit breached (e.g., 5 failed logins, 30 token probes/min). |
| 500 | Internal Server Error | Unhandled server exception (logged with stack trace; sanitized client response). |
| 503 | Service Unavailable | Temporary database, storage, or required upstream dependency outage; retry only under Section 1.6 rules. |

### 1.5 API Version Control & Compatibility

* **Version selection:** The URL path selects the major API version. All endpoints in this document use `/v1`; a future breaking contract uses `/v2`. Query parameters and custom headers cannot override the path version. Unversioned API routes and unsupported versions return `404` with `API_VERSION_NOT_SUPPORTED`; unknown routes inside a supported version return `404` with `ROUTE_NOT_FOUND`. Never silently redirect a mutation to another version.
* **Document versus API version:** Document version `1.1` records specification changes; it does not change the `/v1` API contract. Product Release 1 and quotation business versions are separate from API versions.
* **Compatible changes within `/v1`:** Add optional request fields with defaults preserving existing behavior, optional response fields, or new endpoints. Clients must tolerate unknown response fields. Do not add response enum values unless that field explicitly permits unknown values.
* **Breaking changes:** Removing or renaming fields or routes, adding required inputs, changing types, tightening validation for previously valid requests, changing authentication requirements, or changing status/error-code meanings requires a new major version. Emergency security fixes may override the notice period and must be documented immediately.
* **Migration and retirement:** Run old and new major versions concurrently for at least 90 days after announcing migration guidance. Record affected endpoints, replacement contracts, examples, and the retirement date in the change log. Deprecated responses include a `Link` header with `rel="deprecation"` pointing to published migration guidance and a `Sunset` header containing the announced retirement date as an HTTP date. Retired versions return `410 Gone` with `API_VERSION_RETIRED`; they must not execute mutations.
* **Quotation concurrency:** A quotation's business version identifies its issued revision, not the API version. Acceptance must atomically verify the token's bound quotation version, current active revision, status, and expiry. A superseded version returns `409 QUOTATION_VERSION_CONFLICT`; expiry retains the existing `403` policy. No fulfillment side effect occurs on a failed check.
* **Release control:** Store this specification with application source in Git. Every API contract change must update this file and its change log in the same reviewed change. Before release, verify affected endpoint examples, error mappings, and compatibility with supported clients.

### 1.6 Centralized Error Handling & Recovery

#### Response Contract

All application-generated JSON failures use the error envelope in Section 1.3, including authentication, validation, routing, and unexpected exceptions. This is a custom `application/json` envelope; it is not the standard Problem Details wire format. The HTTP status must equal `error.status`; never return `200` for a failed operation.

* `error.code`: Required stable machine-readable identifier. Clients branch on this value, not message text.
* `error.message`: Required safe, human-readable explanation. Messages may improve without changing the code's meaning.
* `error.details`: Optional array of `{ "field": "items.0.quantity", "issue": "Quantity must be a positive integer." }` entries for validation errors. Omit it when no safe field-level explanation exists; never echo submitted secrets or medical content.
* `meta.timestamp`: Required UTC timestamp in ISO 8601 format.
* `meta.request_id`: Required server-generated correlation ID. Return the same value in `X-Request-ID` on success and failure and include it in internal logs. A retried request receives a new request ID while retaining its idempotency key.

#### Common Error Registry

Endpoint-specific codes already documented elsewhere remain valid and use the same envelope.

| HTTP | Error Code | Trigger / Client Action |
|---|---|---|
| 400 | `MALFORMED_JSON` | Request body cannot be parsed; correct the JSON. |
| 400 | `INVALID_REQUEST` | Required header is absent or an identifier is malformed; correct the request. |
| 400 | `INVALID_PRESCRIPTION_FILE` | Unsupported file content or file over 5 MiB; follows Section 4.3. |
| 401 | `AUTHENTICATION_REQUIRED` | Admin session missing, invalid, expired, or 2FA incomplete; complete authentication. |
| 403 | `ACCESS_DENIED` | Account locked or authenticated operation prohibited; do not automatically retry. |
| 403 | `TURNSTILE_VERIFICATION_FAILED` | Bot verification rejected; obtain a fresh challenge token. |
| 403 | `QUOTATION_TOKEN_EXPIRED` | Quotation link expired; use the supported refresh flow. |
| 404 | `RESOURCE_NOT_FOUND` | Resource or quotation token does not exist; do not reveal token lookup internals. |
| 404 | `API_VERSION_NOT_SUPPORTED` | Missing or unsupported API version; use a documented version. |
| 404 | `ROUTE_NOT_FOUND` | Unknown route under a supported API version; correct the route. |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | Same key reused for a different payload; resolve the original operation before creating a new one. |
| 409 | `QUOTATION_VERSION_CONFLICT` | Quotation revision was superseded; obtain the current quotation. |
| 409 | `RESOURCE_STATE_CONFLICT` | Concurrent update or invalid state transition; reload current state before resubmission. |
| 410 | `API_VERSION_RETIRED` | Announced version has been retired; migrate to the supported replacement. |
| 422 | `VALIDATION_FAILED` | Parsed payload fails semantic validation; correct the indicated fields. |
| 429 | `RATE_LIMIT_EXCEEDED` | Request quota exceeded; wait for `Retry-After`. |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected exception; show a generic failure and retain the request ID. |
| 503 | `SERVICE_UNAVAILABLE` | Required dependency temporarily unavailable; follow bounded retry rules. |

#### Server Handling, Logging & Atomicity

* Use a centralized Express error-handling middleware to map validation, guard, service, and database failures to this contract. Preserve intentional HTTP errors; map unexpected failures to a sanitized `500 INTERNAL_SERVER_ERROR`.
* Log request ID, method, redacted route template, status, error code, duration, and authenticated admin ID where available. Keep exception stacks in restricted server logs only. Redact quotation tokens, session cookies, authorization headers, Turnstile tokens, prescription content, contact details, and internal pricing from error responses and logs.
* Return `Cache-Control: no-store` on error responses. Generate error messages from approved templates; never return database queries, provider responses, encryption material, or stack traces to clients.
* Failed transactional writes must roll back together. A timeout does not prove that a write failed: clients must replay supported operations using the original idempotency key. Scope keys to the operation and authenticated principal where applicable, and bind each key to a payload fingerprint. Matching completed replays return the saved result without duplicate writes; mismatched payloads return `409 IDEMPOTENCY_KEY_CONFLICT`. RFQ keys remain valid for the documented 24-hour window; quotation acceptance records remain valid for the quotation's lifetime to prevent duplicate fulfillment.
* An email delivery failure after a committed RFQ or acceptance must not reverse the committed business result. Persist notification work durably and retry it separately; alert operators after retry exhaustion. For inbound webhooks, acknowledge only after durable processing or enqueueing, and deduplicate provider event IDs before applying side effects.
* Validate authorization and other request guards before exposing resource state. Token lookup failures must never disclose buyer information, stored token hashes, or internal costs.

#### Client Retry & Non-JSON Responses

* On `429`, return `Retry-After` as a positive integer delay in seconds. On `503`, include it when a recovery delay is known. Clients honor that delay; otherwise use exponential backoff with jitter, starting at 1 second and capped at 30 seconds, with at most 3 automatic retries.
* Retry transient network failures and `500`/`503` automatically only for read requests or mutations with documented idempotency support. RFQ submissions and quotation acceptance reuse the original key and payload. Other mutations require reconciliation before manual retry. Do not automatically retry other `4xx` responses.
* PDF and prescription streaming endpoints return the JSON error envelope if failure occurs before response headers are sent. After streaming begins, terminate the stream and log the failure with its request ID; do not append JSON to binary content. SSE failures before connection establishment use the JSON envelope; failures after establishment close the stream, and the client reconnects with backoff.
* Cloudflare or proxy-generated failures may use a different body. Clients must handle non-JSON responses safely using the HTTP status without displaying raw HTML or assuming an envelope exists.

### 1.7 Specification Change Log

| Document Version | Date | Changes |
|---|---|---|
| 1.1 | 2026-11-14 | Added API version control, compatibility and retirement policy, quotation concurrency rules, centralized error registry, safe logging, idempotency recovery, and retry/stream handling. Clarified the existing custom JSON error envelope. |
| 1.0 | November 2026 | Initial Release 1 API engineering baseline. |

---

## 2. Master Endpoint Index

| # | HTTP Method | Endpoint URI | Auth Tier | Module / Purpose |
|---|---|---|---|---|
| **01** | GET | /v1/public/products | PUBLIC | Multilingual catalog listing & faceted search (Zero Prices) |
| **02** | GET | /v1/public/products/:slug | PUBLIC | Localized product detail by slug |
| **03** | GET | /v1/public/generics/:slug | PUBLIC | Generic active ingredient SEO hub |
| **04** | GET | /v1/public/manufacturers/:slug | PUBLIC | Licensed manufacturer profile & portfolio |
| **05** | GET | /v1/public/categories/:slug | PUBLIC | Therapeutic category listing |
| **06** | GET | /v1/public/sitemap-catalog | PUBLIC | Slugs feed for Next.js multilingual sitemap |
| **07** | GET | /v1/public/cms/banners | PUBLIC | Active bilingual announcement banners |
| **08** | POST | /v1/public/rfq/quick-quote | PUBLIC | 10-Second Quick Quote modal submission |
| **09** | POST | /v1/public/rfq/cart | PUBLIC | Multi-item cart RFQ submission |
| **10** | POST | /v1/public/prescriptions/upload | PUBLIC | AES-256 encrypted prescription upload (Max 5MB) |
| **11** | POST | /v1/public/webhooks/email-reply | PUBLIC | Inbound email reply webhook for clarification threading |
| **12** | GET | /v1/public/quotation/token/:token | TOKEN_AUTH | Inspect quotation version (Zero cost leakage) |
| **13** | POST | /v1/public/quotation/accept/:token | TOKEN_AUTH | 1-Click atomic quotation acceptance (BD-001) |
| **14** | POST | /v1/public/quotation/request-revision/:token | TOKEN_AUTH | Submit structured modification request |
| **15** | POST | /v1/public/quotation/request-refresh/:token | TOKEN_AUTH | Request refreshed quote for expired versions |
| **16** | POST | /v1/public/quotation/decline/:token | TOKEN_AUTH | Decline quotation with structured reason |
| **17** | GET | /v1/public/quotation/pdf/:token | TOKEN_AUTH | Stream official watermarked Quotation/Proforma PDF |
| **18** | POST | /v1/admin/auth/login | PUBLIC | Super Admin Step 1: Password authentication (Argon2id) |
| **19** | POST | /v1/admin/auth/verify-totp | PUBLIC | Super Admin Step 2: RFC 6238 TOTP verification |
| **20** | POST | /v1/admin/auth/verify-backup-code | PUBLIC | Break-glass single-use recovery code login |
| **21** | POST | /v1/admin/auth/2fa/enroll | ADMIN_AUTH | Initialize TOTP secret & generate 8 backup codes |
| **22** | GET | /v1/admin/auth/sessions | ADMIN_AUTH | View active sessions, devices and IP origins |
| **23** | POST | /v1/admin/auth/revoke-sessions | ADMIN_AUTH | Remote terminate all other active admin sessions |
| **24** | POST | /v1/admin/auth/logout | ADMIN_AUTH | Invalidate current admin session |
| **25** | GET | /v1/admin/rfqs | ADMIN_AUTH | Central RFQ inquiry queue (filterable & sorted) |
| **26** | GET | /v1/admin/rfqs/:id | ADMIN_AUTH | Detailed RFQ view with contact snapshot & lines |
| **27** | PATCH | /v1/admin/rfqs/:id/items/:itemId | ADMIN_AUTH | Update item availability (AVAILABLE/UNAVAILABLE/SOURCING) |
| **28** | PATCH | /v1/admin/rfqs/:id/status | ADMIN_AUTH | Manual RFQ status override |
| **29** | POST | /v1/admin/rfqs/:id/request-clarification | ADMIN_AUTH | Dispatch structured clarification email to buyer |
| **30** | POST | /v1/admin/rfqs/:id/unable-to-supply | ADMIN_AUTH | Reasoned RFQ closure & MF-09 notification email |
| **31** | POST | /v1/admin/rfqs/:id/notes | ADMIN_AUTH | Append internal sourcing & operational notes |
| **32** | GET | /v1/admin/prescriptions/:id/stream | ADMIN_AUTH | Decrypt and stream customer medical prescription |
| **33** | POST | /v1/admin/quotations/draft | ADMIN_AUTH | Formulate Fast-Quote draft with batch costs & markup |
| **34** | POST | /v1/admin/quotations/:id/send | ADMIN_AUTH | Issue quotation (locks FX snapshot, sends email) |
| **35** | POST | /v1/admin/quotations/:id/revise | ADMIN_AUTH | Create version 2+ (atomically supersedes previous) |
| **36** | POST | /v1/admin/quotations/:id/resend | ADMIN_AUTH | Rotate Magic Link token & re-send email |
| **37** | GET | /v1/admin/quotations/:id | ADMIN_AUTH | View full version history & isolated internal costs |
| **38** | PATCH | /v1/admin/quotations/:id/fulfillment | ADMIN_AUTH | Milestone updates (Paid, Dispatched [AWB], Delivered) |
| **39** | POST | /v1/admin/catalog/products | ADMIN_AUTH | Create new pharmaceutical product SKU |
| **40** | PATCH | /v1/admin/catalog/products/:id | ADMIN_AUTH | Update product SKU, translations, cold-chain |
| **41** | POST | /v1/admin/catalog/import-csv | ADMIN_AUTH | Bulk CSV import with dry-run validation |
| **42** | POST | /v1/admin/catalog/generics | ADMIN_AUTH | Create/update generic active ingredient records |
| **43** | POST | /v1/admin/catalog/manufacturers | ADMIN_AUTH | Create/update licensed manufacturer records |
| **44** | POST | /v1/admin/catalog/categories | ADMIN_AUTH | Create/update therapeutic categories |
| **45** | GET | /v1/admin/fx-rates | ADMIN_AUTH | View live and manual BDT exchange rates |
| **46** | PATCH | /v1/admin/fx-rates | ADMIN_AUTH | Update manual fixed rates & toggle active mode |
| **47** | GET | /v1/admin/customers | ADMIN_AUTH | Customer directory (B2B and B2C profiles) |
| **48** | GET | /v1/admin/customers/:id | ADMIN_AUTH | Customer profile & lifetime inquiry/quote history |
| **49** | GET | /v1/admin/audit-logs | ADMIN_AUTH | Query immutable audit logs |
| **50** | GET | /v1/admin/stream | ADMIN_AUTH | Server-Sent Events (SSE) real-time alert stream |
| **51** | GET | /v1/admin/settings | ADMIN_AUTH | View platform settings (units, bank details) |
| **52** | PATCH | /v1/admin/settings | ADMIN_AUTH | Update platform settings |

---

## 3. Module 1: Public Catalog & SEO Endpoints

These endpoints power the public Next.js store, supporting SSG/ISR, localized routing (/en and /zh-CN), and SEO crawlers. **In strict adherence to PRD.md Section 5.1, zero pricing data is ever exposed in these payloads.**

---

### 3.1 GET /v1/public/products
* **Purpose:** Paginated, faceted product catalog search.
* **Authentication:** PUBLIC (No auth required)
* **Rate Limit:** 120 requests/minute per IP
* **Query Parameters:**
  * page (optional integer, default: 1): Current page number.
  * limit (optional integer, default: 20, max: 100): Items per page.
  * locale (optional string, enum: en, zh-CN, default: en): Content language.
  * q (optional string): Full-text search keyword (searches brand, generic, and indications via Atlas Search).
  * manufacturer (optional string): Filter by manufacturer slug.
  * generic (optional string): Filter by generic active ingredient slug.
  * category (optional string): Filter by therapeutic category slug.
  * dosage_form (optional string): Filter by formulation (e.g., Tablet, Injection, Capsule).
* **Request Headers:**
  * Accept: application/json
* **Request Body:** None

#### Response: 200 OK
`json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": "8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c",
        "sku": "OSIM-80-TAB",
        "brand_name": "Osimert 80mg",
        "slug": "osimert-80mg",
        "generic": {
          "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
          "name": "Osimertinib Mesylate",
          "slug": "osimertinib"
        },
        "manufacturer": {
          "id": "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
          "name": "Beacon Pharmaceuticals PLC",
          "slug": "beacon-pharmaceuticals"
        },
        "categories": [
          {
            "id": "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
            "name": "Oncology / Targeted Therapy",
            "slug": "oncology"
          }
        ],
        "strength": "80 mg",
        "dosage_form": "Film-Coated Tablet",
        "pack_size": "30 Tablets / Box",
        "packaging_unit": "BOX",
        "cold_chain_required": false,
        "storage_condition": "Store below 25°C in a dry place",
        "indication_summary": "First-line treatment of adult patients with metastatic non-small cell lung cancer (NSCLC) with EGFR exon 19 deletions or exon 21 L858R mutations.",
        "primary_image_url": "https://cdn.medaxisglobalpharma.com/products/osimert-80mg-box.webp"
      }
    ],
    "facets": {
      "dosage_forms": [
        { "name": "Tablet", "count": 84 },
        { "name": "Injection", "count": 42 },
        { "name": "Capsule", "count": 16 }
      ],
      "cold_chain": [
        { "required": false, "count": 118 },
        { "required": true, "count": 24 }
      ]
    }
  },
  "meta": {
    "timestamp": "2026-11-13T18:00:00.000Z",
    "request_id": "req-12345",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total_items": 142,
      "total_pages": 8,
      "has_next": true,
      "has_prev": false
    }
  }
}
`

---

### 3.2 GET /v1/public/products/:slug
* **Purpose:** Single product specification for public SSR product display.
* **Authentication:** PUBLIC
* **URL Parameters:**
  * slug (mandatory string): Unique localized product slug (e.g. osimert-80mg or Chinese slug).
* **Query Parameters:**
  * locale (optional string, enum: en, zh-CN): Preferred locale fallback.
* **Request Body:** None

#### Response: 200 OK
`json
{
  "success": true,
  "data": {
    "id": "8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c",
    "sku": "OSIM-80-TAB",
    "brand_name": "Osimert 80mg",
    "slug": "osimert-80mg",
    "translations": {
      "en": {
        "brand_name": "Osimert 80mg",
        "slug": "osimert-80mg",
        "description": "Osimert is a kinase inhibitor indicated for EGFR T790M mutation-positive NSCLC.",
        "indication_summary": "First-line treatment of metastatic EGFR-mutated non-small cell lung cancer.",
        "usage_notes": "Take once daily with or without food. Swallow tablet whole with water.",
        "storage_condition": "Store below 25°C. Keep in original packaging.",
        "seo_title": "Buy Osimert 80mg Tablets (Osimertinib) | Direct Sourcing MedAxis Global Pharma",
        "meta_description": "Source authentic Osimert 80mg by Beacon Pharmaceuticals directly from Bangladesh."
      },
      "zhCN": {
        "brand_name": "奥希替尼 80毫克 (Osimert)",
        "slug": "osimert-80mg-zh",
        "description": "Osimert (奥希替尼) 是一种用于治疗EGFR突变阳性非小细胞肺癌的激酶抑制剂。",
        "indication_summary": "用于EGFR外显子19缺失或L858R突变阳性的转移性非小细胞肺癌成人患者的一线治疗。",
        "usage_notes": "每日一次，空腹或随餐服用。整片吞服，不可咀嚼或碾碎。",
        "storage_condition": "25°C以下避光密封保存。",
        "seo_title": "孟加拉碧康奥希替尼 80mg (Osimert) 现货直邮采购 | MedAxis Global Pharma",
        "meta_description": "MedAxis Global Pharma直供孟加拉Beacon原厂奥希替尼Osimert 80mg，快速报价与专属海外直邮服务。"
      }
    },
    "generic": {
      "id": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "Osimertinib Mesylate",
      "slug": "osimertinib"
    },
    "manufacturer": {
      "id": "2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e",
      "name": "Beacon Pharmaceuticals PLC",
      "slug": "beacon-pharmaceuticals",
      "country": "BD",
      "certifications": ["WHO-GMP", "ISO 9001"]
    },
    "categories": [
      {
        "id": "3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f",
        "name": "Oncology / Targeted Therapy",
        "slug": "oncology"
      }
    ],
    "strength": "80 mg",
    "dosage_form": "Film-Coated Tablet",
    "pack_size": "30 Tablets / Box",
    "packaging_unit": "BOX",
    "cold_chain_required": false,
    "storage_condition": "Store below 25°C in a dry place",
    "image_urls": [
      "https://cdn.medaxisglobalpharma.com/products/osimert-80mg-box-front.webp",
      "https://cdn.medaxisglobalpharma.com/products/osimert-80mg-blister.webp"
    ]
  },
  "meta": {
    "timestamp": "2026-11-13T18:00:00.000Z",
    "request_id": "req-12346"
  }
}
`

#### Error Response: 404 Not Found
`json
{
  "success": false,
  "error": {
    "code": "PRODUCT_NOT_FOUND",
    "message": "The requested product slug does not exist or has been archived.",
    "status": 404
  },
  "meta": {
    "timestamp": "2026-11-13T18:00:00.000Z",
    "request_id": "req-12347"
  }
}
`

---

### 3.3 GET /v1/public/generics/:slug
* **Purpose:** Generic active ingredient SEO hub details with associated commercial products.
* **Authentication:** PUBLIC
* **URL Parameters:** slug (mandatory string).
* **Response 200 OK:** Returns generic profile, therapeutic indications, and active published product listings linked to this generic.

---

### 3.4 GET /v1/public/manufacturers/:slug
* **Purpose:** Certified manufacturer profile and accredited medicine catalog.
* **Authentication:** PUBLIC
* **URL Parameters:** slug (mandatory string).
* **Response 200 OK:** Returns manufacturer legal name, country (BD), GMP certifications, and portfolio of produced medicines.

---

### 3.5 GET /v1/public/categories/:slug
* **Purpose:** Therapeutic classification hub (e.g., Oncology, Hematology, Nephrology).
* **Authentication:** PUBLIC
* **URL Parameters:** slug (mandatory string).
* **Response 200 OK:** Returns category details and associated medicines.

---

### 3.6 GET /v1/public/sitemap-catalog
* **Purpose:** High-performance internal slug feed consumed by Next.js edge route /sitemap.xml.
* **Authentication:** PUBLIC
* **Response 200 OK:** Returns array of all indexable canonical entities (products, generics, manufacturers, categories) with en and zhCN slugs, and updated_at timestamps for XML <lastmod> generation.

---

### 3.7 GET /v1/public/cms/banners
* **Purpose:** Retrieve active announcement banners for website header/homepage.
* **Authentication:** PUBLIC
* **Query Parameters:** locale (optional string, enum: en, zh-CN).
* **Response 200 OK:** Returns array of active banners where current date is between starts_at and ends_at.

---

## 4. Module 2: Public Inquiries, RFQ & Medical Upload Endpoints

These endpoints capture structured demand from B2B wholesale buyers and B2C patients. They feature automated idempotency guardrails, contact snapshotting, and optional encrypted prescription handling.

---

### 4.1 POST /v1/public/rfq/quick-quote
* **Purpose:** Frictionless 10-second inquiry from product detail pages or catalog quick-quote modals.
* **Authentication:** PUBLIC
* **Security & Bot Defense:** Cloudflare Turnstile verification (cf-turnstile-response header).
* **Idempotency Guard:** x-idempotency-key header (UUID v4). Re-submitting the same key within 24 hours returns the existing RFQ without duplication.
* **Rate Limit:** 10 submissions/hour per IP.
* **Request Headers:**
  * Content-Type: application/json
  * cf-turnstile-response: <turnstile-token> (mandatory)
  * x-idempotency-key: <uuid-v4> (mandatory)
  * cf-ipcountry: <2-letter-country> (optional, auto-extracted)

#### Request Body
`json
{
  "full_name": "Dr. Sarah Chen",
  "customer_type": "B2B_WHOLESALE",
  "company_name": "Mount Sinai Oncology Clinic",
  "email": "dr.chen@mountsinai.example",
  "whatsapp_number": "+6591234567",
  "wechat_id": "sarah_chen_md",
  "destination_country": "SG",
  "destination_city_port": "Singapore Port / Changi Airport",
  "preferred_currency": "USD",
  "preferred_locale": "en",
  "product_id": "8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c",
  "is_uncatalogued": false,
  "quantity": 10,
  "packaging_unit": "BOX",
  "customer_notes": "Urgent air cargo inquiry for patient trial.",
  "prescription_id": "d1e2f3a4-b5c6-7d8e-9f0a-1b2c3d4e5f6a"
}
`

#### Response: 201 Created
`json
{
  "success": true,
  "data": {
    "rfq_id": "9a0b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d",
    "rfq_number": "RFQ-2026-11-0042",
    "status": "SUBMITTED",
    "created_at": "2026-11-13T18:15:30.000Z",
    "customer": {
      "id": "c1d2e3f4-a5b6-7c8d-9e0f-1a2b3c4d5e6f",
      "full_name": "Dr. Sarah Chen",
      "email": "dr.chen@mountsinai.example"
    },
    "message": "Inquiry successfully received. Our sourcing team is verifying physical batch availability with Beacon Pharmaceuticals."
  },
  "meta": {
    "timestamp": "2026-11-13T18:15:30.000Z",
    "request_id": "req-98765"
  }
}
`

#### Error Response: 422 Unprocessable Entity
`json
{
  "success": false,
  "error": {
    "code": "CONTACT_CHANNEL_REQUIRED",
    "message": "At least one valid contact channel (email, WhatsApp, or WeChat) is required to receive quotations.",
    "status": 422
  },
  "meta": { "timestamp": "2026-11-13T18:15:30.000Z", "request_id": "req-98766" }
}
`

---

### 4.2 POST /v1/public/rfq/cart
* **Purpose:** Multi-product RFQ submission for commercial buyers, clinics, and multi-medicine treatment plans.
* **Authentication:** PUBLIC
* **Security & Bot Defense:** Turnstile token + Idempotency key.
* **Request Headers:**
  * Content-Type: application/json
  * cf-turnstile-response: <turnstile-token>
  * x-idempotency-key: <uuid-v4>

#### Request Body
`json
{
  "full_name": "Wang Wei",
  "customer_type": "B2C_PATIENT",
  "company_name": null,
  "email": "wangwei@163.example",
  "wechat_id": "wangwei_bj",
  "whatsapp_number": null,
  "destination_country": "CN",
  "destination_city_port": "Beijing",
  "preferred_currency": "CNY",
  "preferred_locale": "zh-CN",
  "items": [
    {
      "product_id": "8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c",
      "is_uncatalogued": false,
      "quantity": 3,
      "packaging_unit": "BOX",
      "line_notes": "Beacon brand preferred"
    },
    {
      "product_id": null,
      "is_uncatalogued": true,
      "custom_medicine_name": "LuciNibs (Cabozantinib 60mg)",
      "custom_strength": "60 mg",
      "quantity": 2,
      "packaging_unit": "BOTTLE",
      "line_notes": "Manufactured by Lucius or Beacon"
    }
  ],
  "prescription_id": null
}
`

#### Response: 201 Created
`json
{
  "success": true,
  "data": {
    "rfq_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "rfq_number": "RFQ-2026-11-0043",
    "status": "SUBMITTED",
    "total_items": 2,
    "created_at": "2026-11-13T18:20:00.000Z",
    "message": "Quotation cart submitted. Fast-Quote engine turnaround SLA: < 2 hours during UTC+6 business hours."
  },
  "meta": { "timestamp": "2026-11-13T18:20:00.000Z", "request_id": "req-98767" }
}
`

---

### 4.3 POST /v1/public/prescriptions/upload
* **Purpose:** Upload optional medical prescription file before or during RFQ submission.
* **Authentication:** PUBLIC
* **Content-Type:** multipart/form-data
* **File Constraints:** Restricted to image/jpeg, image/png, application/pdf. Maximum size: **5,242,880 bytes (5 MiB)**. Magic byte inspection enforced.
* **Encryption Policy:** Stored encrypted at rest via AES-256-GCM in Cloudflare R2 prescriptions bucket. Encryption keys are managed outside MongoDB; only IV, Auth Tag, and Key ID are stored in MongoDB metadata.

#### Form Data Fields:
* prescription (binary file): The document buffer.
* turnstile_token (string): Cloudflare bot verification token.

#### Response: 201 Created
`json
{
  "success": true,
  "data": {
    "prescription_id": "d1e2f3a4-b5c6-7d8e-9f0a-1b2c3d4e5f6a",
    "mime_type": "application/pdf",
    "file_size_bytes": 1420850,
    "uploaded_at": "2026-11-13T18:14:00.000Z",
    "message": "Prescription uploaded and encrypted securely. Attach this prescription_id to your RFQ submission."
  },
  "meta": { "timestamp": "2026-11-13T18:14:00.000Z", "request_id": "req-98768" }
}
`

#### Error Response: 400 Bad Request (Invalid file format or size exceeded)
`json
{
  "success": false,
  "error": {
    "code": "INVALID_PRESCRIPTION_FILE",
    "message": "File exceeds 5MB limit or is not a permitted format (JPEG, PNG, PDF only).",
    "status": 400
  },
  "meta": { "timestamp": "2026-11-13T18:14:00.000Z", "request_id": "req-98769" }
}
`

---

### 4.4 POST /v1/public/webhooks/email-reply
* **Purpose:** Webhook endpoint for transactional email providers (Resend / Brevo) to ingest buyer replies to clarification prompt emails.
* **Authentication:** PUBLIC with HMAC-SHA256 signature verification (x-webhook-signature header).
* **Business Logic:** Parses inbound email thread, matches RFQ reference, appends message to clarification_messages collection, and automatically transitions RFQ status from NEED_CLARIFICATION to UNDER_REVIEW.
* **Response 200 OK:** { "success": true, "message": "Inbound reply threaded successfully." }

## 5. Release 1 admin extensions — Step 8

These routes are implemented behind the existing ADMIN_AUTH and same-origin boundaries. All use the normal validated JSON envelope, private/no-store responses and the existing pagination metadata. No frontend database access is introduced.

| ID | Method | Path | Contract |
|---|---|---|---|
| **53** | POST | /v1/admin/catalog/images | Authenticated multipart image upload; JPEG/PNG/WebP up to 5 MiB. |
| **54** | GET | /v1/admin/catalog/products | Array of allowlisted product records, including DRAFT/ARCHIVED; page,limit,q,status,manufacturer_id,generic_id,category_id. |
| **55** | GET | /v1/admin/catalog/products/:id | Same product DTO; UUID; no query keys. |
| **56** | GET | /v1/admin/catalog/manufacturers | Paginated master records; page,limit,q,is_active=true\|false. |
| **57** | GET | /v1/admin/catalog/manufacturers/:id | Manufacturer DTO; includes actual country/certifications. |
| **58** | GET | /v1/admin/catalog/generics | Paginated master records; page,limit,q,is_active=true\|false. |
| **59** | GET | /v1/admin/catalog/generics/:id | Generic DTO; actual therapeutic_indications. |
| **60** | GET | /v1/admin/catalog/categories | Paginated master records; page,limit,q,is_active=true\|false. |
| **61** | GET | /v1/admin/catalog/categories/:id | Category DTO; actual sort_order. |
| **62** | GET | /v1/admin/cms/banners | Paginated active/inactive/scheduled records; page,limit,q,is_active. |
| **63** | GET | /v1/admin/cms/banners/:id | Bilingual banner DTO including scheduling/link_path; no query keys. |
| **64** | GET | /v1/admin/quotations | Paginated current-version summaries; page,limit,q (business reference),rfq_id,overall_status,status,reservation_before (ISO timestamp). No contact/cost/token fields. |
| **65** | GET | /v1/admin/quotations/summary | Global authoritative active_quotations,accepted_payment_pending,ready_to_dispatch,expiring_allocations; as_of and window_hours (1–168; default 24). Counts join only each active parent's current version. Pending/expiring require an ACTIVE unexpired ACCEPTED reservation; dispatch-ready requires PAYMENT_RECEIVED, payment data and CONSUMED reservation. |
| **66** | PATCH | /v1/admin/quotations/:id/draft | Full registered pricing body plus required expected_current_version_id and expected_updated_at. Only an unlocked current DRAFT may change. Preserves version identity/number, recalculates draft preview/costs atomically, audits the edit, advances updated_at. Stale timestamp/version, issuance or terminal state returns 409; never edits SENT prices/locked FX. |

| **67** | POST | /v1/admin/cms/banners | Bilingual banner create/update; id optional, exact translation/schedule/link fields. |

Collection limits are 1–100 (default 20), pages 1–100000. Unknown/repeated query keys are rejected. Lists retain English/zhCN translations and record IDs, flags and timestamps; they do not expose arbitrary database fields. Master pickers search/page these reads rather than treating one result page as the complete directory.

Product reads/writes additionally support optional `review_metadata:{kind:TECHNICAL|MEDICAL,reviewed_at:ISO timestamp,reviewer_name:string}`. PATCH may explicitly clear it with null. Review dates cannot be future dates; no automatic review date or clinical qualification is inferred from updated_at. This metadata records an actual human review and does not certify a reviewer's credentials. No prescription_required field is added. BSON persistence uses a strict optional review_metadata object with a date; migration is required before deployment, not performed by Next.js.

Authenticated catalog image upload is POST /v1/admin/catalog/images, multipart `image`, JPEG/PNG/WebP ≤5,242,880 bytes; result `{r2_object_key,url,mime_type,file_size_bytes}`. Persist the returned product image key; never expose storage credentials. CMS writes remain POST /v1/admin/cms/banners with the documented id/translation/schedule fields. CSV uses only the existing synchronous dry-run/commit contract; no job endpoint exists. All new reads and draft edits must pass the same cookie/BFF/Origin enforcement as existing admin routes.
