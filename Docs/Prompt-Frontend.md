# MedAxis Global Pharma — Step-by-Step Frontend Implementation Prompts (Release 1)

**Target Stack:** Next.js 15.5.29 (App Router, SSR/SSG/ISR) · TypeScript · Tailwind CSS · `next-intl` · Cloudflare Turnstile · Plausible Analytics (GFW-safe)
**Canonical Source Specifications (Single Source of Truth):**

- [PRD.md](PRD.md) — User journeys, bilingual SEO (`en` & `zh-CN`), Zero Public Pricing, `BD-001` to `BD-005`, UI workflows & acceptance criteria
- [Architecture.md](Architecture.md) — `frontend/` folder structure (Section 4), i18n/SEO service (Section 3.7), deployment standards (Section 7)
- [API-Spec.md](API-Spec.md) — REST contract consumed via Express backend (`NEXT_PUBLIC_API_BASE_URL`), custom error envelope handling, client retry rules

> **How to Use This File:** Steps **1–6 have local frontend implementations**; owner review and live deployment checks remain pending. Step 6 deliberately covers the supported RFQ/FX console only: the owner deferred missing summary metrics. Real Express/MongoDB integration and deployed proxy/PDF/challenge verification remain release gates. Local browser tests use controlled API transports. Continue with **Steps 7–8** only when instructed and preserve the relevant verification gates. Strictly **never** query MongoDB or Cloudflare R2 directly from Next.js — communicate **only** through the Express `/v1/*` REST API.

---

## Current Baseline and Reference Design — 16 November 2026

Steps **1–6 have local frontend implementations**. Their original prompts below are historical scope; do not bootstrap them again. Owner review and live backend integration remain pending. Step 2A applies the palette, Step 3 adds catalog/entity/services routes, Step 4 adds RFQ/upload clients, Step 5 adds an independent private quotation viewer and Step 6 adds independent admin auth/transport, RFQ/FX reads and SSE while retaining the earlier contracts. Aggregate dashboard metrics remain pending by explicit owner decision.

PRD defines business/security rules, Architecture defines boundaries, and API-Spec plus the mounted backend routes/validators define wire contracts. Record and resolve discrepancies rather than inventing an endpoint, field or clinical claim. The dependency register applies to every remaining prompt.

Extend these existing building blocks:

- Next.js **15.5.29**, React 19, Tailwind 4, strict TypeScript, next-intl, Vitest and Playwright. Retain the lockfile and generated TypeScript settings.
- `lib/{api-client,api-config,public-catalog,cart,seo,locale-navigation,public-config}.ts`; `components/layout/{CartProvider,LocaleSwitcher,PublicShell,Header,Footer,ContactDialog,Modal,PublicAnalytics}.tsx`; `components/home/{Hero,HeroArtwork,SourcingTiles,Categories,ProductCard,ProductActions,Announcements}.tsx`. ContactDialog needs only next-intl and contact props, without public shell/cart/analytics providers.
- `buildLocalizedMetadata` takes full locale-prefixed counterpart paths. Preserve page-owned metadata, `alternateLinks:false`, URL-governed languages, the 365-day preference cookie, `skipMiddlewareUrlNormalize` and original-host redirects.
- Step 4 uses `components/rfq/{RfqDialog,CartDrawer,PrescriptionUpload}.tsx`, `hooks/useRfqSubmission.ts` and `lib/{rfq,prescription-upload}.ts` with the existing cart/shell. Quick Quote and cart submit the nested contract; **Add to RFQ list** remains a separate local action. Intent/recovery and contact/file state stay in memory. Confirmed cart submissions remove submitted quantities while preserving newer additions.
- Step 5 uses `app/q/{layout,not-found}.tsx`, `app/q/[token]/page.tsx`, `components/quotation/` and `lib/quotation.ts`. Its root layout is independent of public shell/cart/analytics. Private customer DTOs, exact server monetary strings, local display language, terms-confirmed acceptance, guarded non-idempotent decisions and private PDF downloads share existing API/contact helpers. The API client forces no-store/no-referrer for quotation operations.
- Step 6 uses `app/admin/`, `app/api/admin/[...path]/route.ts`, `components/admin/`, `hooks/useAdminStream.ts` and `lib/admin-*.ts`. The fixed-origin Node BFF maps opaque cookies; Edge page responses relay renewal cookies and every sensitive server read independently consults Express. Forward signed cookie bytes from raw headers: Next's `cookies()` decodes percent escapes. Protected navigation performs a fresh document request. The console shows actual RFQ pagination and FX data; missing summary metrics are deferred, not inferred. SSE uses one fetch/reconnect loop, a 40-second heartbeat watchdog and a 55-second BFF connection window beneath the 60-second route limit.
- Step 3 adds `lib/{catalog-data,catalog-query,catalog-seo}.ts` and `components/catalog/` for shared cards/images, native GET search/filter forms, pagination, directories, hubs, breadcrumbs and services. Complete master pickers are bounded to 12 fully resolved sitemap/profile entries; larger catalogs use paginated directories and slug inputs. Product static generation is bounded and remaining paths are dynamic. No new backend collection endpoint was introduced.
- Official WhatsApp: **+8801560066410**. Owner-supplied WeChat QR: `frontend/public/images/wechat-contact.jpeg`. Preserve its original bytes, aspect ratio and full-size link. WeChat text ID, email and live Plausible settings remain configurable; do not manufacture them.

### Reference-Inspired Palette

The supplied pharmacy screenshot guides color, hierarchy and spacing. These are visually selected approximations for MedAxis, not exact pixel samples. [Open the palette board](Frontend-Design-Palette.svg).

| Semantic token | Hex | Use |
|---|---|---|
| `--color-brand` | `#18BCD6` | Cyan accents, icons and highlights; navy foreground. |
| `--color-action` | `#087A90` | Primary buttons with white text. |
| `--color-ink` | `#223846` | Navy contact strip, headings, body text, dark sections. |
| `--color-muted` | `#526777` | Secondary text on light surfaces. |
| `--color-hero` | `#A2E5F2` | Wide light-cyan hero, navy text. |
| `--color-brand-soft` | `#DFF7FC` | Search/filter panels and cyan callouts. |
| `--color-surface` | `#FFFFFF` | Header, cards, forms and dialogs. |
| `--color-page` | `#F5F7F9` | Alternating sections/catalog background. |
| `--color-border` | `#DCE6EC` | Subtle dividers; stronger action outline for focus. |
| `--color-pastel-blue` | `#DCECF4` | Manufacturer sourcing tile. |
| `--color-pastel-pink` | `#FBE6EE` | Patient/caregiver enquiry tile. |
| `--color-pastel-mint` | `#E4F2D7` | Handling/documentation tile. |
| `--color-pastel-yellow` | `#FFF4CC` | RFQ guidance tile. |

