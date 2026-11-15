# MedAxis Global Pharma — Comprehensive PRD & Business Analysis Report
**Document Code:** PA-BA-DOC-2026-01  
**Role:** Senior Product Analyst & Lead Business Analyst  
**Source Documents:** `PRD.md` (v1.1 Enterprise Baseline) & `Idea.md` (Foundational Business Workflow)  
**Date of Evaluation:** November 2026  
**Status:** Complete Analysis & Review for Product Stakeholders  

---

## 1. Executive Summary & Product Overview

### 1.1 Product Context & Vision
**MedAxis Global Pharma** is a specialized, Bangladesh-based cross-border pharmaceutical sourcing and quotation management platform. The platform connects certified, cGMP-compliant Bangladeshi pharmaceutical manufacturers (e.g., Beacon, Beximco, Incepta, Square) with international wholesale buyers (B2B: clinics, distributors, pharmacies) and overseas oncology/critical-care patients and caregivers (B2C: primarily sourcing life-saving cancer medications).

### 1.2 Core Business Model & Differentiator
Unlike traditional e-commerce or B2C retail pharmacies, MedAxis Global Pharma operates strictly under a **Request for Quotation (RFQ) and Private Negotiated Quotation Model**:
* **Strict Zero Public Pricing**: Commercial wholesale pricing is never published or exposed via APIs to safeguard manufacturer agreements and accommodate fluctuating procurement costs and bulk-tiered margins.
* **Direct Manufacturer Attribution**: The platform attributes products directly to certified Bangladeshi manufacturers without maintaining intermediate broker/supplier directory layers.
* **Dual-Market Strategy**: Built from day one with equal prioritization for **Global English-speaking buyers** (`/en/...`) and **Mainland Chinese buyers** (`/zh-CN/...`), designed with dedicated Great Firewall (GFW) resilience.
* **Frictionless Engagement**: Eliminates upfront registration and password hurdles by leveraging 1-click **Quick Quote** modals, background customer profile generation, and **Passwordless Magic Links** (`/q/[token]`) for quotation review and negotiation.

---

## 2. Strategic Product Goals & Target KPIs

The PRD defines clear, quantifiable business and technical benchmarks. The alignment between business objectives and technical targets is evaluated below:

| Strategic Goal | Target KPI Benchmark | BA/PA Evaluation & Analysis |
| :--- | :--- | :--- |
| **Sales Responsiveness** | Inquiry-to-Quotation SLA **< 2 Hours** (09:00–21:00 UTC+6) | Highly competitive turnaround. Enabled by the single Super Admin model and the **Smart Fast-Quote Engine** (automated markup + FX presets). |
| **Commercial Conversion** | Quotation Acceptance Rate **$\ge$ 25%** | Realistic for specialized oncology drugs if price competitiveness and stock availability are verified quickly. |
| **User Acquisition Speed** | Quick Quote Submission Friction **< 10 Seconds** | Eliminates account creation drop-offs by reducing required fields to just 4 inputs (Name, Phone/WhatsApp, Country, Qty/Unit). |
| **Administrative Efficiency** | Fast-Quote Formulation **< 60 Seconds** (Admin) | Formula-driven pricing (`Cost × (1 + Markup%)`), Incoterms presets, and 1-click PDF generation dramatically reduce manual quote prep time. |
| **Global & China Web Speed** | Global FCP **< 1.5s**; China FCP **< 2.0s**; Core Web Vitals Pass | Crucial for international SEO and user retention across the Great Firewall. Leverages near-China CDN edge nodes (Hong Kong/Singapore). |
| **Commercial Security** | Zero Pricing Data Leakage **(100% Compliance)** | Strict exclusion of prices from HTML, client JS bundles, unauthenticated endpoints, and Schema.org structured data. |
| **GFW & Privacy Resilience** | Zero Google Services dependency; Cloudflare Turnstile / hCaptcha | Eliminates broken scripts in Mainland China (strictly no Google Fonts, Google reCAPTCHA, or Google Analytics). |

---

## 3. User Types & Persona Analysis

