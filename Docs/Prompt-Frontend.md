# MedAxis Global Pharma — Step-by-Step Frontend Implementation Prompts (Release 1)

**Target Stack:** Next.js 14+ (App Router, SSR/SSG/ISR) · TypeScript · Tailwind CSS · `next-intl` · Cloudflare Turnstile · Plausible Analytics (GFW-safe)  
**Canonical Source Specifications (Single Source of Truth):**
- [PRD.md](PRD.md) — User journeys, bilingual SEO (`en` & `zh-CN`), Zero Public Pricing, `BD-001` to `BD-005`, UI workflows & acceptance criteria
- [Architecture.md](Architecture.md) — `frontend/` folder structure (Section 4), i18n/SEO service (Section 3.7), deployment standards (Section 7)
- [API-Spec.md](API-Spec.md) — REST contract consumed via Express backend (`NEXT_PUBLIC_API_BASE_URL`), custom error envelope handling, client retry rules

> **How to Use This File:** Execute Steps **1 through 8** sequentially after the matching backend APIs are available (or against a local/mocked `/v1` API server). Copy the **Prompt** block for one step at a time and pass its **Verification Gate** before continuing. Strictly **never** query MongoDB or Cloudflare R2 directly from Next.js — communicate **only** through the Express `/v1/*` REST API.

---

## TypeScript Rules (Apply to Every Step)

- Write React components, pages, and layouts in `.tsx`; write hooks, utilities, API clients, route handlers, middleware, and tests in `.ts`. Do not introduce handwritten `.js`/`.jsx` application modules.
- Enable `strict: true`, `noImplicitAny: true`, `allowJs: false`, and `noEmit: true` in `tsconfig.json`, preserving Next.js JSX, module-resolution, plugin, and generated-type settings. Next.js builds the runnable output into `.next/`; do not copy the backend's emitting `NodeNext`/`dist` configuration into the frontend.
- Type component props, form state, cart items, locale/status unions, API request/response DTOs, and SSE events. Treat JSON/network input and caught errors as `unknown` until validated/narrowed; avoid explicit `any`, `@ts-ignore`, and casts that merely suppress errors.
- Keep HTTP contracts aligned with `API-Spec.md` and backend DTOs. Represent monetary amounts/FX as decimal strings and timestamps as ISO strings in transport types. Keep public catalog DTOs separate from token-protected quotation and admin DTOs; never import backend database models or server secrets into frontend modules.
- Add `dev`, `build`, `start`, `typecheck`, `lint`, `test`, and `test:e2e` scripts. Use `next dev`, `next build`, `next start`, `tsc --noEmit`, `eslint .`, `vitest run`, and `playwright test`, respectively. Include application code, tests, test configurations, and Next.js generated types in typechecking. Do not enable `typescript.ignoreBuildErrors`.
- JSON translation/configuration files, CSS, static assets, framework-generated declarations, and supported tooling configuration formats remain valid exceptions. Prefer typed configuration where supported by the selected framework/tool version; an `.mjs` tooling config does not make the application JavaScript.
- These rules apply even when an individual step prompt is copied on its own.

## Step Index

| Step | Focus / Pages | Key Backend Endpoints Consumed |
|---|---|---|
| **Step 1** | Next.js App Router Bootstrap, `next-intl` (`alternateLinks: false`), Edge Middleware, `301` Cache, Sitemap & ISR Webhook | `#06` (`sitemap-catalog`), `/api/revalidate` |
| **Step 2** | Shared Bilingual Layout, `medaxis_locale` Switcher, Reciprocal Hreflang Metadata & Public Homepage | `#01`, `#07` (`cms/banners`) |
| **Step 3** | Public Product Listing, Search/Facets, Product Detail & Generic/Manufacturer/Category Hubs (SSG + ISR, Zero Prices) | `#01`, `#02`, `#03`, `#04`, `#05` |
| **Step 4** | Dual RFQ Flows: 10-Second Quick Quote Modal, Persistent RFQ Cart, Encrypted Prescription Upload & Turnstile | `#08`, `#09`, `#10` |
| **Step 5** | Magic Link Quotation Viewer (`/q/[token]`), WeChat UA PDF Guard, 1-Click Atomic Accept & Buyer Actions | `#12`, `#13`, `#14`, `#15`, `#16`, `#17` |
| **Step 6** | Super Admin Auth (`/admin/login` + TOTP/Backup Code), Layout Session Guard, Live SSE Alerts & Dashboard | `#18–24`, `#25`, `#50` (`/admin/stream`) |
| **Step 7** | Admin RFQ Queue, Prescription Secure Viewer, Smart Fast-Quote Builder & 3-Step Fulfillment Console | `#25–38`, `#45` |
| **Step 8** | Admin Catalog CRUD, Bulk CSV Dry-Run Import, Customers, FX/Settings, Audit Logs & E2E Verification | `#39–52` |