Calculated contrast: navy/brand cyan **5.34:1**, white/action cyan **5.00:1**, muted/white **5.89:1**. White/bright cyan is only **2.28:1**: do not use that pair for small text. Verify actual text, hover, focus and disabled combinations after implementation. Status also needs text/icon labels, not color alone.

### Adapting the Reference

- Reuse its compact navy contact strip, white navigation, spacious cyan hero/search hierarchy, pastel feature tiles, circular category artwork and clean product grid.
- Replace retail promotions with manufacturer sourcing, patient enquiries, cold-chain handling and documentation guidance. Use **Add to RFQ list**, **Request Quick Quote** and **View product** rather than Buy/Shop/Checkout.
- No public prices, discounts, crossed-out amounts, sale percentages, invented ratings/product counts, appointment booking or online payments. Reference categories such as devices/wellness are not automatically MedAxis catalog categories.
- Use real supplied packaging/manufacturer assets, self-hosted licensed imagery or clearly decorative illustrations. Do not copy another site's logo/photos or fabricate cGMP/WHO-GDP endorsements, clinical review dates, inventory or dispatch SLAs.
- Retain English/Chinese, system/self-hosted CJK fonts, mobile navigation, accessible dialogs and the original WeChat QR. No Google-blocked runtime dependencies.
- Target a centered 1200px content area, generous spacing, 8–12px card corners and 44px touch targets. Adapt grids across 320px phones, tablets and desktop. Do not crop identifying medicine labels into unreadable category circles.
- Default to one meaningful static hero. A supplied multi-slide campaign needs manual/keyboard controls and reduced-motion support, not mandatory autoplay.
- Reuse the tokens for catalog, RFQ, token viewer and admin, while retaining independent layouts. Commercial documents and dense admin tables do not need public promotional decoration.

### Step 1–2 Audit: Required Changes

| Area | Finding | Action |
|---|---|---|
| Step 1 foundation | Routing, envelopes, retry bounds, SEO, strict TypeScript already work. | Retain them; a color adaptation requires no reinstall, framework upgrade or database access. |
| Theme | Previous green/teal variables plus hardcoded green values. | Resolved in Step 2A: Tailwind 4 semantic palette covers header, hero, buttons, hover/focus, cards, badges, forms, drawer and footer. |
| Shell/home | Existing branding, contact modal, data-backed cards and section links work. | Resolved in Step 2A: extracted Header/Footer/Hero/ProductCard/ContactDialog, adapted composition and retained existing context APIs. Category/manufacturer names come only from the published product preview. |
| Search/navigation | Reference-style search and destination routes were pending after Step 2A. | Resolved in Step 3: native GET search, listing/filter/pagination, profile hubs/directories and services are implemented; header/home links now use real routes. |
| Homepage data | Backend exposes published products, not featured/best-seller/promotion selectors. | Keep the published preview and real master data; never send `featured=true`. |
| Cart/Quick Quote | Shared local list plus Step 4 nested RFQ submission, intent recovery and optional upload clients exist. | Preserve context APIs and stored items. A local add remains distinct from a confirmed enquiry. |
| Public credentials | Catalog/public JSON omit credentials; uploads include them and RFQ opts in only when it carries prescription IDs. | Retain the narrow ownership flow, same-site origins and credentialed CORS; never persist the HttpOnly cookie. |
| Private layouts | Public root is under `[locale]`; `/q` and `/admin` have independent private roots. | Preserve isolation from public shell/cart/analytics, private/no-store responses and non-indexed metadata. |
| Admin auth | Express remains the sole session authority; its cookie paths are `/v1/admin` and `/v1/admin/auth`. | Step 6 maps full/pre-auth cookies to frontend `/` and `/api/admin/auth` respectively; signed bytes, HttpOnly, Strict and production Secure remain intact. Each protected read forwards only the full cookie and validates through Express. |
| Regression coverage | Metadata, cookie/root reload, original-host redirects, HTML/DOM/RSC price exclusion and QR integrity are tested. | Preserve checks; do not weaken behavior assertions to accommodate a redesign. |

### Backend Contract and Dependency Register

A proposed extension here is **not an implemented endpoint**. Complete its backend/API-Spec contract and integration tests before wiring dependent UI. Proceed with independent work while a dependency is unresolved; do not report mock-only behavior as a completed live feature.