The PRD categorizes platform actors into external customer personas and an internal operating model:

### 3.1 External Personas
1. **B2B Wholesale Buyer (Distributors, Hospitals, Importers, Clinics)**:
   * **Needs**: High-volume procurement, bulk packaging units (Cartons, Boxes), competitive FOB/CIF terms, formal revision negotiation, Certificate of Analysis (COA) / batch release docs.
   * **Workflow Path**: Multi-product Quotation Cart, multi-currency selection (USD, EUR, CNY), structured shipping address.
   * **Key PRD Feature**: Quotation Cart, revision versioning (`v1` $\rightarrow$ `v2`), 1-click direct acceptance (BD-001, zero OTP), permanent PDF download.
2. **B2C Patient / Caregiver (Oncology & Critical Care Patients)**:
   * **Needs**: Urgent sourcing of hard-to-find oncology drugs for personal treatment, clear delivery timelines, trust and verification.
   * **Workflow Path**: 1-Click Quick Quote directly from the product detail page without creating an account.
   * **Compliance & Safety**: Optional prescription upload capped at 5MB (`JPEG`, `PNG`, `PDF`), encrypted storage, manual Super Admin verification, and a 90-day privacy purge policy.

### 3.2 Internal System Role (Single Super Admin Model)
* **Architectural Decision in Release 1**: All administrative functions are centralized under a single **Super Admin (Business Owner / Operator)**. There are **no separate sales, sourcing, or finance employee logins** in Release 1.
* **Responsibilities**: Product CMS, SEO metadata, master data, RFQ intake, WhatsApp/WeChat inquiry communication, manufacturer stock/cost verification, Fast-Quote issuance, 3-step offline fulfillment checkmarks (`Payment Received` $\rightarrow$ `Dispatched` $\rightarrow$ `Delivered`).
* **Security Hardening**: Because the Super Admin account represents a Single Point of Failure (SPOF) with access to sensitive margins and customer data, the PRD enforces:
  * Mandatory TOTP 2FA (RFC 6238).
  * Real-time automated email alerts on every login (IP, location, User-Agent).
  * 15-minute IP lockout after 5 consecutive failed attempts.
  * 8 single-use cryptographic backup recovery codes (hashed with SHA-256).
  * 30-minute idle session timeout and remote session revocation.

---

## 4. Functional Requirements (FR) Analysis

The PRD groups functional requirements across the end-to-end customer lifecycle:

```
[Discovery & Catalog] ──> [Dual RFQ Submission] ──> [Smart Fast-Quote Engine] ──> [Negotiation & Decision] ──> [Release 1 Offline Fulfillment]
```

### 4.1 Product Discovery & International SEO (Release 1)
* **Dual-Language Routing**: Dedicated URL prefixes `/en/...` and `/zh-CN/...` with crawler-readable SSR/SSG HTML.
* **Advanced Hreflang Architecture**: Reciprocal `hreflang="en"`, `hreflang="zh-CN"`, and entity-level `hreflang="x-default"` pointing to the corresponding English URL.
* **Soft Geo-IP Routing**: Root `/` routes Mainland China IPs / Chinese locales to `/zh-CN/` and international visitors to `/en/`. Persistent manual switcher overrides via `medaxis_locale` cookie (365 days). Direct URLs are never forcibly redirected.
* **Hierarchical Search Intent Hubs**:
  * Product Detail Pages (`/products/[slug]`)
  * Generic Ingredient Pages (`/generics/[slug]`)
  * Manufacturer Authority Hubs (`/manufacturers/[slug]`)
  * Therapeutic Category Hubs (`/categories/[slug]`)
  * Sourcing & Export Services (`/services/[slug]`)
* **Admin SEO CMS & Automatic 301 Engine**: Custom editable meta tags (`seo_title`, `meta_description`, `slug`). When an entity's slug is updated, the system automatically registers a 301 permanent redirect in `URL_REDIRECT` to protect backlinks and crawl equity.
* **Uncatalogued Requirement Fallback**: "Send Your Requirement" modal allows buyers to submit inquiries for drugs not yet listed in the catalog without requiring a catalog foreign key.