---

## Step 1 — Next.js Bootstrap, `next-intl`, Edge Middleware, 301 Redirects, Sitemap & API Client

**Goal:** Initialize `frontend/` following `Architecture.md` Sections 3.7 & 4, including GFW-safe soft Geo-IP routing (`medaxis_locale` cookie), in-memory LRU `301` redirect engine, typed REST API client honoring `API-Spec.md` Section 1.6 retries, `/sitemap.xml`, `/robots.txt`, and `/api/revalidate`.

### Prompt
```text
You are building the Frontend for **MedAxis Global Pharma** (Release 1), strictly following:
- `Architecture.md` (Sections 2, 3.7, 4 `frontend/` tree, 7)
- `PRD.md` (Sections 1.3 A1/A6, 3.1, 7)
- `API-Spec.md` (Sections 1.2–1.6 client contract, retry & non-JSON proxy handling)

Implement **Step 1: Next.js Foundation, Edge i18n/Redirect Middleware, SEO Routes & Typed API Client** inside `frontend/`:

1. **Bootstrap & Config:**
   - Initialize Next.js 14+ (App Router, TypeScript, Tailwind CSS) inside `frontend/`. Apply the TypeScript Rules above: strict `.ts`/`.tsx` source, `allowJs: false`, `noEmit: true`, typed tests, and explicit build/typecheck scripts; preserve the selected Next.js version's generated TypeScript configuration.
   - Install `next-intl`, `lucide-react`, `@marsidev/react-turnstile` (or standard Turnstile script loader), and Vitest/Playwright tooling.
   - Configure `next.config.mjs`: `images.remotePatterns` for `cdn.medaxisglobalpharma.com` / R2 public asset domain, strict security headers (without blocking self-hosted assets or Turnstile).
   - **GFW-Safe Rule:** Zero Google Fonts CDN calls (`fonts.googleapis.com`), zero Google Analytics, zero Google reCAPTCHA. Use local system/self-hosted fonts (`Noto Sans SC` / system UI stack).

2. **`next-intl` Setup (`frontend/messages/en.json`, `frontend/messages/zh-CN.json`, `i18n/request.ts`):**
   - Supported locales: `['en', 'zh-CN']`, default `'en'`.
   - Set `alternateLinks: false` in `next-intl` middleware config (`Architecture.md` 3.7) so automatic Link headers never collide with per-page `generateMetadata()` `hreflang` + canonical tags.

3. **Edge Middleware (`frontend/middleware.ts`):**
   - Bypass `/api/*`, `/_next/*`, `/sitemap.xml`, `/robots.txt`, static assets.
   - Do **not** wrap `/q/*` or `/admin/*` in `[locale]` prefix routing.
   - **301 Redirect Engine:** Check incoming pathname against an in-memory LRU cache (1-hour TTL, ~500 entries) fed by the backend redirect lookup (or Next.js lightweight cache route); issue HTTP `301` when a historical slug matches.
   - **First-Visit Soft Geo-IP Routing (`PRD.md` 1.3 A1):**
     - Only act on root `/` (NEVER forcefully redirect direct visits to `/en/*` or `/zh-CN/*`).
     - Check cookie `medaxis_locale` first (`en` or `zh-CN`).
     - Otherwise check Cloudflare header `CF-IPCountry === 'CN'` or `Accept-Language` starting with `zh` -> redirect to `/zh-CN`; otherwise `/en`.

4. **Typed REST API Client (`frontend/lib/api-client.ts`):**
   - Strictly consume `NEXT_PUBLIC_API_BASE_URL` (server-side internal URL override optional) with `credentials: 'include'` for admin requests and `Accept: application/json`.
   - Define discriminated `ApiSuccess<T>` (`success: true`) and `ApiFailure` (`success: false`) envelopes and a typed `ApiError` with status, code, field details, and request ID. Validate/narrow network JSON from `unknown` before consuming it; generic type assertions alone are not runtime validation. Handle non-JSON HTML error pages from Cloudflare/proxies gracefully by status code without crashing (`API-Spec.md` 1.6).
   - Implement documented retry rule: retry `GET` (or idempotent mutations reusing the exact `idempotency_key`) up to 3 times on `429`/`503`/network failure, honoring `Retry-After` integer seconds or exponential backoff + jitter (`1s`..`30s`); never retry other `4xx`.

5. **Dynamic SEO & ISR Endpoints:**
   - `app/sitemap.xml/route.ts`: Fetch published slugs from Express `GET /v1/public/sitemap-catalog`, output XML with `<xhtml:link rel="alternate" hreflang="en" />`, `zh-CN`, and `x-default` (always pointing to `/en/...`), strictly excluding `/q/*` and `/admin/*`.
   - `app/robots.txt/route.ts`: Disallow `/q/`, `/admin/`, `/api/`.
   - `app/api/revalidate/route.ts`: Bearer-token (`REVALIDATE_WEBHOOK_SECRET`) protected `POST` route calling Next.js `revalidatePath` / `revalidateTag` when triggered by Admin catalog saves/imports.
```

### Verification Gate
- `npm run typecheck` and `npm run build` pass with strict TypeScript; application source uses `.ts`/`.tsx`, and build errors are not suppressed.
- `GET /` with `CF-IPCountry: CN` (and no cookie) redirects to `/zh-CN`; with `medaxis_locale=en` cookie redirects to `/en`; `GET /zh-CN/products` never redirects away.
- `/sitemap.xml` includes localized product/manufacturer/generic/category URLs with reciprocal `hreflang` + `x-default` -> `/en/...` and zero `/q/` or `/admin/` routes.
- API client unit test verifies `429` honors `Retry-After` and non-JSON proxy HTML returns sanitized typed error.

---

## Step 2 — Bilingual Layout, Locale Switcher, Hreflang Metadata Helper & Homepage

**Goal:** Build the global public shell (`[locale]/layout.tsx`), `English | 简体中文` switcher writing `medaxis_locale` (365-day expiry), strict reciprocal `hreflang` metadata builder, cart state provider, and bilingual homepage highlighting Direct Manufacturer Sourcing (`BD-003`) with zero pricing.

### Prompt
```text
Implement **Step 2: Bilingual Shell, Locale Switcher, SEO Metadata Helper & Homepage** inside `frontend/` matching `PRD.md` (Sections 1.1–1.3, 3.1, 7) and `Architecture.md` (Sections 3.7, 4):

1. **Reciprocal SEO & Hreflang Helper (`frontend/lib/seo.ts`):**
   - Export `buildLocalizedMetadata({ locale, enPath, zhPath, title, description })`:
     - Self-referential `canonical`: `/en/...` points to itself; `/zh-CN/...` points to itself.
     - `alternates.languages`: `en` -> full `enPath`, `zh-CN` -> full `zhPath`, `x-default` -> **exact equivalent `enPath` of that entity** (never collapsing to root `/`).

2. **Cart Context & Language Switcher (`frontend/components/layout/`):**
   - `CartProvider`: Hydrates multi-item RFQ Cart cleanly from `localStorage` without SSR hydration mismatch; exposes `addItem`, `addCustomItem`, `updateQuantity`, `removeItem`, `clearCart`, drawer open state, and item badge count.
   - `LocaleSwitcher`: Prominent `English | 简体中文` control in the top header; clicking switches to the exact localized counterpart route (preserving slug equivalence where provided) and sets persistent cookie `medaxis_locale` (`Max-Age=31536000`, `Path=/`, `SameSite=Lax`).

3. **Public Layout (`frontend/app/[locale]/layout.tsx`):**
   - Clinical, trustworthy pharmaceutical UI header: MedAxis Global Pharma brand mark, navigation (`Products`, `Manufacturers`, `Generics`, `Cold-Chain & Services`), `LocaleSwitcher`, Cart button with live badge, primary **"Request Quick Quote"** button opening the Quick Quote modal.
   - Footer with licensed Bangladeshi Direct Manufacturer sourcing statement, WhatsApp / WeChat official contact trigger, regulatory/prescription disclaimer, and non-indexed utility links.
   - Load Plausible Analytics script conditionally ONLY on public `[locale]` routes (NEVER on `/q/*` or `/admin/*`).

4. **Homepage (`frontend/app/[locale]/page.tsx`):**
   - Fetch active banners from `GET /v1/public/cms/banners?locale={locale}` and featured catalog items/manufacturers from `GET /v1/public/products`.
   - Display: Hero section (B2B wholesale + B2C patient sourcing, zero public pricing), active announcement banners, therapeutic category grid, licensed Bangladeshi manufacturer showcase (`Beacon`, `Beximco`, `Incepta`, `Square`, etc.), cold-chain export capability badges, and clear 3-step **"Submit RFQ -> Receive Tailored Quote -> Fast Global Dispatch"** explainer.
```

### Verification Gate
- Rendered HTML on `/en` and `/zh-CN` contains self-referential `<link rel="canonical">`, `hreflang="en"`, `hreflang="zh-CN"`, and `hreflang="x-default"` pointing to the English entity URL.
- Switching language sets `medaxis_locale` (365d) and persists on subsequent `/` reload.
- Zero prices or currency quote figures appear anywhere in DOM or serialized RSC payload.

---

## Step 3 — Public Catalog, Search/Filters, Product Detail & SEO Hubs (SSG + ISR)

**Goal:** Build the public product listing, product detail page, and generic/manufacturer/category/services hub pages with zero public pricing, explicit image dimensions (zero CLS), and SSG/ISR support.

### Prompt
```text
Implement **Step 3: Public Catalog & Bilingual SEO Hubs (Zero Public Pricing)** inside `frontend/app/[locale]/` and `frontend/components/catalog/` matching `PRD.md` (Sections 1.3 A7/BD-003, 3.1, 7), `Architecture.md` (Section 3.1, 3.7), and `API-Spec.md` Section 3 (`#01–05`):

1. **Product Catalog Page (`app/[locale]/products/page.tsx`):**
   - Search bar (`q`), faceted filters (`category`, `manufacturer`, `generic`, `cold_chain`), pagination (`GET /v1/public/products`).
   - Product cards (`components/catalog/ProductCard.tsx`) displaying: localized brand name, generic active ingredient, strength & dosage form, licensed manufacturer badge, cold-chain / Rx-required badges, explicit `width`/`height` `<Image>` (`next/image` preventing CLS), **"Add to Quote Cart"** button, and **"Quick Quote"** CTA — **strictly ZERO pricing**.
   - Also show a prominent fallback prompt if search yields no results: *"Can't find your medicine? Request any medicine via Quick Quote"* (opening Quick Quote with custom/uncatalogued mode per `MF-01`).

2. **Product Detail Page (`app/[locale]/products/[slug]/page.tsx`):**
   - Use `generateStaticParams` + ISR (`revalidate`) + `generateMetadata` with `alternate_slugs` for exact cross-locale `hreflang` links.
   - Show image gallery, full clinical & packaging specifications (`strength`, `dosage_form`, `pack_size`, `cold_chain_required`, `storage_condition`, `prescription_required`), clickable links to its Generic hub and Licensed Manufacturer page (`BD-003` — no supplier/broker terminology), quantity selector + **"Add to Quote Cart"** + **"Request Quick Quote"**, and structured JSON-LD Schema.org (`Product` / `MedicalEntity` WITHOUT any `offers.price` field).

3. **SEO Authority Hubs & Services:**
   - `app/[locale]/generics/[slug]/page.tsx` (`GET /v1/public/generics/:slug`): Active ingredient medical overview + all manufacturer products containing that generic.
   - `app/[locale]/manufacturers/[slug]/page.tsx` (`GET /v1/public/manufacturers/:slug`): Manufacturer cGMP/WHO credentials, country, and complete available product portfolio.
   - `app/[locale]/categories/[slug]/page.tsx` (`GET /v1/public/categories/:slug`): Therapeutic category landing + product list.
   - `app/[locale]/services/page.tsx`: Cold-chain air freight, WHO-GDP handling, B2B/B2C documentation & export compliance overview.
```

### Verification Gate
- Lighthouse / automated check confirms `next/image` explicit dimensions (`CLS === 0` target), reciprocal `hreflang` on `/en/products/[slug]` <-> `/zh-CN/products/[zhSlug]`, and zero occurrence of unit price/cost strings.
- Clicking "Can't find your medicine?" launches uncatalogued Quick Quote pre-filled with the search query.

---

## Step 4 — Dual RFQ Submission Flows: 10-Second Quick Quote, Cart RFQ & Prescription Upload

**Goal:** Implement the complete Quick Quote modal, Cart RFQ checkout drawer/page, optional encrypted prescription upload (`#10`), Cloudflare Turnstile integration, `BD-002` China email rule, and browser UUID v4 idempotency lifecycle.

### Prompt
```text
Implement **Step 4: Dual RFQ Submission, Idempotency Lifecycle, Prescription Upload & Turnstile** in `frontend/components/rfq/` matching `PRD.md` (Sections 1.3 A2/A3/BD-002, 3.2, 4.1), `Architecture.md` (Section 3.2), and `API-Spec.md` Section 4 (`#08–10`):

1. **Idempotency & Turnstile Hook (`frontend/hooks/useRfqSubmission.ts`):**
   - Generate a fresh UUID v4 `idempotency_key` (`crypto.randomUUID()`) when the Quick Quote modal or Cart RFQ drawer opens.
   - If the user receives a transient network error/`500`/`503` and retries, **reuse the exact same `idempotency_key`** until submission succeeds or payload changes.
   - Immediately upon `200`/`201` success, clear cart (for Cart RFQ) and regenerate a brand-new `idempotency_key` so consecutive distinct inquiries in the same tab never collide (`Architecture.md` 3.2).

2. **Encrypted Prescription Uploader (`frontend/components/rfq/PrescriptionUpload.tsx`):**
   - Optional file dropzone accepting **JPEG, PNG, PDF up to 5 MiB (`5,242,880` bytes)** with immediate client-side size/MIME feedback before upload.
   - Uploads via `multipart/form-data` with Turnstile token to `POST /v1/public/prescriptions/upload` (`#10`), shows upload progress and security badge (*"Encrypted AES-256 at rest & auto-purged after completion"*), and attaches returned `prescription_id` to the RFQ submission.

3. **10-Second Quick Quote Modal (`frontend/components/rfq/QuickQuoteModal.tsx`):**
   - Pre-fills selected catalog product (`product_id` + unit/quantity) OR opens in **Uncatalogued Medicine Mode (`MF-01`: `is_uncatalogued: true`, `custom_medicine_name`)**.
   - Fields: Buyer Type (`B2C_PATIENT` / `B2B_WHOLESALE`), Name, Email, WhatsApp/WeChat ID, Destination Country, Quantity, Packaging Unit, Optional Prescription Upload, Notes, Cloudflare Turnstile widget.
   - **BD-002 Validation:** When current locale is `zh-CN` (or destination is China), require a valid Email address with explicit localized message (*"Email is required to receive your secure quotation link."*).
   - Submits to `POST /v1/public/rfq/quick-quote` (`#08`) and renders confirmation screen showing `rfq_number` + expected turnaround SLA.

4. **Multi-Item Cart RFQ Drawer / Page (`frontend/components/rfq/CartDrawer.tsx`):**
   - Lists cart items + allows adding custom uncatalogued medicine rows (`MF-01`), adjusting quantities/packaging units, attaching prescription(s), Turnstile verification, and submitting via `POST /v1/public/rfq/cart` (`#09`).
   - Maps `422 VALIDATION_FAILED` field `details` directly onto form inputs and shows friendly localized retry UI on `403 TURNSTILE_VERIFICATION_FAILED` (resetting Turnstile widget) or `429`/`503`.
```

### Verification Gate
- Double-clicking submit or retrying after simulated `503` sends identical `idempotency_key` and receives the same `rfq_number`.
- Switching to `/zh-CN` and clearing email prevents submission with localized `BD-002` validation error.
- Uploading > 5 MiB or `.exe`/`.txt` file is blocked immediately client-side with clear guidance; valid PDF returns `prescription_id` and attaches cleanly.

---

## Step 5 — Magic Link Quotation Viewer (`/q/[token]`), WeChat Guard & 1-Click Accept

**Goal:** Build the passwordless customer quotation portal (`/q/[token]`), WeChat in-app browser PDF guard, WhatsApp/WeChat negotiation links, and all buyer decision flows (`#12–17`).

### Prompt
```text
Implement **Step 5: Magic Link Quotation Viewer & Buyer Decisions (`/q/[token]`)** inside `frontend/app/q/[token]/` and `frontend/components/quotation/` matching `PRD.md` (Sections 1.3 A5/BD-001, 3.3, 3.4, 4.3), `Architecture.md` (Sections 3.3, 3.4), and `API-Spec.md` (`#12–17`):

1. **Page Metadata & Isolation (`app/q/[token]/page.tsx`):**
   - Force `robots: { index: false, follow: false }` and `referrer: 'no-referrer'`.
   - Do NOT render Plausible Analytics or language auto-redirects that strip `/q/[token]`. Provide a clean local EN / 简体中文 display toggle strictly inside the viewer state.
   - Fetch quotation via `GET /v1/public/quotation/token/:token` (`#12`). Handle `404 RESOURCE_NOT_FOUND` and `409 QUOTATION_VERSION_CONFLICT` (superseded by newer version — display guidance to check latest email/WhatsApp link) cleanly.

2. **Quotation Document View (`components/quotation/QuotationViewer.tsx`):**
   - Header: MedAxis Global Pharma verification badge, `quotation_number` + `version_number` badge (`v1`, `v2`), current status badge (`SENT`, `ACCEPTED`, `PAYMENT_RECEIVED`, `DISPATCHED`, `DELIVERED`, `VALIDITY_EXPIRED`, `PAYMENT_EXPIRED`, `DECLINED`), live validity or 5-day reservation countdown timer.
   - Itemized Commercial Table: Available items (`AVAILABLE`) with confirmed packaging unit, quantity, unit price, and line total in quoted currency; clearly mark `UNAVAILABLE` / `SOURCING` lines (`MF-06`) at `0` payable total with admin availability note.
   - Summary: Freight, insurance, Incoterms, grand total, and official Bank Wire Transfer instructions (visible prominently once `ACCEPTED` or as quotation terms). Zero internal cost or margin fields exist.

3. **Buyer Actions & WeChat Guard (`components/quotation/BuyerActions.tsx`):**
   - **1. 1-Click Accept Order (`BD-001` — No OTP):**
     - Requires ticking commercial terms confirmation checkbox (`terms_accepted: true`), no OTP/SMS gate.
     - Calls `POST /v1/public/quotation/accept/:token` (`#13`). Handles `200` (transitions smoothly to Accepted state with Proforma download & 5-day reservation notice), `403 QUOTATION_TOKEN_EXPIRED`, `409 QUOTATION_VERSION_CONFLICT`, and `500` (*"We couldn't confirm your acceptance. Please try again."* keeping button re-enabled).
   - **2. Download PDF / Proforma Invoice (`GET /v1/public/quotation/pdf/:token` `#17`):**
     - Detect WeChat in-app browser via `navigator.userAgent` matching `MicroMessenger` (`Architecture.md` 3.4).
     - If WeChat UA detected: hide direct download trigger and display prominent bilingual instruction toast/banner: *"To download PDF, tap ··· → Open in Browser."* (and Chinese equivalent).
     - Otherwise trigger file download cleanly (automatically serves `"ACCEPTED / PROFORMA INVOICE"` PDF after acceptance).
   - **3. Chat / Negotiate on WhatsApp / WeChat:**
     - WhatsApp deep link pre-filled with `Hello MedAxis Global Pharma, regarding Quotation {quotation_number} (v{version_number})...` + WeChat ID / QR code modal.
   - **4. Request Modification (`#14`), Request Refreshed Quote (`#15`, shown when expired), & Decline with Reason (`#16`):**
     - Clean modal dialogs posting structured feedback/reasons and updating viewer state immediately on confirmation.
```

### Verification Gate
- `/q/[token]` sets `<meta name="robots" content="noindex, nofollow">` and `<meta name="referrer" content="no-referrer">`.
- Simulating `MicroMessenger` User-Agent hides the PDF download button and shows the "tap ··· -> Open in Browser" guide.
- 1-Click Accept requires terms checkbox (no OTP), calls `#13`, handles `500` by re-enabling button, and transitions cleanly on `200` to show 5-day reservation & Proforma Invoice actions.

---

## Step 6 — Super Admin Auth (`/admin/login` + 2FA), Protected Shell, Live SSE Alerts & Dashboard

**Goal:** Build `/admin/login` (Argon2id + TOTP 2FA + single-use backup code break-glass), `/admin/layout.tsx` session guard with 30-min idle protection, real-time SSE alert stream (`/v1/admin/stream`), and the KPI Dashboard (`/admin/dashboard`).

### Prompt
```text
Implement **Step 6: Super Admin 2FA Login, Protected Layout, SSE Stream & Dashboard** inside `frontend/app/admin/` and `frontend/components/admin/` matching `PRD.md` (Sections 2.2, 2.3, 3.4), `Architecture.md` (Sections 3.5, 3.6, 4), and `API-Spec.md` (`#18–25`, `#50`):

1. **Two-Step Admin Login (`app/admin/login/page.tsx`):**
   - Step 1: Email + Password form calling `POST /v1/admin/auth/login` (`#18`, `credentials: 'include'`). Never hash client-side; send plaintext strictly over HTTPS.
   - Step 2: 6-digit TOTP input calling `POST /v1/admin/auth/verify-totp` (`#19`), plus a toggle link **"Use Single-Use Recovery Backup Code"** calling `POST /v1/admin/auth/verify-backup-code` (`#20`).
   - Show clear lockout message with remaining wait guidance when backend returns `403 ACCESS_DENIED` after 5 failed attempts.

2. **Protected Admin Layout & SSE Alert Hook (`app/admin/layout.tsx`, `hooks/useAdminStream.ts`):**
   - Protect all `/admin/*` pages (except `/admin/login`): validate active session via backend `/v1/admin/auth/sessions` or profile check; redirect to `/admin/login` on `401 AUTHENTICATION_REQUIRED`.
   - Connect `EventSource` (`withCredentials: true`) to `/v1/admin/stream` (`#50`) with exponential backoff reconnect (`API-Spec.md` 1.6).
   - Display non-intrusive live toast notifications + sound/badge counter on `NEW_RFQ`, `QUOTATION_ACCEPTED`, and `CLARIFICATION_REPLY` events.
   - Provide topbar quick-actions: live SSE connection indicator badge, active session indicator, and **Logout** (`#24`).

3. **Admin Dashboard (`app/admin/dashboard/page.tsx`):**
   - Fetch summary queues via `GET /v1/admin/rfqs` (`#25`) and `GET /v1/admin/fx-rates` (`#45`).
   - Display:
     - Operational Status Cards (`Submitted RFQs`, `Need Clarification`, `Quoted / Pending Decision`, `Accepted / Awaiting Payment`, `Ready to Dispatch`).
     - Expiring 5-day stock reservations alert list (urgent highlight).
     - Live FX Rate widget showing current BDT conversions (`USD`, `CNY`, `EUR`) and warning banner if stale/manual mode is active (`EH-06`).
     - Recent RFQ & Acceptance activity feed updating live via SSE.
```

### Verification Gate
- Navigating to `/admin/dashboard` unauthenticated redirects immediately to `/admin/login`.
- Completing Step 1 password does NOT grant dashboard access until Step 2 TOTP (or valid backup code) succeeds.
- Triggering a simulated SSE `NEW_RFQ` or `QUOTATION_ACCEPTED` event renders an instant alert toast in the admin UI.

---

## Step 7 — Admin RFQ Triage Queue, Smart Fast-Quote Builder & 3-Step Fulfillment Console

**Goal:** Build `/admin/rfqs`, prescription inline secure viewer, Smart Fast-Quote console (`/admin/quotations`), versioning UI (`v1`/`v2`), and the embedded 3-step offline fulfillment panel (`PAYMENT_RECEIVED` -> `DISPATCHED` -> `DELIVERED`).

### Prompt
```text
Implement **Step 7: Admin RFQ Queue, Fast-Quote Builder & 3-Step Fulfillment UI** inside `frontend/app/admin/rfqs/` and `frontend/app/admin/quotations/` matching `PRD.md` (Sections 3.3, 3.4, 4.2, 4.3), `Architecture.md` (Sections 3.3, 3.10), and `API-Spec.md` (`#25–38`, `#45`):

1. **RFQ Queue & Triage Workspace (`app/admin/rfqs/page.tsx` & `[id]/page.tsx`):**
   - Filter tabs by RFQ status (`SUBMITTED`, `UNDER_REVIEW`, `NEED_CLARIFICATION`, `QUOTED`, `CONVERTED`, `CLOSED`, `CANCELLED`), buyer type (`B2B`/`B2C`), and search box (`#25`).
   - Detail view (`#26`):
     - Immutable `contact_snapshot`, destination country, locale (`zh-CN` / `en`), and customer link.
     - **Prescription Secure Viewer:** Fetch & preview decrypted image/PDF inline via authenticated fetch/blob to `GET /v1/admin/prescriptions/:id/stream` (`#32`), never exposing any public CDN link.
     - **Line-Item Availability Control (`MF-06`):** Per line item, dropdown for `AVAILABLE | UNAVAILABLE | SOURCING` (`PATCH /v1/admin/rfqs/:id/items/:itemId` `#27`). Highlight uncatalogued items (`MF-01`) with a **"Create Catalog Product"** shortcut button.
     - **Actions:**
       - *Request Clarification* modal (`#29`) -> enters questions & dispatches threaded email, displaying chronological `clarification_messages` thread.
       - *Unable to Supply* modal (`#30`) -> structured reason (`MF-09`), transitions to `CLOSED`.
       - *Internal Notes* composer (`#31`) -> private admin notes log.
       - **Create Fast-Quote** button -> launches Fast-Quote Builder pre-bound to this RFQ's available lines.

2. **Smart Fast-Quote Builder & Quotation Manager (`app/admin/quotations/`):**
   - Load current FX rates (`#45`); display warning banner if FX service is using cached/manual fallback (`EH-06`: *"Live rates unavailable — using last cached rates from [timestamp]."*).
   - Line builder: for each `AVAILABLE` item, Admin enters **`procurement_cost_bdt`** and **`markup_percent`** (plus Freight, Insurance, Quote Currency `USD|CNY|EUR|BDT`, Incoterms, Validity Date, Bank Wire template from `platform_settings`).
   - **Server-Computed Totals (`Architecture.md` 3.3):** Save draft via `POST /v1/admin/quotations/draft` (`#33`) and display server-returned quoted unit prices, line totals, BDT margin preview, and grand total — never rely on independent client pricing math as authoritative.
   - **Issue / Revise / Resend Actions:**
     - *Issue & Send Quote* (`POST .../send` `#34`) with confirmation modal showing locked FX warning (`BD-005`) and displaying one-time copyable Magic Link URL alongside confirmation that email + PDF generation queued.
     - *Create Revision (`v2+`)* (`POST .../revise` `#35`): clearly warns that previous `SENT` version will be atomically `SUPERSEDED`.
     - *Rotate & Resend Link* (`POST .../resend` `#36`).
   - Full version history inspector (`GET /v1/admin/quotations/:id` `#37`) showing isolated `quotation_internal_costs` (admin-only badge) vs buyer-visible snapshot.

3. **3-Step Offline Fulfillment Console (inside Quotation Detail):**
   - Linear action bar matching current state (`PATCH /v1/admin/quotations/:id/fulfillment` `#38`):
     - If `ACCEPTED`: show 5-day reservation countdown + **"Mark Payment Received"** form (wire reference number, received amount, currency).
     - If `PAYMENT_RECEIVED`: show **"Mark Dispatched"** form (Courier e.g. DHL/FedEx/Aramex + AWB Tracking Number).
     - If `DISPATCHED`: show **"Mark Delivered"** confirmation button.
     - If `DELIVERED`: show read-only archived completion timeline.
```

### Verification Gate
- Admin can triage an uncatalogued RFQ line, mark an unavailable item `UNAVAILABLE`, build a draft via `#33`, see isolated `procurement_cost_bdt` + margin on admin view while verifying `#12` (Magic Link viewer) receives zero cost data.
- Sending quote `#34` locks FX and displays Magic Link; creating revision `#35` marks `v1` `SUPERSEDED`.
- Fulfillment transitions strictly enforce `ACCEPTED -> PAYMENT_RECEIVED -> DISPATCHED -> DELIVERED`.

---

## Step 8 — Admin Catalog CRUD, Bulk CSV Import, Customers, Settings, Audit Logs & Verification

**Goal:** Complete `/admin/catalog` (with R2 image upload & CSV dry-run import), `/admin/customers`, `/admin/settings` (FX, platform settings, 2FA/sessions), `/admin/audit-logs`, and run the final Release 1 frontend verification suite.

### Prompt
```text
Implement **Step 8: Admin Catalog, CSV Bulk Import, Customers, Settings, Audit Logs & Frontend Verification** inside `frontend/app/admin/` matching `PRD.md` (Sections 2.3, 3.1, 3.4, 8), `Architecture.md` (Section 4), and `API-Spec.md` (`#39–52`, `#21–23`):

1. **Catalog Manager (`app/admin/catalog/page.tsx`):**
   - Tabbed workspace for **Products**, **Manufacturers** (`BD-003` — active licensed manufacturers only), **Generics**, **Categories**, and **CMS Banners**:
     - Product form (`#39`, `#40`): Bilingual fields (`en` and `zh-CN` titles, slugs, descriptions, SEO titles/meta), `sku`, `manufacturer_id` selector, `generic_id` selector, multi-category `category_ids`, `cold_chain_required` toggle, `storage_condition`, `prescription_required`, `status` (`DRAFT | PUBLISHED | ARCHIVED`), image uploader to R2. Warn on slug change that an automatic `301` redirect will be created.
     - **Bulk CSV Import Wizard (`#41`):** Upload `.csv` -> execute **Dry-Run (`dry_run=true`)** first -> render row-by-row validation table (errors highlighted by row & column) -> enable **"Commit Import"** (`dry_run=false`) only once dry-run passes.

2. **Customer Directory (`app/admin/customers/page.tsx`):**
   - Searchable B2B & B2C directory (`#47`) and customer profile drawer/page (`#48`) showing contact details, buyer type, WhatsApp/WeChat IDs, and lifetime RFQ + Quotation history timeline.

3. **Settings, Security & Audit Logs (`app/admin/settings/page.tsx`):**
   - **Platform Settings (`#51`, `#52`):** Edit allowed packaging units, bank wire transfer instructions, default shipping/Incoterms presets, and default quote validity days.
   - **FX Rate Management (`#45`, `#46`):** Inspect live BDT rates (`USD`, `CNY`, `EUR`), edit Manual Fixed Rates, and toggle `LIVE` vs `MANUAL` active mode per currency.
   - **Security & 2FA Console (`#21`, `#22`, `#23`):** Setup/Re-enroll TOTP 2FA (display QR code + one-time modal of 8 downloadable backup codes), list active sessions (masked IP, GeoIP city/country, user agent, last active), and **"Revoke All Other Sessions"** button.
   - **Audit Logs Viewer (`/admin/audit-logs` or Settings tab, `#49`):** Filterable, read-only chronological table of immutable security and commercial events (`actor`, `action`, `entity`, `request_id`, `timestamp`).

4. **Release 1 End-to-End Verification (`frontend/tests/`):**
   - Add Playwright / Vitest tests verifying:
     1. Bilingual routing (`/en` vs `/zh-CN`) + `medaxis_locale` cookie override + reciprocal `hreflang` & `x-default`.
     2. Zero public pricing across `/products`, `/products/[slug]`, `/manufacturers/[slug]`, and `/generics/[slug]`.
     3. Quick Quote + Cart RFQ submission + `idempotency_key` handling + `zh-CN` email requirement.
     4. Magic Link `/q/[token]` 1-Click Accept (no OTP) + WeChat UA PDF guard.
     5. Admin 2FA login, Fast-Quote margin isolation, fulfillment step buttons, and CSV dry-run import UI.
```

### Verification Gate
- `npm run build` (`next build`) and `npm run typecheck` succeed cleanly with zero TypeScript errors.
- All Playwright / Vitest verification checks pass against local/test API mocks or staging server.
- Zero external Google scripts/fonts (`googleapis.com`, `google-analytics.com`, `recaptcha`) exist in bundled HTML or network requests.

