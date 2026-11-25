# RFQ and quotation workflow rollout

Implemented against the supplied `MedAxis_Quotation_Workflow (2).html` reference and production workflow requirements on 25 November 2026.

## Behavior

- Guest quick-quote and cart RFQs require a valid email and support optional encrypted prescription/supporting documents through the existing upload service. Existing intake idempotency, RFQ numbering, customer acknowledgement, admin alert and live events remain in use.
- `/admin/quotations` is the RFQ worklist: newest received dates first, Dhaka date/time, buyer, country, attachment indicators, live status, separate Review/Action controls, buyer/RFQ search, country/status filters, and active/history sections with independent pagination. Refresh preserves the selected filters.
- Saving a complete medicine availability review enables quote creation. Available medicines require selling price and approximate weight per pack. The server uses Decimal arithmetic for money and medicine weights. Optional packed weight must cover the medicine weight. Draft, customer preview, bank verification and issuance use the existing quotation services, FX snapshots and availability checks.
- The workspace stays on the RFQ throughout negotiation, payment and shipping. It shows version history, messages, private documents, an activity timeline and a separate email delivery/retry panel. Authenticated SSE refreshes the admin screens; reconnect refreshes state. A buyer page refreshes on reopen/focus/online and every 15 seconds while visible.
- New RFQs email a 256-bit private `/r/:token` link immediately. It first shows receipt/review status, then the latest issued offer. Tokens are hashed for lookup, encrypted for delivery and excluded from admin/public DTOs. Request links expire after 90 days and can be revoked or replaced by emailing only the original RFQ address. An RFQ reference is never an access credential.
- An active offer supports buyer approval, a better-offer request (medicine subtotal for **all quoted items**, delivery charge, or both), and buyer decline. A pending request blocks approval while allowing decline. Admin can accept the proposal as revised terms, counteroffer, or retain the same terms with an explanation. Revised prices/delivery are issued atomically as a new immutable version; recorded internal procurement costs and markup are carried forward privately. The current offer stays effective until this completes. Revised drafts are rejected for the new workflow; preview revised terms before sending them together.
- Expected version IDs protect against stale tabs. Operation IDs and request fingerprints deduplicate negotiation/revisions. Existing transactional decision and outbox dedupe rules prevent repeated approvals and duplicate emails. Retaining terms preserves the version and conversation. Only buyer endpoints approve/decline.
- Approval enables payment request. New workflow offers require the request before bank payment can be recorded. Exact payable amount, currency, settled reference and an active reservation are checked. Payment enables courier/AWB/optional ETA; dispatch enables delivery with a proof/reference. Completed and customer-declined records remain searchable in history.
- Quotation PDFs include optional pack/line/total medicine weights and packed shipment weight. Guest DTOs exclude procurement costs, markup, internal notes, private documents and acceptance evidence. Private pages bypass public analytics, indexing and caching.

## Routes and compatibility

| Route | Purpose |
| --- | --- |
| `/admin/quotations` | RFQ worklist and closed history |
| `/admin/rfqs/:id?workflow=1` | Full workflow, including older RFQs entered from the worklist |
| `/admin/rfqs/:id/sourcing` | Existing internal sourcing, clarification, notes and catalog creation tools |
| `/admin/quotations/documents` | Existing issued-document directory |
| `/admin/quotations/:id` | Existing detailed quotation/version/cost tools |
| `/admin/quotations/overview`, `/follow-ups`, `/new` | Existing operational views retained |
| `/r/:token` | Stable private RFQ/offer/order page |
| `/q/:token` | Existing private quotation links retained |
| `GET /v1/admin/rfq-workflow` | Filtered worklist, pagination and summary |
| `GET /v1/admin/rfq-workflow/:id` | Authorized RFQ, commercial history, catalog metadata and safe email delivery status |
| `POST /v1/admin/rfq-workflow/:id/{review,respond,payment-request,guest-link}` | Workflow mutations |
| `GET /v1/public/rfq-workflow/:token` | Token-scoped public projection |
| `POST /v1/public/rfq-workflow/:token/{negotiate,accept,decline}` | Buyer decisions with version guards |