| Contract | Actual behavior / consequence |
|---|---|
| Public list | `/v1/public/products` accepts `page,limit,locale,q,manufacturer,generic,category,dosage_form,cold_chain=true\|false`. Response is `data.products`, `data.facets`, `meta.pagination`; facets currently expose only `dosage_forms` and `cold_chain`. Unknown query keys are rejected. |
| Master reads | Public detail GETs exist for `/generics/:slug`, `/manufacturers/:slug`, `/categories/:slug`; collection-list GETs do not. A complete directory/picker needs an explicit safe read contract or a bounded, cached sitemap-slug/profile lookup strategy. Masters on one product page are not a complete directory. |
| Clinical fields | Public/product-create DTOs lack `prescription_required` and clinical/technical review timestamps. Do not invent Rx/review badges or relabel `updated_at` as a clinical review. Required PRD review data is a backend prerequisite. |
| Slugs | Sitemap feed returns `{products,generics,manufacturers,categories}` with `{en,zhCN,updated_at}` rows; zhCN may be null. Detail redirects return HTTP 301, Location and `data.redirect`. Do not invent translated URLs. |
| Upload ownership | Upload sets signed `prescription_upload_session`, Path `/v1/public`; both upload and related RFQ must include credentials. SameSite=Strict requires compatible same-site deployment, consistent local hosts and credentialed CORS. |
| Public packaging units | RFQ intake enforces platform units but no public settings feed exists. Use catalog units and surface custom-unit validation errors; do not expose admin settings to obtain a dropdown. |
| Acceptance | Body is strictly `{terms_accepted:true}`. Acceptance is atomic/idempotent by token/version. API-Spec also requires stable `x-idempotency-key`: send it in the header, not an unsupported body field. Record that current backend acceptance does not enforce this header. |
| Expired quotes | Token GET returns 403 on expired versions, not an expired document. Superseded versions return 409. Build these error/refresh states; an expired-document view needs a safe contract extension. |
| Reference / draft edit | Token DTO returns quotation_id/version_number, not quotation_number. `/draft` creates a new quote; `/revise` requires SENT. No edit-existing-DRAFT mutation exists. Business-number display/autosave require explicit corresponding contracts. |
| Decision delivery / receipts | Revision/refresh have neither idempotency nor a customer receipt/status read. A local Edge bare-TCP-reset experiment observed one JavaScript POST being delivered twice by the browser/network layer. Step 5 disables application retries and locks uncertain resends; GET cannot prove whether a revision/refresh request committed. Exactly-once delivery and automatic reconciliation require a registered backend deduplication + safe receipt contract; do not invent one in the frontend. |
| Admin reads | Product/master/CMS writes exist, but authenticated product list/detail, complete master lists and CMS list/detail GETs do not. Full browse/edit/DRAFT management needs these reads; a just-created write response is not a complete manager. |
| Dashboard/quote list | No aggregate dashboard or quotation collection-list GET exists. The owner explicitly chose the current RFQ/FX console with summary metrics pending. RFQ status totals do not prove accepted/dispatch/expiring-allocation counts. Those panels require registered read/summary contracts. RFQ detail does expose quotation IDs for existing detail navigation. |
| Extra implemented writes | POST `/v1/admin/catalog/images` uses multipart `image`; POST `/v1/admin/cms/banners` uses JSON. They exist in code despite omission from the old master endpoint index; document their contracts when integrating. |
| Settings/FX | Settings GET returns keyed `{value,updated_at}` records. FX modes are `LIVE\|MANUAL_FIXED`; amounts/rates are decimal strings. Respect actual shipping enums and fixed five-day reservation. |
| Spec inconsistencies | PRD labels locked FX BD-004 while Architecture also uses BD-005; preserve behavior, not a mistaken label. Auth README records a backup-code/email-confirmation discrepancy: do not invent an email verification endpoint. |
| Sitemap structure | Current Step 1 combined urlset follows its explicit prompt; PRD §7 specifies an index plus entity maps. Step 8 deliberately migrates the structure and related tests. |

Code references: [catalog routes](../backend/src/modules/catalog/catalog.routes.ts), [catalog validators](../backend/src/modules/catalog/catalog.validator.ts), [public DTOs](../backend/src/modules/catalog/catalog.dto.ts), [RFQ validators](../backend/src/shared/validators/rfq.validator.ts), [RFQ routes](../backend/src/modules/rfq/rfq.routes.ts), [quotation validators](../backend/src/shared/validators/quotation.validator.ts), [decision validators](../backend/src/shared/validators/decision.validator.ts), [commercial DTO](../backend/src/modules/quotation/quotation.dto.ts), [auth routes](../backend/src/modules/auth/auth.routes.ts), [cookie guard](../backend/src/shared/middleware/adminAuth.ts), [admin stream](../backend/src/modules/admin/admin.stream.ts), [admin reads](../backend/src/modules/admin/admin.operations.ts), [settings](../backend/src/modules/settings/settings.service.ts).

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
| **Step 2A** | Reference palette adaptation of the existing shell/homepage | Reuse existing `#01`, `#07`; no new endpoint |
| **Step 3** | Public Product Listing, Search/Facets, Product Detail & Generic/Manufacturer/Category Hubs (SSG + ISR, Zero Prices) | `#01`, `#02`, `#03`, `#04`, `#05` |
| **Step 4** | Dual RFQ Flows: 10-Second Quick Quote Modal, Persistent RFQ Cart, Encrypted Prescription Upload & Turnstile | `#08`, `#09`, `#10` |
| **Step 5** | Magic Link Quotation Viewer (`/q/[token]`), WeChat UA PDF Guard, 1-Click Atomic Accept & Buyer Actions | `#12`, `#13`, `#14`, `#15`, `#16`, `#17` |
| **Step 6** | Same-origin cookie/BFF transport, two-factor auth, protected shell, SSE and supported dashboard reads | `#18–24`, `#25`, `#50` (`/admin/stream`) |
| **Step 7** | Admin RFQ Queue, Prescription Secure Viewer, Smart Fast-Quote Builder & 3-Step Fulfillment Console | `#25–38`, `#45` |
| **Step 8** | Registered admin reads/writes, CMS/CSV, customers/settings/audit, sitemap index and release verification | `#39–52` plus documented prerequisite reads |

---

## Step 1 — Next.js Bootstrap, `next-intl`, Edge Middleware, 301 Redirects, Sitemap & API Client

**Status: Implemented historical scope.** Preserve the foundation; use the audit/current contract register for subsequent changes.

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

**Status: Implemented historical scope.** Step 2A adapts its visual design. The live homepage uses a published preview rather than a nonexistent featured endpoint.

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

## Step 2A — Adapt the Existing Shell to the Reference Design

**Status:** Implemented locally, awaiting owner review. Steps 1–2 remain the functional baseline. Production build/typecheck, 131 unit tests and 20 Playwright checks pass against the isolated API fixture. English/Chinese screenshots cover desktop, 768px, 390px and 320px. Live search and real RFQ submission remain Steps 3 and 4 respectively.

### Prompt