### 4.2 Dual RFQ Submission Pathways
* **Path A — Quick Quote (1-Click Popup)**: 4 required fields (Name, Phone/WhatsApp, Country, Quantity & Packaging Unit). Completes in under 10 seconds.
* **Path B — Multi-Product Quotation Cart**: Multi-item compilation with line-level mandatory packaging units (preventing ambiguous "10" without "Boxes/Vials").
  * **[MF-06 SPEC] Partial Cart RFQ Availability Flow**: When reviewing multi-item Cart RFQs, the Super Admin sets `item_availability_status` (`AVAILABLE`, `UNAVAILABLE`, `SOURCING`) per line. Admin can issue a Partial Quotation containing available lines, while unavailable items remain visible to the buyer with customer-friendly admin notes.
* **Frictionless Background Onboarding**: No prior registration or password required. The system idempotently creates or matches a customer profile in the background using phone and email.

### 4.3 Sourcing & Smart Fast-Quote Engine
* **Formula-Based Markup**:
  $$\text{Quoted Price (Base BDT)} = \text{Procurement Cost (BDT)} \times \left(1 + \frac{\text{Markup \%}}{100}\right)$$
* **Dual-Mode Currency Engine**: Live FX conversion with Super Admin **Manual Fixed Rate override** (USD, CNY, EUR) to lock commercial margins against currency volatility.
* **Full Manual Price Override**: Allows the Super Admin to round or customize unit prices; dynamic margin % and net profit recalculation in real time.
* **Operational Presets**: Default 7-day quotation validity, Incoterms dropdown (FOB, CIF, Express Courier), and standard wire terms.
* **Passwordless Magic Links (`/q/[token]`)**: Secure 256-bit CSPRNG token generated upon quotation issuance, allowing the buyer to open their quotation instantly without logging in.
* **[MF-09 SPEC] "Unable to Supply" Terminal Flow**: When an inquiry cannot be sourced from certified manufacturers, the Super Admin triggers "Unable to Supply", sets RFQ status to `Closed` with a structured reason, and dispatches an automated polite notification email to the buyer without generating a quotation draft.

### 4.4 Quotation Review, Negotiation & Acceptance
* **Action Hub**:
  1. **[Accept Quotation]**: **1-Click Direct Confirmation — Zero OTP (BD-001)**. The cryptographically signed 256-bit Magic Link token proves identity. Acceptance immediately locks the quote, activates a **5-calendar-day stock reservation**, displays bank wire instructions, and alerts the Super Admin in real time.
  2. **[Chat / Negotiate on WhatsApp / WeChat]**: Opens deep-linked chat (`wa.me`) or WeChat QR modal with pre-filled quotation context. Enables direct negotiation.
  3. **[Decline]**: Captures structured feedback (Price, Availability, Lead Time, Specification Mismatch, Other).
* **[EX-05 SPEC] Atomic Acceptance Concurrent Click Race Condition Protection**: The accept action runs as an atomic MongoDB transaction (`findOneAndUpdate` checking `status: "Sent"`). Duplicate simultaneous clicks return silent `HTTP 200 Already Accepted` with identical UI, ensuring exactly one transition to `Accepted` without duplicate records or race conditions.
* **[EH-07 SPEC] DB Write Failure Rollback on Accept**: If database write fails during acceptance, the transaction rolls back cleanly (`status` stays `Sent`), buyer sees a retry message with re-enabled accept button, failure logs to `AUDIT_LOG`, and 3+ consecutive failures trigger an admin alert.
* **Immutable Versioning**: When terms are renegotiated via chat, Admin creates revision `v2`. Previous version `v1` is locked as `Superseded`. Accepted quotes and their PDFs remain permanently accessible for compliance.
* **Dynamic Bilingual PDF**: Server-side generated quotation PDF with embedded `Noto Sans SC` fonts for perfect Chinese rendering. Excludes internal costs and admin notes. Displays guidance if opened in WeChat's in-app browser.

