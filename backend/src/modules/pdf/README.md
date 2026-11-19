# Step 7: Magic links, PDF work and admin operations

## Runtime and private storage

Local development saves quotation PDFs under `backend/uploads/quotes/local/`.
Retrieval still uses the existing buyer-token endpoint. No cloud buckets or AWS
credentials are needed; see [local uploads](../storage/README.md).

Use Node.js 22.13 or newer. The runtime engine is declared in `package.json`
to match the current Puppeteer dependency and PDF verification tooling.

The server starts a durable PDF outbox worker every 15 seconds. `createApp()`
does not start timers or launch a browser. Chromium starts lazily and is reused
with two isolated browser contexts, a bounded queue and a 15-second render
deadline. Each page has JavaScript disabled and rejects network requests;
the HTML template escapes every displayed value and embeds local WOFF2 data.
Timeout/error closes the context and releases its pool slot. A context that
cannot close within one second triggers recycling of the owned Chromium process.
Shutdown closes
SSE clients, stops timers, closes Chromium and disconnects MongoDB.

Deploy `public/fonts/` alongside `dist/`. It contains all 101 Noto Sans SC
variable WOFF2 subsets (English and Simplified Chinese), CSS and the OFL license.
No Google Fonts or other CDN is contacted while rendering. To refresh the
checked-in assets from the pinned dev dependency, run `npm run fonts:copy`.
Chromium's Linux system libraries must be available in the deployment image;
install Puppeteer's browser during deployment or set
`PUPPETEER_EXECUTABLE_PATH` to a compatible system Chromium executable.

Configure the private `S3_BUCKET_QUOTES`, `AWS_REGION` and backend runtime role.
PDFs are streamed through the API after rechecking the quotation token.
Stored metadata is `quotation_versions.pdf.original` / `.accepted`, containing
`object_key`, mode and generation time. Legacy `r2_object_key` remains readable.
Separate immutable object names
and a conditional database write prevent an old render from replacing an
accepted PDF. Failed/displaced writes attempt orphan cleanup. A missing object
can be regenerated. A lease recovers abandoned jobs; failures retry with backoff,
up to three attempts. On-demand downloads share the same generation path.

PDF inputs are commercial DTOs, validated wire details and MedAxis branding.
The renderer/template do not query a database or accept internal costs/notes.
The worker reads explicitly projected commercial versions, wrapper references
and wire settings, and never imports an internal-cost model. Issued bank
instructions are preferred over mutable settings. Accepted/Proforma mode adds
the visible `ACCEPTED / PROFORMA INVOICE` watermark, acceptance time, reservation
deadline and official bank instructions.

## Token policy and decisions

The six public endpoints use the SHA-256 hash of a 64-character CSPRNG token.
They share 30 probes/minute/IP, including malformed and unknown tokens.
Responses and errors use `no-store`, `no-referrer` and
`noindex, nofollow, noarchive`. Unknown/rotated tokens return 404 without buyer
data. A superseded pointer returns `409 QUOTATION_VERSION_CONFLICT`. An expired
SENT version, VALIDITY_EXPIRED or PAYMENT_EXPIRED returns
`403 QUOTATION_TOKEN_EXPIRED`; the refresh endpoint is the exception. Accepted
and fulfilled versions remain viewable beyond the original quotation validity.

- `GET /v1/public/quotation/token/:token`: explicit commercial view, wire
  instructions, availability counts and validity/reservation countdowns.
- `POST /v1/public/quotation/accept/:token`: `{ "terms_accepted": true }`,
  without OTP. Snapshot/majority transaction guards the current active wrapper,
  SENT status, token hash and deadline, then records acceptance evidence, a
  five-calendar-day Asia/Dhaka reservation, RFQ conversion, audit and unique
  customer/admin/PDF outbox jobs. Duplicate acceptance returns 200 without
  extending deadlines or re-enqueueing work. The committed change alone emits
  `QUOTATION_ACCEPTED` and wakes the PDF worker. Reserving the PDF job in the
  transaction prevents a crash between acceptance and scheduling from losing it.
  Embedded schemas inherit the canonical disabled version key so Mongoose can
  roll back/retry transient conflicts without trying to write a synthetic `__v`.
