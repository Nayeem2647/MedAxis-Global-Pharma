# Customer accounts and dashboard

Owner-approved scope extension, 20 November 2026. This implements the original customer-dashboard requirements from `Idea.md` while keeping guest RFQ submission and private quotation links available. The earlier Release 3 deferral of customer accounts in PRD §3.1 is superseded for this extension. Admin credentials and admin sessions remain separate.

## Customer experience

- Localized `/en/login`, `/en/register`, `/zh-CN/login` and `/zh-CN/register` pages.
- `/[locale]/account`: overview, profile, saved draft requirements, submitted RFQs, quotations and PDFs, revision requests, and activity/history.
- Registration signs the customer into a new account. Profile and drafts are available immediately. Email verification is required before attaching existing customer records, reading RFQs/quotations, or submitting a saved draft.
- Email verification and password-reset links use a single-use token in the URL fragment. The page removes it from the address bar and submits it in a POST body; visiting the page alone does not consume a token.
- Draft requirements support multiple catalog/custom medicine lines, quantities, units, notes, destination, currency, and importing the browser's current quote list. Submitted requirements cannot be edited as drafts.
- RFQ submission reuses the existing transactional intake, validated packaging units, notification outbox and idempotency mechanism. It does not replace the existing guest quote forms.
- Customers can view their issued quotation versions and request a revision of their current, unexpired SENT quotation. They download PDFs through authenticated endpoints. Previous-version PDFs require an existing saved artifact; the system does not fabricate a historical PDF.
- Quotation acceptance/decline continues through the existing private quotation link. No new OTP or login gate is added to that flow.
- Profile edits do not modify immutable contact snapshots on earlier RFQs or quotations. Account email changes require a separate verified-address change flow and are not exposed in this extension.

## Identity and ownership

The existing `customers` collection remains a contact directory. The four additional collections are:

| Collection | Purpose |
| --- | --- |
| `customer_accounts` | Normalized unique email, Argon2id password hash, profile defaults, email verification, reset challenge and session generation |
| `customer_sessions` | SHA-256 session token hash, account identity, generation, 30-minute idle expiry and 12-hour absolute expiry; TTL cleanup |
| `customer_drafts` | Account-owned draft requirements with optimistic revision checks, submission state and RFQ receipt |
| `customer_events` | Account activity references without passwords or commercial costs |

Every customer read/write derives account ownership from the server-validated customer session. Client-supplied customer IDs are never authorization. RFQ, quotation, PDF and revision endpoints also constrain their queries to the verified account's customer identity. Draft quotations, procurement costs, margins, token hashes, staff notes and credentials are not customer output.

An unverified registration cannot claim a contact profile or view historical records merely by entering an email address. Verification links establish that association without overwriting the existing contact profile. Password resets invalidate older sessions. Admin cookies are not forwarded through the customer adapter, and customer cookies cannot authenticate admin routes.

## API

Backend base: `/v1/public/customer`. Browser adapter: `/api/customer`. All responses are private/no-store, no-referrer, noindex. Cookies are signed, HttpOnly and SameSite=Strict, with Secure enabled in production. Only the customer cookie is forwarded by the browser adapter; CSRF origin checks and endpoint/method allowlists apply. No credentials or session tokens are stored in localStorage.

| Method | Relative endpoint | Access / function |
| --- | --- | --- |
| GET | `/auth/session` | Safe current profile or `null` |
| POST | `/auth/register` | Create an account and request verification |
| POST | `/auth/login` | Verify password and issue customer session |
| POST | `/auth/verify-email` | Consume email verification token |
| POST | `/auth/forgot-password` | Generic reset-request response |
| POST | `/auth/reset-password` | Consume reset token; revoke older sessions |
| POST | `/auth/logout` | Revoke current customer session |
| POST | `/auth/resend-verification` | Signed-in verification request |
| POST | `/auth/change-password` | Verify current password; change password and revoke sessions |
| GET/PATCH | `/profile` | Own profile; email is immutable here |
| GET | `/overview` | Own counts and public packaging-unit options |
| GET/POST | `/drafts` | Own paginated drafts / create |
| PATCH/DELETE | `/drafts/:id` | Own editable draft; PATCH requires current revision |
| POST | `/drafts/:id/submit` | Verified account; create/reconcile the same draft's RFQ |
| GET | `/rfqs`, `/rfqs/:id` | Own RFQs and public line information |
| GET | `/quotations`, `/quotations/:id` | Own issued quotation versions |
| GET | `/quotations/:id/pdf` | Authorized private PDF download |
| POST | `/quotations/:id/revisions` | Own current SENT quotation; notes + stable request UUID |
| GET | `/revisions` | Own quotation revision/follow-up messages |
| GET | `/history` | Paginated own account activity and RFQ/quotation status records |

Collection endpoints accept only `page` and `limit` (maximum 50). Authentication and writes are rate-limited. Repeated password failures temporarily lock the account. Mutations do not automatically retry in the browser; draft submission and revision request identifiers permit reconciliation.

## Configuration and rollout

1. Run `npm run migrate:customers` in `backend/`. This adds validators and indexes for only the four new collections; it preserves existing customer/RFQ/quotation data. The main migration also includes them for fresh installs (26 total registered collections, including product ratings).
2. The owner selected **Resend**. Set `RESEND_API_KEY` and `EMAIL_FROM` in `backend/.env`; the sender must use a verified Resend domain. Existing notification transport is reused. Do not commit keys.
3. `PUBLIC_ORIGIN[0]` determines the customer verification/reset link origin. Keep it aligned with the public frontend. The frontend adapter uses the configured site/admin frontend origin for trusted backend requests; its local loopback-port allowance applies only outside production.
4. Restart the backend after environment changes. Next.js public values must be set before production build.

If transactional email is unconfigured or delivery fails, registration/login and draft storage still work, but email verification and password recovery cannot complete. The UI reports this instead of displaying a false delivery success. Existing private records remain protected until verification succeeds.

Private account/login/register URLs are excluded from public analytics, have private robots headers and are disallowed in robots.txt. They are not part of the public sitemap.

## Verification

- `backend`: `npm run test:customers` uses a fresh `customer_account_test_*` database, verifies its exact name before migration/cleanup, captures verification/reset email links in memory, and drops only that isolated database. It never sends a real email.
- Coverage includes registration, duplicate registration, login/logout, forged sessions, cross-origin writes, password lockout/reset, linking existing contacts only after verification, draft revision checks, idempotent submission, cross-customer RFQ/quotation/PDF isolation, revision replay and history.
- `frontend`: customer boundary unit tests plus bilingual browser flows for registration, verification, saved requirements, RFQs, quotations, revision requests, PDF download, profile changes, logout/relogin and mobile layouts.

Actual external email delivery additionally requires the owner's Resend credentials and verified sender domain; captured test emails do not prove delivery to Gmail/QQ/163 inboxes.