### 4.5 Release 1 Minimal Offline Fulfillment Tracking
Bridges the gap to Release 3 without requiring a complex ERP:
1. `[Mark Payment Received]`: Admin verifies offline bank wire (TT) and logs date/amount.
2. `[Mark Dispatched]`: Admin records courier name (DHL/FedEx) and AWB tracking number.
3. `[Mark Delivered]`: Admin marks fulfillment complete, archiving the record from the active queue.

---

## 5. Non-Functional Requirements (NFR) Analysis

| Dimension | Specification in PRD | Adequacy & Robustness Assessment |
| :--- | :--- | :--- |
| **System Uptime & Recovery** | 99.9% availability; daily encrypted DB backups; RPO < 24h, RTO < 4h. | Adequate for a quotation-driven platform without live checkout transactions. |
| **Great Firewall (GFW) Compatibility** | Zero Google scripts/fonts/APIs; Cloudflare Turnstile / hCaptcha; Hong Kong/Singapore edge nodes; WeChat QR / ID integration. | **Excellent**. Solves the primary technical failure point for Western-built websites targeting Mainland China. |
| **Prescription Privacy (HIPAA / GDPR-like)** | 5MB cap (`JPEG`, `PNG`, `PDF`); AES-256 encryption at rest; Admin-only access; automated 90-day purge after fulfillment. | **Strong**. Balances medical compliance and data minimization. |
| **Magic Link Security** | 256-bit CSPRNG token; hashed with SHA-256; 30 req/min IP rate limit; zero leakage of internal margins; permanent audit read for accepted quotes. | **Secure**. Eliminates login fatigue while ensuring tenant isolation. |
| **Email Deliverability** | Strict SPF, DKIM, DMARC; tested against global (Gmail, Outlook) and Chinese (QQ Mail, 163 Mail) mail servers. | Critical for ensuring Chinese buyers receive quotation alerts. |
| **SEO & Crawl Budget Protection** | Strict `noindex, nofollow` on `/q/*` and `/admin/*`; dynamic multi-sitemap; facet canonicals; truthful Schema.org (zero fake price/reviews). | Adheres strictly to Google and Baidu webmaster guidelines. |

---

## 6. Comparative Analysis: `Idea.md` vs. `PRD.md`

| Feature / Area | Initial Concept (`Idea.md`) | Enterprise PRD (`PRD.md`) | Business & Strategic Impact |
| :--- | :--- | :--- | :--- |
| **Supplier vs. Manufacturer** | "Manufacturer ar supplier alada record hobe. Ek product-er multiple supplier thakte pare." | **Exclusive Manufacturer Attribution only**. No separate supplier entity. | Simplifies catalog management and database structure. Aligns MedAxis Global Pharma as a direct-from-manufacturer sourcing partner. |
| **Buyer Onboarding** | Mandatory account registration and login before submitting RFQs. | **Frictionless guest submission** with background profile creation & Magic Link access. | Dramatically reduces submission drop-offs (conversion rate optimization). |
| **Quotation Access** | Login required to view customer quotations in dashboard. | **Passwordless Magic Links** (`/q/[token]`) dispatched via WhatsApp and Email. | Allows buyers to review and act on quotes directly from mobile messaging apps. |
| **Quotation Acceptance** | Basic acceptance button. | **1-Click Direct Acceptance (BD-001, zero OTP)** + **5-day stock reservation** window. | Eliminates code delivery friction; 256-bit Magic Link token serves as cryptographic identity proof while 5-day window creates commercial urgency. |
| **Pricing Engine** | Basic line-item calculation (`Qty × Price`). | **Smart Fast-Quote Engine** (BDT procurement cost + markup % + live/fixed FX + manual override). | Enables quotes to be built in <60 seconds with protected gross margins. |
| **China Market Architecture** | Basic English/Chinese language switcher proposed. | **Full GFW Resilience**: Dual-language URL paths (`/en/`, `/zh-CN/`), SSR/SSG, Turnstile, WeChat QR, near-China CDN. | Guarantees accessibility and fast loading inside Mainland China without an ICP license. |
| **Post-Quotation Tracking** | Manual handoff or deferred to later phase. | **Release 1 Minimal Fulfillment Tracker** (3-stage checkmarks: Payment $\rightarrow$ Dispatched $\rightarrow$ Delivered). | Gives the business owner end-to-end operational visibility immediately upon launch. |
| **Internal Roles** | Proposed multi-role staff (Admin, Sales, Sourcing, Content, Finance). | **Single Super Admin model** for Release 1 (multi-role deferred to Release 4). | Tailored for immediate single-operator launch without unnecessary engineering complexity. |