```text
Implement Step 2A in the existing frontend. First read the Current Baseline, Reference-Inspired Palette, Step 1–2 Audit and Backend Contract Register in Docs/Prompt-Frontend.md, plus PRD §1.3/§3.1/§7 and Architecture §3.7/§4.

1. Map documented colors to app/globals.css and Tailwind 4 @theme aliases. Replace hardcoded green values in header, hero, cards, buttons, hover/focus, form, drawer and footer states. Preserve current component/context APIs until every caller is deliberately migrated. Use navy on bright cyan and white on the darker action cyan.
2. Restyle PublicShell with a navy contact strip, white navigation, English/Chinese switcher, live RFQ badge and Request Quick Quote CTA. Keep working homepage anchors until Step 3 creates destination routes. Make controls keyboard/touch accessible at 320px.
3. Adapt the homepage to the spacious cyan hero, restrained medical imagery, four pastel sourcing/enquiry tiles, circular therapeutic category artwork and white product cards on light gray. Use actual CMS/product/master data. No retail prices, discounts, ratings, appointment controls, invented categories or sales statistics.
4. Extract focused Header/Footer/Hero/ProductCard/ContactDialog components where useful. ContactDialog must later work without public shell, cart or analytics providers. Preserve official WhatsApp, the original WeChat JPEG/full-size link and Chinese-first contact order.
5. Preserve cart storage, duplicate merging, custom requirements and current local Quick Quote behavior. Step 4 adds real submission. Preserve metadata, locale cookie, original-host redirects, private headers and conditional Plausible.
6. Keep hero buttons functional through existing anchors/Quick Quote. Step 3 adds live search once its destination exists. Do not ship a decorative search box or compulsory autoplay carousel.
```

### Verification Gate

- Existing typecheck/build and relevant unit/browser checks pass, including EN/ZH metadata, 365-day cookie/root reload, original-host redirects, HTML/DOM/RSC price exclusion and WeChat byte integrity.
- Check both languages at desktop, 768px, 390px and 320px, with no overflow/clipped controls; verify contrast, focus, dialogs, touch targets and reduced motion.
- Compare screenshots against the reference's hierarchy using MedAxis content/RFQ actions. Storage and backend fetch behavior survive the visual adaptation.

---

## Step 3 — Searchable Catalog, Product Detail and Bilingual SEO Hubs

**Goal:** Turn the reference's search/category/product presentation into a working zero-price catalog.

**Status:** Implemented locally, awaiting owner review. Strict typecheck/build, 161 unit tests and 32 production browser checks pass against isolated REST/asset fixtures. Live production data/asset availability remains a deployment verification concern; actual RFQ submission is Step 4.

**Sources:** PRD §1.3/§3.1/§7; Architecture §3.1/§3.7/§4; API-Spec §3; catalog routes, validators and DTOs.

### Prompt

```text
Implement Step 3 in frontend/app/[locale]/ and components/catalog/. Apply the shared palette/TypeScript rules and contract register. Extend existing cart, shell and API helpers; do not bootstrap another app or duplicate product/cart state.

1. Extend allowlisted public runtime schemas for specifications, translations, image_urls, storage_condition, descriptions, alternate_slugs, actual facets and meta.pagination. URLs use locale=zh-CN; translation/alternate JSON keys use zhCN. Normalize id versus admin _id only at validated adapter boundaries. Unknown prices, costs, margins and admin fields must never reach HTML, client props, RSC or JSON-LD.
2. Build /[locale]/products from GET /v1/public/products. Send only page,limit,locale,q,manufacturer,generic,category,dosage_form,cold_chain=true|false. Omit empty filters, encode values, reset page on filter changes and use meta.pagination totals. Limit <=100. No arbitrary sort, featured, price, rating or Rx query keys.
3. Add a reference-style homepage GET search -> /[locale]/products?q=...&category=.... Support keyboard submission, URL state, clear/reset and loading/empty/error states. Manufacturer/generic/category values are localized slugs, not UUIDs. Actual facets are dosage_forms[{name,count}] and cold_chain[{required,count}]. A complete picker requires the registered option data; never present one page's masters as the complete directory.
4. Reuse ProductCard on homepage/catalog/hubs: real image, brand, generic, strength/form, pack size, manufacturer and true cold-chain label. Display Availability on enquiry, not fabricated stock. Keep explicit image dimensions/aspect ratios, localized alt text, asset allowlisting and meaningful fallback. Add to RFQ list uses existing CartProvider with actual product ID/unit and positive safe-integer quantity; Quick Quote uses the existing shell action.
5. Empty search opens uncatalogued Quick Quote prefilled with the query, without a fake product ID. Preserve the current list; submission comes in Step 4.
6. Build /products/[slug] from GET /v1/public/products/:slug?locale=.... Use published sitemap slugs for bounded generateStaticParams, allow dynamic paths and tag ISR reads with catalog. Render actual image/specification/storage/indication data, linked manufacturer/generic/category and RFQ controls. Sanitize permitted rich content; never blindly insert network HTML.
7. generateMetadata uses exact alternate_slugs and buildLocalizedMetadata: self-canonical, reciprocal counterparts and exact English entity x-default. Extend helper/types intentionally for missing zhCN: no invented slug or translated hreflang, retain direct-URL integrity, and noindex untranslated fallback content rather than pretending it is an indexable translation.
8. Handle detail API 301 + validated Location via the existing redirect resolver. Do not turn it into a generic network-retry loop, false 404 or open redirect. Keep actual HTTP 301 in middleware; do not report Next's 308 as a 301.
9. Public Product/MedicalEntity JSON-LD describes actual identity/manufacturer/specifications only: no Offer, price, priceCurrency, ratings, invented certification or clinical review. Rx-required and review-date badges wait for their registered backend fields; updated_at is not medical review.
10. Build /generics/[slug], /manufacturers/[slug] and /categories/[slug] from existing detail GETs, supported locale/query pagination, actual profiles and product arrays. Show certifications only when supplied; related products/ingredient overviews are not substitution advice.
11. Build /services and /services/pharmaceutical-sourcing using supplied sourcing, cold-chain and documentation capabilities; no unsupported GDP guarantees, universal import claims or dispatch SLAs. Replace header/home anchors with real routes only when destinations exist. Optional directories may use bounded, cached sitemap-slug/profile lookup for a small catalog; do not fan out over every entity on each request or invent collection GETs.
12. Search/filter permutations use a clean canonical or noindex,follow policy. Add only actual canonical/indexable static routes to the sitemap. Keep utility noindex pages, private tokens, prescriptions, PDFs, admin/APIs and search permutations excluded. Preserve existing webhook/tag contracts.
```

### Verification Gate

- Hero search, supported filters, pagination and clear/reset work; verify 429, empty, malformed JSON, proxy HTML and aborted stale reads.
- Test exact EN/ZH product/hub counterparts, different translated slugs, missing translation and historical 301; no invented field/query/endpoint.
- Zero public monetary/internal fields in HTML, hydrated DOM, standalone RSC and JSON-LD, including adversarial upstream fields. Verify image sizing and measured CLS <=0.1 rather than promising exactly zero.
- Add/merge and uncatalogued search-prefill preserve existing cart behavior and never falsely submit an enquiry.