Existing quotation draft/send/revise/fulfillment endpoints are reused. Legacy document filters supplied to `/admin/quotations` redirect to `/admin/quotations/documents`. Older RFQs reached directly from the legacy inbox keep their original sourcing UI until enabled for the workflow. All new RFQs use the new workspace automatically. Existing `/q` tokens, issued prices and histories are not rewritten. Older RFQs can receive an `/r` link using reissue if their original contact email exists. A missing historical email requires establishing a verified address; the UI cannot redirect access to an arbitrary recipient.

UI states map to existing data:

| UI status | Stored state |
| --- | --- |
| New request / Under review | RFQ `SUBMITTED` / `UNDER_REVIEW`, saved workflow review |
| Sent to customer | Quote version `SENT` |
| Change requested | Current `SENT` offer and pending RFQ message |
| Revised / Counteroffer / Current offer retained | `SENT` plus RFQ offer state |
| Approved / Awaiting payment | `ACCEPTED` without/with `payment_requested_at` |
| Paid / Dispatched / Completed | `PAYMENT_RECEIVED` / `DISPATCHED` / `DELIVERED` |
| Declined | `DECLINED` |
| Offer expired | `VALIDITY_EXPIRED`, `PAYMENT_EXPIRED`, or elapsed sent-offer validity |

## Required database rollout

Run from `backend` **after approval for the intended application database**, before serving new intake/workflow writes:

```powershell
npm.cmd run migrate:workflow
```

`src/scripts/migrate-rfq-workflow.ts` updates only validators/indexes for `rfqs`, `quotation_versions` and `prescriptions`. Fields are optional for old records. It adds RFQ workflow and encrypted guest-access fields with a unique partial token-hash index; quotation weight, direct selling price, workflow marker, payment-request and delivery-evidence fields; and attachment kind. It preserves strict validation, never drops indexes, never backfills or edits RFQ/quotation/customer data, and is repeatable. The normal `npm.cmd run migrate` also includes the new contracts for fresh installations.

**Application migration was not applied.** Automatic approval review rejected the attempt because the configured database's shared/production target was not established and explicit permission to change its schema was absent. The migration was exercised on uniquely named isolated test databases. Production deployment is also not performed by this change.

## Environment

Use the existing environment configuration; no secrets belong in source control.