---

## 7. Resolution of Critical Gaps & Locked Business Decisions (BD-001 to BD-005)

The critical ambiguities and business process questions originally identified during the initial analysis were formally reviewed and **locked by the Business Owner on 13 November 2026**. Engineering specifications across all documentation reflect these authoritative decisions:

### 7.1 Ambiguity 1 Resolved: Quotation Acceptance Verification
* **Original Issue**: PRD initially described a 4-digit OTP via WhatsApp, conflicting with the decision to defer automated WhatsApp Business API to Release 4.
* **✅ Final Locked Decision [BD-001]**: **No OTP required at any point.** Quotation acceptance is a **direct 1-click confirmation**. The cryptographically signed 256-bit Magic Link token itself serves as absolute proof of identity. All OTP delivery and verification infrastructure has been fully purged from the engineering requirements.

### 7.2 Ambiguity 2 Resolved: Mainland China Communication Channel
* **Original Issue**: WhatsApp is blocked by the Great Firewall in Mainland China; automated WeChat bot integration is not available at launch.
* **✅ Final Locked Decision [BD-002]**: **Email is the primary automated channel** for Mainland China buyers (delivering Magic Links, quotation notifications, and RFQ confirmations). Email deliverability is strictly configured and tested for Chinese inboxes (`@qq.com`, `@163.com`). WeChat ID and a scan-to-chat QR code are provided on the site solely for buyers to initiate **manual** chat with the Super Admin.

### 7.3 Ambiguity 3 Resolved: Patient Prescription Upload & Fulfillment Policy
* **Original Issue**: Clarifying whether an uploaded prescription must become mandatory before medication dispatch.
* **✅ Final Locked Decision [BD-003]**: **Prescription upload is 100% strictly optional at all stages** — inquiry, quotation acceptance, payment, and dispatch. It never blocks any step in the fulfillment workflow. If uploaded, the Super Admin reviews it for informational context only.

### 7.4 Ambiguity 4 Resolved: Direct Manufacturer Sourcing Model
* **Original Issue**: Clarifying whether intermediary pharmaceutical distributors exist in the data model.
* **✅ Final Locked Decision [BD-004]**: **Exclusive direct-from-manufacturer sourcing model.** All products are attributed directly to their licensed Bangladeshi manufacturer (e.g., Beacon, Beximco, Incepta, Square). No `SUPPLIER` entity, broker table, or third-party vendor directory exists in the schema.

### 7.5 Ambiguity 5 Resolved: Foreign Exchange (FX) Rate Policy
* **Original Issue**: Managing currency fluctuation risk during the 7-day quotation validity and 5-day stock reservation window.
* **✅ Final Locked Decision [BD-005]**: **Exchange rate is permanently locked at the exact moment of quotation issuance.** The quoted price in USD, CNY, or EUR is final and immutable. The Super Admin absorbs currency risk by building a safety margin (+3–5%) into the markup formula in the Fast-Quote console.

---

## 8. Risk Assessment & Mitigation Matrix