---

## Step 4 — Real Quick Quote, Cart RFQ, Prescription Upload and Turnstile

**Status:** Frontend implemented locally; typecheck/build, 204 frontend unit tests, 45 production browser checks and 12 backend RFQ unit tests pass. Controlled browser transports cover committed-response loss/replay, fresh intent keys, independent locale/preference/destination validation, challenges, uploads/cookies and analytics/storage privacy. Public request/error log privacy is unit-tested. The existing real Express/MongoDB test additionally checks another upload session's cookie against the first session's prescription. That integration suite previously hit Atlas DNS timeout; automatic approval review rejected its elevated retry because it writes/cleans up a remote test database. The real integration run, deployed Turnstile verification and owner review remain pending. No separate verification report is created.

**Goal:** Replace local-only Quick Quote with complete idempotent RFQ intake, without retail checkout or online payment.

**Sources:** PRD §1.3/§3.2/§4.1; Architecture §3.2/§3.9; API-Spec §1.6/§4; RFQ validators, routes and intake service.

### Prompt

```text
Implement Step 4 in components/rfq/, hooks/useRfqSubmission.ts and existing shell/cart integrations. Apply the palette and contract register. Move/replace the local QuickQuote/CartDrawer deliberately; do not mount competing dialogs or providers.

1. Match the nested transport: idempotency_key; contact{full_name,customer_type,company_name?,email?,whatsapp_number?,wechat_id?,preferred_locale}; destination_country; destination_city_port?; preferred_currency?; locale; items[]; prescription_ids[]; turnstile_token?. customer_type is B2B_WHOLESALE|B2C_PATIENT. Require company for B2B, at least one contact channel, and valid email for Chinese locale/preferred_locale or China destination. Country is uppercase two-letter ISO code.
2. Catalog line: product_id,is_uncatalogued:false,quantity,packaging_unit. Custom line: is_uncatalogued:true,custom_medicine_name,custom_strength?, no product_id. Notes are line_notes, not invented root notes. Quick Quote has one line; Cart RFQ has 1–100. Quantity is a positive safe integer. Use catalog/configured units and surface custom-unit server validation; never read private settings from a public form.
3. Keep contact/form/file/prescription state in memory. Persist only the existing non-sensitive medicine list. Prescriptions remain optional for every buyer and must not block a valid enquiry without attachments.
4. Generate UUID v4 per new submission intent, with identical idempotency_key body and x-idempotency-key header. Freeze the business snapshot on submit; disable duplicate submits synchronously. Automatic retries replay the exact serialized request and key. A timeout/429/500/503 does not authorize a new key or duplicate enquiry. Reconcile uncertain outcomes and 409 IDEMPOTENCY_KEY_CONFLICT before allowing a genuinely new intent.
5. On confirmed 200/201 show actual rfq_number, clear the submitted cart and start a fresh intent. Do not invent a response SLA or call a committed RFQ failed because notification work is delayed.
6. Integrate the configured Turnstile site key and CSP. If header/body tokens are both sent they must match. Never verify with a server secret in the browser or bypass production challenges. On 403 reset/reacquire while preserving inputs and business intent. Backend fingerprinting excludes turnstile_token: deliberate challenge refresh can keep the key, while automatic retries themselves reuse the captured full body.
7. Optional prescription upload: JPEG/PNG/PDF <=5,242,880 bytes; POST /v1/public/prescriptions/upload with multipart file field prescription and optional turnstile_token form field. Browser owns the multipart boundary. Add progress, abort and runtime-validated JSON error handling; uploads have no automatic retry/idempotency contract.
8. Include credentials on upload and related RFQ attachment requests so HttpOnly prescription_upload_session is retained/sent. Current public JSON requests use omit: extend narrowly for this ownership flow. Keep compatible same-site frontend/API origins, consistent local hosts and credentialed CORS. Do not weaken SameSite protection or copy the cookie into localStorage.
9. Keep up to five prescription_ids and preview files in memory; revoke blob URLs and never expose prescriptions via public CDN. Retention copy must match backend: at most 90 days from upload or 14 days after a terminal state, whichever applies first; not 90 days after delivery.
10. Map nested 422 details to inputs; handle 403/429/503 and non-JSON failures safely with localized recovery/request ID. Keep cyan/navy forms concise with progressive optional fields and visible busy/success states. Chinese buyers receive email-link guidance and official WeChat/WhatsApp contact, not automated WeChat notifications.
```

### Verification Gate

- Double-submit/response loss/replay produces one RFQ with the same reference and business payload/key; a later distinct success starts a new key.
- Chinese locale/preference/China destination requires email; B2B requires company. Validation/challenge/retry recovery preserves inputs.
- Verify real upload -> HttpOnly staging cookie -> RFQ attachment, including rejection of another session's prescription. Invalid/spoofed/oversized files fail; no attachment remains valid.
- No contact/medical/challenge/session data in localStorage, analytics or public logs, and no public price display.

---

## Step 5 — Private Quotation Viewer, Decisions and PDF Delivery

**Status:** Frontend implemented locally; strict typecheck/build, 234 frontend unit tests, all 57 browser checks (45 existing regressions plus 12 quotation checks) and 10 backend decision/PDF unit checks pass. The actual backend customer DTO serializer and the frontend network-envelope adapter are tested against poisoned internal fields while retaining customer prices. Controlled private browser checks cover HTML/DOM/RSC isolation, private headers on normal/error responses, response loss/replay, status conflicts, server reservation time, PDF errors, WeChat guidance, token-preserving language/contact controls, QR request referrer omission, original JPEG byte integrity and 320/390/768/desktop layouts. Real MongoDB/R2/PDF delivery integration and owner review remain pending. Browser-level resend/deduplication and missing decision receipts are recorded in the contract register. No separate verification report is created.

**Goal:** Build /q/[token] as an independent commercial document. Authorized customer quotation prices are allowed here; procurement costs/margins never are.

**Sources:** PRD §1.3/§3.3–3.4/§4.3; Architecture §3.3–3.4; API-Spec #12–17; decision validators/commercial DTO.

### Prompt