- `POST /v1/public/quotation/request-revision/:token`: `{ "notes": "..." }` on
  a current SENT version. Sanitized notes go into `clarification_messages`,
  threaded by quotation UUID, with the canonical EMAIL channel. Audit/outbox
  contain references rather than the note text.
- `POST /v1/public/quotation/request-refresh/:token`: optional `{ "notes": "..." }`
  on an expired version. A time-expired SENT version is marked VALIDITY_EXPIRED
  even if the future expiry sweep has not run yet. This records a request;
  it does not revive a price or reservation.
- `POST /v1/public/quotation/decline/:token`: structured `reason` of PRICE,
  LEAD_TIME, SPECIFICATION or OTHER, with optional `notes` (max 2000 characters).
  Only SENT can decline. The same transaction closes the wrapper/RFQ, releases
  the reservation, shortens medical retention, audits and notifies the admin.
- `GET /v1/public/quotation/pdf/:token`: private binary proxy with on-demand
  fallback. Re-checks token/current version/status after slow render/download
  work and regenerates in accepted mode if acceptance won that race.

Unexpected acceptance failure aborts all business writes, immediately writes
sanitized local stderr/Winston diagnostics, attempts an independent failure
audit and returns 500 with the retry message. No token, hash, body or raw driver
error enters diagnostics. Three consecutive failures per link in a rolling
hour queue an admin alert. That suppression counter is bounded process memory;
durable failure audits remain in MongoDB.

## Admin operations

All operations require the existing full ADMIN_AUTH cookie and origin boundary.

`PATCH /v1/admin/quotations/:id/fulfillment` accepts:

```json
{ "status": "PAYMENT_RECEIVED", "wire_reference": "TT-123", "amount": "6.35", "currency": "USD" }
```

Payment requires ACCEPTED, ACTIVE reservation and `reservation_expires_at > now`,
even before any expiry job runs. Release 1 records a full verified payment in
the quote's billing currency; partial/over/zero payments cannot mark it paid.
The reservation becomes CONSUMED. DISPATCHED requires PAYMENT_RECEIVED plus
`courier_name` and `awb_tracking_number`; optional `estimated_delivery` is an
ISO timestamp. DELIVERED requires DISPATCHED, completes the wrapper and shortens
prescription retention. Optional `expected_version_id` detects stale admin UI
writes. Each transition audits and queues its own deduplicated buyer email.
Medical deadlines use the minimum of the existing deadline, upload+90 days and
terminal event+14 days. Step 7 schedules deletion; the purge worker is separate.

`GET /v1/admin/customers` supports page/limit, literal search `q`, `buyer_type`
and country. `GET /v1/admin/customers/:id` returns the profile and paginated
repeat RFQ/quotation history, paginating RFQs before the lookup. It excludes
medical notes and token/cost documents. `GET /v1/admin/audit-logs` filters
actor/action/entity/date range with pagination and re-redacts metadata.

`GET /v1/admin/stream` emits NEW_RFQ, QUOTATION_ACCEPTED and CLARIFICATION_REPLY.
Every payload is reconstructed from approved IDs/timestamps, with 25-second
comment heartbeats. Session expiry, revocation and admin generation are checked
before events and heartbeat writes; disconnected/slow clients lose listeners
and timers. Heartbeats do not extend the 30-minute idle session. This is
in-process fan-out for the single-instance Release 1 deployment; it does not
offer event replay across reconnects/instances. Email outbox entries remain the
durable notification channel. Step 8 now wires delivery/retry/reminder workers;
see [the notification and jobs contract](../notification/README.md).

## Verification

`npm run typecheck`, `npm run build`, `npm run lint`, `npm test`;
`npm run test:decisions` uses a random disposable replica-set database, mock S3
and renderer; `npm run test:pdf` uses real headless Chromium and extracts text
from generated PDFs to check Chinese glyph text, bank instructions, watermark
and cost isolation. The tests send no buyer email and perform no external storage upload.