| Risk Category | Risk Event / Threat | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Technical / GFW** | Chinese government blocks near-China CDN IP or Cloudflare edge. | High | Medium | Use multiple fallback CDN edge IPs; monitor via Uptime Kuma / Baidu probes; prepare Hong Kong server fallback. |
| **Operational** | Customer shares Magic Link; third party accepts or views commercial quote. | Medium | Low | High-entropy 256-bit CSPRNG token in Magic Link, 1-click confirmation modal, first-access IP audit logging, and atomic transaction race condition protection (EX-05). |
| **Commercial** | Competitors submit dummy RFQs to discover wholesale margins. | High | Medium | Public prices remain zero; Super Admin reviews all RFQs manually before issuing quotes; company verification required for B2B wholesale. |
| **Logistics / Cold Chain** | Oncology biologics require strict 2°C–8°C cold chain; transit delay compromises product. | High | Medium | Pre-configured Incoterms and shipping presets clearly specify specialized cold-chain air freight; packaging condition logged before dispatch. |
| **Regulatory Compliance** | Exporting specialized cancer drugs to countries with strict personal import bans. | High | Low | Country destination checks during Super Admin review; required destination import permit verified before marking payment received. |

---

## 9. Product Roadmap & Phasing Feasibility

```
┌────────────────────────────────────────────────────────────────────────┐
│ RELEASE 1: MVP CORE (Target: Immediate Development)                   │
├────────────────────────────────────────────────────────────────────────┤
│ • SSR/SSG Bilingual Catalog (/en & /zh-CN)                             │
│ • Faceted Search & Zero Public Price Enforcement                       │
│ • Dual RFQ Pathways: Quick Quote Modal + Quotation Cart                │
│ • Background Identity & Customer Profile Creation                      │
│ • Smart Fast-Quote Builder (BDT Cost + Markup + FX + Manual Override)  │
│ • Passwordless Magic Link Delivery (/q/[token])                        │
│ • 1-Click Direct Acceptance + 5-Day Stock Reservation (BD-001)         │
│ • 3-Stage Minimal Offline Fulfillment Checkmarks                       │
│ • Admin CSV Bulk SKU Import (100+ medicines)                           │
│ • 2FA-Hardened Single Super Admin Dashboard                            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ RELEASE 2: BUYER TOOLS & AUTHORITY CONTENT                             │
├────────────────────────────────────────────────────────────────────────┤
│ • Batch-specific Certificate of Analysis (COA) Request Workflow        │
│ • B2B Bulk Excel/CSV RFQ File Upload & Column Matching                 │
│ • 4-Way Side-by-Side Medicine Comparison Tool                          │
│ • Multilingual Blog & International Buyer/Export Guides                │
│ • Registered Customer Saved Products / Favorites                       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ RELEASE 3: POST-QUOTE OPERATIONS & INTEGRATIONS                        │
├────────────────────────────────────────────────────────────────────────┤
│ • Formal Customer Order Entity & Lifecycle Tracking                    │
│ • Customer Self-Service Bank Wire Slip / SWIFT Upload Portal           │
│ • Manufacturer PO & Batch Inspection Tracking                          │
│ • Courier API Webhooks (DHL / FedEx AWB live tracking)                 │
│ • Customer Issue & Shortage Dispute Handling                           │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ RELEASE 4: ENTERPRISE SCALING & AUTOMATION                             │
├────────────────────────────────────────────────────────────────────────┤
│ • Multi-User Staff Accounts (Sales Rep, Sourcing, Finance, QA)         │
│ • Automated WhatsApp Business API & WeChat Official Account Messaging  │
│ • Bi-Directional CRM Integration (HubSpot / Salesforce)                │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 10. 🔒 Locked Business Decisions (Owner-Confirmed)

> [!IMPORTANT]
> These are **final, owner-confirmed decisions** locked on 13 November 2026. They override any conflicting earlier specification in `PRD.md` or `Idea.md`. Engineering must treat these as non-negotiable constraints.

| Decision ID | Topic | Decision | Impact on System |
| :--- | :--- | :--- | :--- |
| **BD-001** | Quotation Acceptance Verification | **No OTP required.** Buyer clicks `[Accept Quotation]` → quotation is immediately locked to `Accepted` status. The 256-bit Magic Link token is the proof of identity. | Remove all OTP generation, dispatch, and verification logic from the codebase and data model. Remove `otp_verification_code` and `otp_verified_at` fields from `QUOTATION_VERSION`. |
| **BD-002** | China Buyer Communication Channel | **Email is the primary automated channel** for Mainland China buyers (Magic Links, quotation alerts, RFQ confirmations). WeChat QR code / WeChat ID is displayed on the site for buyers to initiate **manual** chat with the Admin — not used as an automated dispatch channel in Release 1. WhatsApp is a secondary channel for non-China buyers only. | Email must be deliverable to Chinese inboxes (`@qq.com`, `@163.com`). SPF, DKIM, DMARC must be configured. No automated WeChat messaging API in Release 1. |
| **BD-003** | Prescription Upload & Verification | **Prescription is fully optional at every stage** — inquiry, quotation acceptance, payment, and dispatch. It never blocks any step in the workflow. If uploaded (for reference), Super Admin can view it. No mandatory verification gate exists. | Remove any workflow state that blocks or requires prescription verification before proceeding to next step. Prescription upload remains a UI convenience only. |
| **BD-004** | Pharmaceutical Sourcing Model | **Exclusive direct-from-manufacturer sourcing only.** No supplier, broker, or distributor entity exists in the data model. All products are attributed solely to their licensed pharmaceutical manufacturer (Beacon, Beximco, Incepta, Square, etc.). | Remove any `SUPPLIER` table or intermediary vendor entity from the schema. Procurement cost is recorded directly against the manufacturer record. |
| **BD-005** | Foreign Exchange (FX) Rate Policy | **Exchange rate is locked at the moment of quotation issuance.** The price in USD/CNY/EUR shown to the buyer is final and does not change during the 7-day validity or the 5-day stock reservation period. The Super Admin absorbs FX risk by building a safety margin into the markup at time of quoting. | The `EXCHANGE_RATE` snapshot used at quote generation time must be stored permanently on the `QUOTATION_VERSION` record. Post-issuance rate updates must never retroactively alter sent quotations. |

---

## 11. Recommendations & Actionable Next Steps

### 11.1 For the Business Owner / Product Sponsor
1. **Prepare Initial Catalog Data**: Utilize the standardized CSV schema defined in `PRD.md` to compile the initial 100+ pharmaceutical SKUs (Brand, Generic, Strength, Pack Size, Manufacturer) for the 1-click bulk import tool.
2. **Configure Email Deliverability for China**: Set up SPF, DKIM, and DMARC on the domain and test transactional email delivery to `@qq.com` and `@163.com` inboxes before go-live.
3. **Set Safety FX Margins**: Since FX rate is locked at issuance (BD-005), establish a standard markup buffer (e.g., +3–5% above live rate) in the Admin Settings to protect against currency swings during the reservation window.
4. **WeChat Setup**: Prepare a WeChat ID and QR code to be displayed on the website for Mainland China buyers to contact the Super Admin manually.

### 11.2 For the Engineering Team
1. **Remove OTP Infrastructure (BD-001)**: No OTP generation service, delivery queue, or verification endpoint is needed. Remove `otp_verification_code` and `otp_verified_at` from `QUOTATION_VERSION` schema. Acceptance is a single authenticated POST to the quotation endpoint protected by the Magic Link token.
2. **Architectural Separation**: Keep the database schema modular (as designed in Section 6 of `PRD.md`) so transitioning from the Single Super Admin model to multi-user staff roles in Release 4 requires zero schema migration.
3. **Zero Google Assets**: Audit all front-end dependencies to guarantee zero calls to `fonts.googleapis.com`, `google.com/recaptcha`, or `analytics.js`. Implement Cloudflare Turnstile and native system font stacks.
4. **Magic Link CSPRNG Implementation**: Ensure quotation tokens use cryptographically secure 256-bit random strings and are indexed with SHA-256 hashes in the database.
5. **International SEO Baseline**: Ensure Server-Side Rendering (SSR) correctly renders reciprocal `hreflang` tags and self-referential canonical tags on all localized catalog pages.
6. **FX Snapshot on Quotation (BD-005)**: Store `locked_fx_rate_usd`, `locked_fx_rate_cny`, `locked_fx_rate_eur` as immutable decimal fields directly on `QUOTATION_VERSION` at the moment of issuance. These values must never be overwritten by later rate updates.