```text
Implement Step 5 in app/q/ and components/quotation/. Use the palette in a restrained commercial document. Supply an independent root layout; no [locale] wrapper, PublicShell, CartProvider or Plausible. Enforce no-referrer, noindex/nofollow/noarchive and private/no-store HTTP behavior.

1. GET /v1/public/quotation/token/:token with no caching and an allowlisted customer schema, never an admin DTO. Actual money fields are billing_currency,unit_quoted_price,total_line_price,subtotal_amount,freight_cost,insurance_cost,total_amount; dates include valid_until and reservation_expires_at. Preserve decimal strings/server totals.
2. Render actual version_number/status, customer/commercial lines, availability notes/counts and shipping/payment terms. Do not invent quotation_number from quotation_id: register that safe DTO extension before displaying a business number. Unavailable/sourcing rows cannot acquire client-invented payable totals.
3. Handle 404 safely, 409 superseded-version guidance and 403 QUOTATION_TOKEN_EXPIRED with an expired/refresh state. Current GET does not return expired commercial documents. Do not fetch admin data to fill an error state.
4. Local English/简体中文 display state must preserve /q/[token]; no locale prefix redirect. Never put token links, customer/bank information or internal data into analytics, social previews, public storage/logs or third-party referral URLs.
5. Accept: accessible terms confirmation then POST /v1/public/quotation/accept/:token with exactly {terms_accepted:true}. Preserve stable x-idempotency-key in the header per API-Spec, not a rejected body field. No OTP/login/SMS gate. Disable duplicates, reconcile/re-fetch success/conflicts and handle already_accepted. A 500 returns an actionable retry state.
6. Show verified bank wire/proforma details from the authorized DTO. Use server reservation_expires_at; never restart a five-day clock on reload. No online payment gateway or browser recalculation of locked FX/commercial totals.
7. PDF GET /v1/public/quotation/pdf/:token uses a status/content-type-aware blob/stream adapter. JSON before-stream errors use the normal envelope; HTML proxy errors are sanitized; blob URLs are revoked. MicroMessenger hides direct download and shows bilingual tap ··· -> Open in Browser guidance.
8. POST request-revision {notes}, request-refresh {notes?}, decline {reason,notes?}; decline reason PRICE|LEAD_TIME|SPECIFICATION|OTHER. No blanket automatic retries for these non-idempotent decisions; reconcile uncertain outcomes.
9. Reuse the independent contact dialog/pure config with official WhatsApp and original WeChat QR. Optional chat text may include a supplied business reference, not the secret token link by default.
```

### Verification Gate

- Private headers/no analytics/no public providers hold for /q; no procurement/margin/FX-internal/admin-note/token-hash fields in private HTML, DOM, RSC or JSON.
- Correct customer prices remain visible. Accept/replay, expired/superseded states, 500 recovery and server-defined reservation time work.
- PDF/WeChat guidance, safe non-JSON errors, local language toggle and contact QR preserve the token path/privacy.

---

## Step 6 — Admin Cookie Transport, Two-Factor Login, Protected Shell and SSE

**Goal:** Establish real server-side protection before showing admin data, then build a quiet navy/cyan operational console.

**Sources:** PRD §2.2–2.3/§3.4; Architecture §3.5–3.6/§4; API-Spec #18–25/#45/#50; auth README/routes, cookie guard, admin stream/reads.

**Owner scope decision:** Implement the existing RFQ/FX console; leave missing accepted-payment, dispatch, global-quote and expiring-allocation summaries pending. Do not extend the backend or claim the full aggregate dashboard is complete.

### Prompt

```text
Implement Step 6 in app/admin/, app/api/admin/, components/admin/ and hooks/useAdminStream.ts. Read the contract register's cookie/path dependency first. Express remains the auth authority; Next must never create/sign/decrypt its session tokens.

1. Implement an allowlisted Node-runtime same-origin /api/admin/[...path] BFF to the configured Express origin/internal override. Only registered paths/methods, never an arbitrary target URL proxy. Extend the typed client's admin transport so browser logical /v1/admin/* requests use this adapter; public REST still uses its configured base. Preserve JSON validation/retry rules and separate multipart/binary/SSE transports.
2. Forward only needed cookies/headers and approved Origin. Enforce same-origin mutations at the BFF plus the backend boundary. Relay every Set-Cookie separately: map full medaxis_admin_session Path=/v1/admin to frontend Path=/ for /admin SSR, and pre_auth_session /v1/admin/auth to /api/admin/auth. Preserve signed values, HttpOnly, SameSite=Strict, production Secure and frontend host-only scope. Apply identical mapping to renewals/logout/expiry, with no duplicate variants. Never weaken backend security to hide a cookie transport error.
3. Supply an independent dynamic/no-store admin root with private/noindex headers; login must not be trapped in its own guard loop. A protected route group and every sensitive server read validate the incoming full cookie via Express GET /v1/admin/auth/sessions. Pre-auth is insufficient. Forward the cookie deliberately; propagate renewals through route responses, not illegal Server Component cookie writes. Do not rely solely on a layout that may persist across client navigation.
4. Login POST auth/login {email,password} -> requires_2fa; POST auth/verify-totp {code} or auth/verify-backup-code {backup_code} completes MFA with the same pre-auth cookie. No local hashing/storage, no protected content after password alone. Show safe validation/401/403 lockout Retry-After/503 states without automatically retrying auth writes.
5. Bootstrap uses the seeded enrolled authenticator. auth/2fa/enroll is authenticated rotation, not a public first-login bypass. Keep the documented backup-code/email-confirmation discrepancy explicit; do not invent an unsupported verification endpoint.
6. Protected console: navy navigation, cyan active/focus states, white tables, readable statuses/current session and confirmed auth/logout. Respect backend 30-minute inactivity; a client timer may warn/log out but cannot recreate a session. Do not poll merely to defeat inactivity. Backend authorization remains final on every operation.
7. Stream GET /v1/admin/stream through the BFF with credentials, no buffering, no-store and upstream abort on disconnect. Account for hosting duration limits. Runtime-validate NEW_RFQ,QUOTATION_ACCEPTED,CLARIFICATION_REPLY ID/timestamp payloads and refetch affected reads; events do not contain complete contact/cost documents.
8. Backend heartbeat is 25 seconds and initial retry 5000ms. Choose one reconnection mechanism, bounded jitter/backoff, cleanup and re-auth on session loss. No duplicate connections/toasts, no durable replay assumption; refetch on reconnect. Sound is opt-in.
9. Dashboard uses /v1/admin/rfqs with actual filters/meta.pagination totals and /v1/admin/fx-rates. Accepted-payment, ready-to-dispatch, global quote and expiring-allocation counts need the missing registered summary/list contract; never infer them from one RFQ page or static mock numbers. Resolve those reads before declaring the full dashboard complete.
```