- `MONGODB_URI`: intended replica-set database; transactions are required.
- `QUOTATION_TOKEN_ENCRYPTION_KEY`: 32 random bytes, encoded as 64 hex characters or base64. Now required for RFQ private-link intake as well as quotation delivery.
- `QUOTATION_TOKEN_KEY_ID`: stable identifier for that delivery key. Keep the key available while its encrypted links/outbox entries remain in use; replacing it alone invalidates pending delivery envelopes.
- `PUBLIC_ORIGIN`: authorized frontend origin(s), first origin used for emailed links. `API_ORIGIN`: the public API origin. Frontend `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_BASE_URL`, `API_INTERNAL_BASE_URL` and `ADMIN_FRONTEND_ORIGIN` must match the deployment.
- `CLOUDFLARE_TURNSTILE_SECRET` and frontend `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: matching real production verification keys. Official development/test keys are only for development.
- Existing email transport: `RESEND_API_KEY`, `EMAIL_FROM` and optional Brevo fallback settings. `ADMIN_ALERT_EMAIL` overrides the active singleton admin's address; otherwise that admin receives alerts. Keep the notification worker enabled so committed outbox jobs are delivered/retried.
- Existing private file storage and `PRESCRIPTION_ENCRYPTION_KEY` / `PRESCRIPTION_KEY_ID` remain required for uploads. Existing PDF worker/font/storage configuration is reused.

## Changed implementation files

New backend files: `modules/rfq/rfq.workflow.ts`, `rfq.workflow.routes.ts`, `rfq.workflow.types.ts`, `rfq.guest-access.ts`, and `scripts/migrate-rfq-workflow.ts` under `backend/src`.

Extended backend files: `app.ts`; `modules/rfq/{rfq.schema,rfq.intake.service,rfq.admin.service,rfq.routes}.ts`; `modules/quotation/{quotation.schema,quotation.service,quotation.decisions,quotation.fulfillment,quotation.dto,fastquote.engine}.ts`; `modules/storage/storage.schema.ts`; `modules/admin/admin.stream.ts`; `modules/notification/notification.service.ts`, `modules/notification/email.templates/template.ts`; `modules/pdf/pdf.template.ts`; `shared/validators/{rfq,quotation,decision}.validator.ts`; `shared/persistence/{validators,guards}.ts`; `shared/middleware/{security,errorHandler}.ts`; `backend/package.json` and `.env.example`.

New frontend workflow files: `components/admin/{WorkflowLedger,WorkflowLedgerPage,RfqWorkflowWorkspace,WorkflowQuoteEditor,WorkflowDialog}.tsx`; `components/quotation/{GuestWorkflowViewer,WorkflowPrimitives}.tsx`; `lib/{rfq-workflow,workflow-contract}.ts`; `app/quotation-workflow.css`; `app/r/{layout,[token]/page}.tsx`; `app/admin/(protected)/quotations/documents/page.tsx`; `app/admin/(protected)/rfqs/[id]/sourcing/page.tsx`.

Extended frontend files: admin quotations/RFQ/quote pages and admin layout; `components/admin/{AdminShell,AdminTopbar,QuotationDirectory}.tsx`; `components/layout/PublicAnalytics.tsx`; `components/rfq/{RfqForm,PrescriptionUpload,MedicineSearch}.tsx`; `app/request-quote.css`; `lib/{admin-contract,admin-stream,admin-workflow,rfq,prescription-upload,quotation}.ts`; locale messages; middleware; Next private headers; and ESLint generated-output exclusions. Earlier website-request queue components remain available. The current medicine selector searches the full catalog with pagination, restores its dosage-form filter, and retains catalog identities through quantity edits/submission. The public two-step progress labels wrap correctly at 320px.

Tests: `backend/tests/rfq-workflow.integration.ts`, `quotation.test.ts`, `helpers/env.ts`; frontend `tests/e2e/production-workflow.spec.ts`, `production-workflow-fixture.ts`, `quotation-medicine-search.spec.ts`, mock API, legacy request-overview tests, and RFQ unit fixtures. Existing customer/quotation tests remain in place.

## Verification

The real backend integration suite uses a generated `workflow_test_<random>` database with explicit target guards before migration, cleanup and database removal. It uses fake Cloudflare, encrypted-storage and email transports; it cannot select or clear the application database. No real buyer email or shipment was created.

Commands used:

```powershell
# backend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd test
npm.cmd run test:workflow

# frontend
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
# Production browser verification uses the Playwright fixture server and an isolated build directory.
$env:PLAYWRIGHT_CHANNEL='chrome'
$env:E2E_PRODUCTION='1'
$env:MEDAXIS_E2E_DIST_DIR='.next-e2e-rfq-workflow-prod'
npm.cmd run test:e2e -- tests/e2e/production-workflow.spec.ts tests/e2e/admin-quotation-requests.spec.ts tests/e2e/quotation-medicine-search.spec.ts --workers=1
```

Verified: backend 488 unit tests; frontend 371 unit tests; four isolated integration scenarios covering both intake paths, optional files, stable acknowledgement links, review gate, invalid packed weight, counteroffer, buyer-proposal acceptance as new terms, retained terms, decline, stale version rejection, concurrent/repeated submissions, payment validation, AWB, delivery evidence, searchable history, and expired/revoked/reissued request links. The final full-flow integration recheck also passes with nonzero recorded procurement costs preserved across the counteroffer and safe admin email-status projection. A transient Atlas connection failure on that recheck cleared on retry.

**Final production-browser suite: 9 passed (32.5 seconds).** This covers the complete admin/buyer workflow, private access before issuance, legacy overview visibility/navigation/live updates/error recovery, catalog search/filter/pagination, malformed/stale search responses, custom medicine replacement and multi-item cart submission. Responsive screenshots and page-width assertions cover the worklist, RFQ workspace and private page at 320–1440px; the public selector is also verified at 320px. Backend/frontend typechecks, backend build, frontend production build and lint pass. Frontend lint retains two existing configuration export warnings and has no errors. `git diff --check` passes. Production test output uses `.next-e2e-rfq-workflow-prod`; the temporary Next.js tsconfig additions were restored afterward.

Outstanding rollout verification: applying the migration to the approved application target; deploying/restarting the intended backend/frontend/workers; real provider email deliverability, Cloudflare domain configuration and production storage/PDF transport. Those external checks were intentionally kept separate from sample-data verification.
