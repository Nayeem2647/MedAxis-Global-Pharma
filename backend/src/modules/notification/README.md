# Step 8: Durable notifications and Release 1 verification

## Configuration

Run `npm run migrate` before deploying this release. The existing 21-collection
contract now permits notification `FAILED_RETRY`, `delivery_provider` and
`first_attempt_at`. Legacy FAILED records remain readable/retryable; DEAD is
the permanent-failure state. No extra collections are created.

Use Node.js 22.13+ and configure `RESEND_API_KEY` plus a verified `EMAIL_FROM`,
for example `MedAxis Global Pharma <quotes@your-domain.example>`. To enable
Brevo fallback, set `EMAIL_FALLBACK_ENABLED=true` and `BREVO_API_KEY`.
`EMAIL_REPLY_TO` is an optional trusted default address. `EMAIL_REPLY_DOMAIN`
routes clarification replies to `reply+<thread UUID>@domain`; configure the
inbound provider adapter to extract that UUID and send the existing HMAC-signed
`email-reply` webhook payload. Keep the webhook secret outside the database.

SPF/DKIM/DMARC are DNS/provider configuration, not values an application can
authenticate by adding MIME headers. Verify the sender domain in both providers,
publish their SPF/DKIM records and your DMARC policy, and validate inbox delivery
with QQ Mail and 163 Mail before going live. The adapter uses a stable Message-ID,
trusted From/Reply-To, UTF-8 HTML/plain text, Content-Language, Auto-Submitted and
auto-response suppression headers. It never fabricates Authentication-Results
or DKIM signatures. Disable provider open/click tracking for private magic links.
See [Resend domain authentication](https://resend.com/docs/dashboard/domains/introduction).

## Delivery boundary and retries

Intake, decisions and fulfillment commit durable outbox rows in the same
transaction as their business changes. Server hooks wake the common dispatcher
after commit; the 15-minute retry job recovers remaining work. Auth security
notifications also enqueue through this service. Email HTTP calls run outside
MongoDB transactions, so provider failure never rolls back an RFQ or acceptance.

The worker atomically claims EMAIL rows in PENDING, FAILED_RETRY, legacy FAILED,
or expired PROCESSING leases. A two-minute lease, guarded result writes and a
unique `dedupe_key` coordinate workers. Provider selection is pinned before the
HTTP request. Explicit retryable Resend rejection can switch to configured
Brevo; ambiguous network timeouts remain with the pinned provider. Retries use
15- then 30-minute backoff. After three total failed attempts, the same
transaction marks DEAD and queues one high-priority operator alert. Alert
failures do not recursively enqueue more alerts. Unknown/malformed templates
fail safely; obsolete superseded/rotated notifications are cancelled.

Resend receives the stable outbox dedupe key as its Idempotency-Key. Brevo uses
the outbox UUID in its documented `idempotencyKey` field. A Brevo
`duplicate_parameter` acknowledgement records SENT without inventing a provider
message ID. Provider idempotency has a limited retention window: delivery is
at least once across long outages or a crash after provider acceptance but
before the database acknowledgement, rather than an unlimited exactly-once
guarantee. See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
and [Brevo idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).

Quoted totals, contact snapshots and wire instructions are loaded through an
explicit commercial projection. The worker decrypts the temporary magic-link
envelope only in memory, validates its origin/path/expiry and current version
token hash, then renders the message. Plaintext links/tokens are never persisted
or logged. Successful/dead jobs erase the delivery envelope. Token rotation or
revision invalidates pending/retrying/processing old work. An external send
already in progress cannot be recalled; the old link still fails authorization.
The email includes the private PDF proxy link and commercial summary, not an
object storage URL or an internal-cost attachment. Missing verified wire instructions block
an acceptance email and raise an operator alert.

## Templates

Typed HTML builders under `email.templates/` implement all eleven required
templates in English and Simplified Chinese: rfq-confirmation, quotation-sent,
accepted, expiry-reminder, dispatch, delivered, clarification-request,
unable-to-supply, revision-request, admin-new-rfq-alert and admin-accepted-alert.
Additional transactional builders cover payment receipt, reservation expiry,
refresh/decline and operational/security alerts. Legacy template IDs remain
supported. Every displayed field is selected explicitly and HTML-escaped;
template inputs exclude procurement cost, markup and private sourcing notes.
The Day-3 reminder includes the same frozen official bank wire instructions as
the acceptance confirmation.

## Jobs and shutdown

[The job registry](../../jobs/index.ts) is called only by `server.ts` outside
NODE_ENV=test. `createApp()` and importing job modules never schedule work.
All cron tasks use Asia/Dhaka and noOverlap:

| Module                   | Schedule            | Behaviour                                                                                                                                                |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| notificationRetry.job.ts | Every 15 minutes    | Claim/retry email work and alert on exhaustion.                                                                                                          |
| reservationExpiry.job.ts | Every 30 minutes    | ACCEPTED + due reservation + no payment -> PAYMENT_EXPIRED; release allocation, expire wrapper, audit, shorten medical retention and notify buyer/admin. |
| quotationExpiry.job.ts   | Daily 00:00         | Current SENT + past validity -> VALIDITY_EXPIRED; expire wrapper, audit and shorten retention.                                                           |
| expiryReminder.job.ts    | Daily 09:00 / 10:00 | Quotes expiring in 24h / Day-3 unpaid reservations; dedupe by version, reminder kind and Dhaka date.                                                     |
| fxRateRefresh.job.ts     | Every hour          | Existing exact FX refresh with 0.1–10000 sanity validation.                                                                                              |
| prescriptionPurge.job.ts | Every hour          | Claim due medical objects, delete from S3 first, then transactionally erase protected metadata and append a purge receipt.                                    |

Expiry uses conditional version and current-wrapper writes with snapshot reads
and majority writes. It cannot overwrite payment, acceptance or a new revision.
Prescription deadlines use the earlier stored deadline, upload+90 days and
actual terminal event+14 days, so a delayed sweep never extends retention.
The purge worker also enforces the hard upload+90-day cap. `next_retry_at`
doubles as a reclaimable DELETING lease; deletion failures keep the key and
encryption metadata, back off and alert on repeated/overdue failures. Confirmed
deletion precedes the atomic PURGED/receipt write. A failed receipt commit can
safely retry the idempotent S3 deletion. Required UUID/date/MIME/size metadata
remains as the canonical minimal receipt; keys and encryption material are gone.

Sweeps use bounded batches (200 expiry candidates, 500 reminder candidates,
100 purge attempts). Monitor overdue queues and scale sweep capacity for
production volume. Shut down stops cron tasks and SSE first, drains workers
while MongoDB is connected and closes Chromium. FX has one server cron source;
its legacy start/stop helper is not also started by the server.

## Verification

Run `npm run test:release` for typecheck, build, lint, unit/contract tests, all
MongoDB integration suites and real Chromium PDF tests. `npm run format:check`
checks source formatting. Configure MONGODB_TEST_URI (or MONGODB_URI) pointing
to a replica-set deployment; every integration suite, including persistence,
creates and drops only its own randomly named test database.

- `endpoints.contract.test.ts` reads all 52 numbered routes from API-Spec.md,
  verifies registered validation boundaries, HTTP status, JSON envelopes,
  request IDs and error caching. Its auth/persistence adapters are isolated;
  real authenticated success paths are exercised in the integration suites.
- `endpoints.auth.test.ts` exercises the real guard on all 32 ADMIN_AUTH routes,
  rejecting both anonymous requests and signed pre-authentication-only cookies
  before request validation or database access.
- Auth/catalog/RFQ/quotation/decision suites cover 2FA, lockout, revocation,
  catalog secrecy, China email requirements, idempotency and version/acceptance races.
- `csv.batch.test.ts` covers parsing/mapping 101 quoted CSV rows, a write-free
  dry run and one commit transaction with database adapters mocked. Real MongoDB
  upsert and whole-batch rollback are tested separately in the catalog suite.
- `workers.integration.ts` covers competing claims, abandoned leases, provider
  fallback, retry exhaustion, current-token checks, threaded replies, daily
  dedupe, expiry/payment/acceptance races and S3-before-metadata ordering/recovery.
- `notification.test.ts` checks every core template in both locales, injection
  resistance, trusted headers, provider errors and test-disabled cron registration.
- Real PDF tests check English/Chinese text, actual custom Noto font glyph use,
  accepted watermark and zero cost/markup content.

The database suite runs files sequentially in disposable databases. Its longer,
bounded timeouts accommodate Atlas migrations and multi-transaction round trips;
these tests verify correctness, not production response-time targets.

PRD Section 8's browser-only checks (modal/cart interaction, WhatsApp/WeChat UI,
locale cookies, SSR HTML, canonical/hreflang/JSON-LD markup, sitemap XML and Core
Web Vitals) require the Next.js/browser release suite. This backend suite verifies
their API inputs, localized catalog/sitemap data, redirect metadata, private
response headers and PDF artifacts. It does not claim a frontend or real
Mainland China network acceptance test.

Resend, Brevo, Turnstile and S3 adapters are mocked in tests. Chromium is real;
no customer email or external S3 upload is sent during verification. Live DNS
authentication and inbox placement are deployment checks rather than mock-test claims.