### Verification Gate

- Prove login -> pre-auth -> MFA -> mapped full cookie -> server-protected dashboard with actual cookie paths. Forged client state/password-only cookies cannot obtain private HTML/data.
- Test Origin checks, multiple Set-Cookie relay, renewals, logout, revocation, idle expiry and no-store caching across navigation.
- Verify live SSE, malformed data, reconnect/refetch, expiry and logout behind the deployment proxy limits. Dashboard totals use authoritative supported reads; missing summaries remain a release dependency.

**Verification scope:** The owner confirmed there is no staging deployment and explicitly deferred deployed-proxy verification. Local production-runtime checks cover the BFF's actual 55-second stream lifetime under its 60-second route limit, session/cookie boundaries and supported RFQ/FX reads. They do not certify a deployed TLS/CDN/proxy or real Express/MongoDB integration. Missing dashboard summaries remain pending by the earlier owner decision; the full deployment verification gate stays open.

---

## Step 7 — RFQ Triage, Server-Priced Quotations, Versioning and Fulfillment

**Goal:** Build the operational flow around actual backend state transitions and financial precision.

**Sources:** PRD §3.3–3.4/§4.2–4.3; Architecture §3.3/§3.9–3.10; API-Spec #25–38/#45; RFQ/quotation/decision validators and services.

### Prompt

```text
Implement Step 7 in app/admin/rfqs/, admin/quotations/ and components/admin/. Reuse Step 6's auth transport and navy/cyan data UI, without retail sale cards or checkout.

1. GET /v1/admin/rfqs supports page,limit,status,buyer_type,q,date_from,date_to; buyer_type B2B_WHOLESALE|B2C_PATIENT. Use the actual array/pagination. Detail /rfqs/:id exposes immutable contact_snapshot, items, prescriptions, clarification_messages and quotation references; normalize _id/id via typed adapters.
2. PATCH .../items/:itemId uses {item_availability_status,customer_facing_note?}, AVAILABLE|UNAVAILABLE|SOURCING. PATCH .../status {status} offers only allowed transitions. POST request-clarification {body,channel}, unable-to-supply {unable_to_supply_reason}, notes {body}. Preserve buyer requirements and do not invent body keys or editable statuses.
3. Create Catalog Product can prefill from an uncatalogued line; it must not silently rewrite the RFQ association without a supported mutation.
4. Prescription GET /v1/admin/prescriptions/:id/stream uses authenticated BFF, status/type validation and revoked-after-use blob URLs. JPEG/PNG preview and PDF iframe/download stay private. Extend CSP narrowly for self/blob private PDF frames; never disable CSP globally or use public R2 URLs. Handle purged/unavailable files and avoid public/service-worker byte caches.
5. Fast-Quote reads real FX/private settings. Money, percent and rate inputs remain decimal strings; browser Number arithmetic is not authoritative. POST /v1/admin/quotations/draft uses rfq_id,billing_currency,items,freight_amount,insurance_amount,shipping_terms,bank_details?,internal_procurement_notes?. Include every RFQ line once; server owns quantity/packaging.
6. Quote line: rfq_item_id,manufacturer_id,availability_status; AVAILABLE needs per-unit procurement_cost_bdt and markup_percent. UNAVAILABLE needs customer_facing_note and contributes zero money. SOURCING is draft-only until resolved; at least one line is AVAILABLE. Custom lines require snapshot{brand_name,generic_name,strength,dosage_form,pack_size}. Manufacturer pickers depend on registered complete reads, not invented supplier lists.
7. Render response version/fx_preview/server totals. /draft creates a new quote, not an update, and /revise requires SENT: resolve an edit-existing-DRAFT contract before offering autosave/repeat Save draft.
8. POST .../:id/send with expected_version_id and supported validity_days,allow_stale_fx,bank_details. No invented validity_date/client totals. Show actual locked FX and configured bank wire details. /revise requires expected_current_version_id plus validated pricing; current SENT becomes SUPERSEDED atomically. issue_immediately is explicit.
9. /resend uses expected_version_id, rotates the secret token and invalidates the previous link. Show returned magic_link_url only in transient authenticated copy/share UI; do not persist/log it. GET .../:id returns quotation,versions,internal_costs; procurement/markup/margins remain admin-only in a separate schema/components.
10. These admin writes have no blanket retry guarantee. Disable duplicates; after timeout/409 refetch authoritative state/version before manual retry. Do not duplicate issue, revision, resend, import or fulfillment side effects.
11. PATCH .../:id/fulfillment includes expected_version_id and discriminated body: PAYMENT_RECEIVED {wire_reference,amount,currency}; DISPATCHED {courier_name,awb_tracking_number,estimated_delivery?}; DELIVERED status only. Use server reservation_expires_at and valid transitions ACCEPTED -> PAYMENT_RECEIVED -> DISPATCHED -> DELIVERED. No dispatch before payment, duplicate delivery or bypassed reservation expiry.
12. A global quotation list/expiry queue needs the registered missing read API. Existing detail navigation can use RFQ quotation references; do not label that complete global coverage.
```

### Verification Gate

- Real triage, clarification/close/note bodies, state guards and private prescription streams work; no silent RFQ mutation from catalog creation.
- Server totals handle available/unavailable/sourcing and custom snapshots. Internal costs never cross into token/public HTML/RSC or analytics.
- Draft-create versus unsupported draft-edit is explicit; issue/revise/resend conflicts reconcile safely, FX locks at issue and rotated links fail.
- Fulfillment enforces state/version/reservation guards under duplicate clicks, timeouts and concurrent changes.

---

## Step 8 — Catalog/CMS, CSV Import, Customers, Settings and Release Gates

**Goal:** Complete authenticated operations against registered contracts and verify Release 1 with the shared design language.

**Sources:** PRD §2.3/§3.1/§3.4/§7–8; Architecture §4/§7; API-Spec #21–23/#39–52; actual catalog/CMS/settings/admin routes.

### Prompt

```text
Implement Step 8 in app/admin/catalog/, customers/, settings/, audit-logs/ and reusable admin components. First resolve registered missing admin product/master/CMS reads, quote list/summary and required draft-edit/review fields. A write-only form is not a browse/edit manager. Never invent live GET endpoints or query MongoDB from Next.js.

1. Use documented authenticated read DTOs for existing DRAFT/ARCHIVED records and appropriate active/inactive masters. POST /v1/admin/catalog/products and PATCH .../products/:id accept sku,manufacturer_id,generic_id,category_ids,translations{en,zhCN?},strength,dosage_form,pack_size,packaging_unit,cold_chain_required,storage_condition?,image_keys?,status. Translation fields use brand_name,slug,description,seo_title,meta_description and supported indication/usage/storage/alt text. No zh-CN wire key or prescription_required until its extension exists.
2. Master writes are POST /v1/admin/catalog/{manufacturers,generics,categories}; optional id updates. Match masterBodies: country/certifications, therapeutic_indications or sort_order as appropriate. No unsupported DELETE; use archive/inactive semantics. Explain reserved historical slugs and verify backend-triggered ISR after changes; never expose the webhook secret to the browser.
3. Images: POST /v1/admin/catalog/images with multipart image, JPEG/PNG/WebP <=5 MiB. Validate r2_object_key,url,mime_type,file_size_bytes; persist the key in image_keys. Use authenticated transport, never browser R2 credentials.
4. CMS: implemented POST /v1/admin/cms/banners accepts id?,translations{en,zhCN?}{title,body},is_active,sort_order,starts_at?,ends_at?,link_path?. Register safe browse/edit reads first. No invented image/carousel fields. Sanitize text, validate public relative links and show scheduled/active state; no price/discount/unsupported clinical copy.
5. CSV POST /v1/admin/catalog/import-csv: multipart file with dry_run=true first. Generate the downloadable template from actual csvRow (manufacturer_slug,generic_slug,category_slugs,brand_name_en,slug_en and supported translation/spec columns). Explain 5 MiB and 1–1000 data rows. Render dry_run,valid,total_rows,valid_rows,committed,rows[{row,sku?,valid,errors[{field,issue}]}]. HTTP 200 can mean valid:false.
6. Commit dry_run=false only for an unchanged file that passed dry-run; editing requires another validation. Backend revalidates/commits atomically. HTTP 202 does not imply a job/progress endpoint: show actual committed count. No blind retry of an uncertain import; reconcile catalog/result first.
7. Customers: GET /v1/admin/customers with page,limit,q,buyer_type,country; GET /customers/:id with page/limit returns customer plus paginated history. Preserve immutable RFQ contact snapshots. No invented customer-edit route or lifetime totals derived from one page.
8. Audit: GET /v1/admin/audit-logs with page,limit,actor_type,actor_id,action,entity_type,entity_id,date_from,date_to. Read-only table with timestamps/request IDs/redacted metadata; no edit/delete of audit history or medical-secret export.
9. GET/PATCH /v1/admin/settings uses keyed value records and settingsPatch. Edit configured packaging, verified wire instructions, shipping presets and quote validity within bounds; reservation_days stays 5, timezone Asia/Dhaka. Do not publish the full settings response. GET/PATCH /fx-rates uses rates[{currency,active_mode,manual_rate_to_bdt?}], mode LIVE|MANUAL_FIXED. Show actual staleness/timestamps/available:false; no browser-fetched replacement rates.
10. Authenticated auth/2fa/enroll rotates enrollment and returns qr_data_url plus eight backup codes once. Confirm the operation, display/download once and clear state; it is not public onboarding. auth/sessions and auth/revoke-sessions show actual masked device/session data and retain the current session. Respect Step 6 BFF/cookie expiry and revocation across tabs.
11. Reconcile PRD §7's hierarchical sitemap with Step 1's combined map: migrate /sitemap.xml to an index referencing sitemap-products.xml,sitemap-generics.xml,sitemap-categories.xml,sitemap-manufacturers.xml,sitemap-static.xml. Children consume the existing tagged REST feed and emit actual en/zh-CN/entity-English x-default and lastmod. Omit missing translations, utility noindex pages, search permutations, tokens, PDFs, prescriptions, admin and APIs. Invalidate root/children on catalog changes, update robots and intentionally update tests to traverse every child.
12. Resolve registered backend dependencies before declaring Release 1 complete. Separate missing environment configuration from implemented behavior; mocked success does not prove production email/FX/storage/CORS/SSE. Present local, reviewable changes and actual verification for owner approval. No unrelated framework migration, payment/appointment system or speculative feature.
```

### Verification Gate

- Real authenticated read/create/edit, safe CMS/image upload, archive/inactive and translation flows work; no mock-only feature is reported as implemented.
- Verify CSV failed dry-run, changed-file invalidation, actual commit totals, duplicate submits and uncertain-result reconciliation.
- Settings/FX preserve decimal strings and fixed policies; enrollment/backup codes, revocation and audit data stay private.
- Typecheck/build and relevant Vitest/Playwright suites pass; lint when required by repository checks. Preserve original-host redirects, exact metadata, 365-day preferences and public HTML/DOM/standalone-RSC price exclusion.
- Test real staging-cookie ownership, same-site deployment/BFF SSR auth, protected streams, RFQ idempotency/Turnstile, optional prescription, WeChat PDF guidance, version conflicts and fulfillment transitions.
- Inspect root sitemap index and every child; verify no private/utility/search URLs. Check bilingual desktop/mobile screenshots, contrast, focus/touch targets, reduced motion, image dimensions and measured CLS <=0.1.
- No Google-blocked runtime dependencies. Plausible is public-locale-only and receives no tokens, contact details, prescription files, cart contents or internal costs.

---

## Delivery Notes for Remaining Steps

- Report actual scope, files, tests and unresolved contract/environment dependencies. Preserve existing working code and user edits; do not re-bootstrap Steps 1–2.
- Explain progress in Bangla. Complete the concrete, reviewable work and show evidence before requesting final owner approval, as requested in this project conversation.
- The screenshot is design inspiration, not a change to the manufacturer-direct RFQ business model or authorization to copy another company's assets.
