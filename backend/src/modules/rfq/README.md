# RFQ intake, prescriptions and triage

Run `npm run migrate` before enabling Step 5. The existing 21 collections are
retained. The prescription validator now supports a staged upload with a hashed
owner or a linked RFQ/customer pair, and supports the requested `ACTIVE` purge
status. Legacy linked `PENDING` records remain readable. RFQs add
`unable_to_supply_reason`; `close_reason: UNABLE_TO_SUPPLY` remains the canonical
closure code. These changes reconcile upload-before-intake and the explicit
Step 5 contract with the earlier persistence schema.

## Public requests

POST `/v1/public/rfq/cart` accepts:

```json
{
  "idempotency_key": "00000000-0000-4000-8000-000000000001",
  "turnstile_token": "<fresh token>",
  "contact": {
    "full_name": "Buyer",
    "customer_type": "B2C_PATIENT",
    "email": "buyer@example.com",
    "preferred_locale": "en"
  },
  "destination_country": "BD",
  "preferred_currency": "USD",
  "items": [
    {
      "is_uncatalogued": true,
      "custom_medicine_name": "Requested medicine",
      "quantity": 1,
      "packaging_unit": "BOX"
    }
  ],
  "prescription_ids": []
}
```

Catalogued lines use `product_id` and `is_uncatalogued: false`. Product IDs must
reference published products. There must be 1–100 lines; quantities are positive
safe integers. Optional line fields are `custom_strength` and `line_notes`.
Clients cannot set status, product snapshots, internal notes or availability.

POST `/v1/public/rfq/quick-quote` uses the same envelope with exactly one line.
Both endpoints also support the flat contact fields in API-Spec.md, and quick
quote supports flat product/quantity fields and `customer_notes`. Do not mix
flat and nested contact fields. The bot token can instead be supplied through
`cf-turnstile-response`; the idempotency key can instead use
`x-idempotency-key`. Conflicting header/body values are rejected. A singular
`prescription_id` is accepted as an alternative to `prescription_ids`.

Contact accepts optional `company_name`, `whatsapp_number` and `wechat_id`.
At least one contact channel is required; B2B requires company name. Email is
normalized and is mandatory when top-level locale/contact preferred locale is
`zh-CN` or destination country is `CN`. Otherwise a WeChat/WhatsApp-only inquiry
is valid and queues a manual confirmation task. `destination_city_port` and
top-level `locale` are optional; currency defaults to USD and locale to English.

Quick quote and cart share an IP limit of five requests per ten minutes, as
explicitly requested in Step 5 (overriding the older API-Spec 10/hour example).
Failure returns `429 RATE_LIMIT_EXCEEDED` with `Retry-After`. Upload has a
separate five-per-ten-minute IP quota. Explicit origins on public mutations
must match `PUBLIC_ORIGIN`.

### Turnstile and idempotency

Set `CLOUDFLARE_TURNSTILE_SECRET`. Siteverify is called server-side with a
five-second timeout. Missing/failed verification returns
`403 TURNSTILE_VERIFICATION_FAILED`. Production also validates the returned
hostname against the configured public origins. There is no environment-based
bot bypass. Tests inject `createApp({ rfq: { turnstileFetch } })`.

A UUID v4 key binds to a SHA-256 hash of the normalized semantic payload,
including endpoint inquiry type and prescription ownership when present. Bot
tokens and the key itself are excluded from the hash. The first committed
request returns 201; an exact replay within 24 hours returns its stored data
snapshot with 200, without consuming another single-use Turnstile token or
emitting duplicate notifications/events. Rate limiting, input normalization,
token-presence validation and ownership-bound hash matching still apply to
replays. A changed payload returns `409 IDEMPOTENCY_KEY_CONFLICT`.

New intake atomically resolves/creates the customer, allocates the next
`RFQ-YYYY-NNNNN` number, creates RFQ/lines, claims staged files, appends audit,
queues notifications and stores the replay snapshot. Existing customers are
looked up by normalized email and never overwritten by unauthenticated input.
Submission contact is stored separately in the immutable RFQ snapshot; replay
responses never expose unrelated fields from an existing profile. Email-less
inquiries create independent customer records rather than trusting social IDs
as authenticated identities.

The yearly sequence lives under the internal `platform_settings` key
`rfq_sequence_YYYY`; no extra collection is introduced. Transaction conflicts
and unique-key races retry safely. Expired idempotency records are explicitly
replaced without waiting for TTL. Aborted submissions do not consume numbers.

## Prescription upload and access

POST `/v1/public/prescriptions/upload` accepts multipart fields `prescription`
and `turnstile_token`. Actual JPEG/PNG/PDF signatures are validated and buffers
must be no larger than 5,242,880 bytes. Invalid/oversized uploads return
`400 INVALID_PRESCRIPTION_FILE`. The storage service encrypts bytes with
AES-256-GCM before uploading to the private S3 prescriptions bucket.
The multipart file MIME must be `image/jpeg`, `image/png` or `application/pdf`
and match its detected signature; unsupported or mismatched declarations fail
before any storage write.

Configure the S3 bucket and runtime role plus `PRESCRIPTION_ENCRYPTION_KEY` and
`PRESCRIPTION_KEY_ID` as described in `../catalog/README.md`. The response is
201 with `prescription_id`, MIME, size and upload time. It never exposes object
keys, encryption metadata or public medical URLs.

Upload sets an HttpOnly, signed, SameSite=Strict
`prescription_upload_session` cookie (Secure in production). Use
`credentials: include` for both upload and RFQ submission. The cookie owns the
staged file; only its hash is stored. Submit the returned ID in the RFQ's
`prescription_ids`. All IDs must belong to that upload session, be unclaimed,
and be within retention. They are linked to the RFQ/customer and the staging
hash is erased inside the intake transaction. Foreign, reused or expired files
are rejected without partial linkage. The same cookie can own multiple uploads.

Initial `purge_scheduled_at` is upload +90 days, `purge_status` is ACTIVE.
Unable-to-supply/terminal closure uses the earliest of the existing deadline,
upload +90 days and terminal time +14 days. A confirmed document rejection
triggers deletion of the uploaded S3 object. When the write result is uncertain,
the application retains the object and emits a generic alert for reconciliation.

GET `/v1/admin/prescriptions/:id/stream` requires full admin auth. It rejects
expired/deleting/purged files, decrypts/authenticates bytes, appends an access
audit before returning them, and sends the actual MIME with `no-store` and
`nosniff`. Audit failure prevents the medical response. RFQ detail returns only
safe prescription metadata without encryption values or storage URLs.

## Admin RFQ endpoints

All require the signed admin cookie and reject disallowed mutation origins.

| Method / path                                   | Input / result                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET `/v1/admin/rfqs`                            | `page`, `limit<=100`, `status`, `buyer_type`, literal `q`, ISO `date_from`/`date_to`; newest first |
| GET `/v1/admin/rfqs/:id`                        | Snapshot/items, safe prescription metadata, messages/private notes, linked quotation summaries     |
| PATCH `/v1/admin/rfqs/:id/items/:itemId`        | `{ item_availability_status, customer_facing_note? }`                                              |
| PATCH `/v1/admin/rfqs/:id/status`               | `{ status, reason? }`                                                                              |
| POST `/v1/admin/rfqs/:id/request-clarification` | `{ body, channel?: EMAIL                                                                           | WHATSAPP | WECHAT }`; returns message/thread IDs |
| POST `/v1/admin/rfqs/:id/unable-to-supply`      | `{ unable_to_supply_reason }`; closes, audits, schedules purge and queues notice                   |
| POST `/v1/admin/rfqs/:id/notes`                 | `{ body }`; appends a private INTERNAL_NOTE                                                        |

The persisted canonical state machine folds the PRD's draft/received UI stages
into SUBMITTED. Manual transitions are SUBMITTED→UNDER_REVIEW/CLOSED/CANCELLED,
UNDER_REVIEW→CLOSED/CANCELLED, NEED_CLARIFICATION→UNDER_REVIEW/CLOSED/CANCELLED,
and QUOTED→CANCELLED. CLOSED/CANCELLED/CONVERTED cannot be reopened. Terminal
changes require a reason, kept as a private note. Request-clarification owns
the transition to NEED_CLARIFICATION; quote issuance/acceptance in later steps
own QUOTED/CONVERTED transitions, preventing a status PATCH from bypassing those
workflows. Line edits/clarification/unable-to-supply operate only on pre-quote
states. Writes and associated audits/outbox changes are transactional.

## Incoming email webhook

POST `/v1/public/webhooks/email-reply` accepts normalized gateway data:

```json
{
  "provider_event_id": "provider-event-123",
  "thread_id": "00000000-0000-4000-8000-000000000001",
  "from_email": "buyer@example.com",
  "body": "Buyer reply"
}
```

Set `WEBHOOK_HMAC_SECRET`. Sign the exact JSON request bytes with HMAC-SHA256
and send the hex digest, optionally prefixed `sha256=`, in
`x-webhook-signature`. Express preserves those bytes; reserializing the body
before signing is not equivalent. An inbound provider adapter must map its
native event/signature format to this explicitly requested gateway contract.

Replies require an existing outbound email thread and match the RFQ contact's
normalized email. The message is sanitized and deduplicated by unique provider
event ID. Exact duplicates acknowledge without extra writes; changed content
under the same ID conflicts. New replies atomically append/audit, mark the
outbound request replied, and change NEED_CLARIFICATION to UNDER_REVIEW. Replies
to other states do not reopen a terminal RFQ. Medical message text, filenames,
notes and underlying library error messages are excluded/redacted from logs.

## Notifications and live events

After commit, `rfqEvents` emits `NEW_RFQ` with only RFQ ID/number/time and
`NOTIFICATIONS_READY`. Step 7's SSE transport can subscribe to this event
source. `createApp({ rfq: { hooks: { onNewRfq, dispatchNotifications } } })`
allows an existing SSE broadcaster/notification worker to be connected.
Hook failures cannot undo committed data. This step does not add the later
`/v1/admin/stream` transport endpoint.

Without a custom dispatch hook, initial email delivery uses the Resend HTTP
API when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Pending EMAIL jobs
are atomically leased and delivered in a bounded background batch with provider
idempotency keys. Success stores provider ID/status; failure stores a generic
code with exponential backoff and reaches DEAD after five attempts. The later
scheduled notification worker can invoke `createRfqDispatcher` for retries;
this step does not add the Step 8 cron scheduler. Missing credentials leave
durable jobs pending. WeChat/WhatsApp-only confirmations create ADMIN_EVENT jobs
flagged for manual delivery. Admin alerts use `ADMIN_ALERT_EMAIL`, falling back
to the singleton admin email. No medical attachment is emailed.

## Verification

```sh
npm run typecheck
npm run build
npm run lint
npm test
npm run test:rfq
```

RFQ integration tests create and remove only their own `rfq_test_*` database
using `MONGODB_TEST_URI` or `.env`'s `MONGODB_URI`. They use actual MongoDB
validators/transactions, real encryption/magic-byte checks, and mocked
Turnstile/S3/email transports. They test concurrent idempotency, profile safety,
China-email rules, staged ownership, rollback, streaming, webhook authentication,
state transitions, retention, and notification leasing/failure. No actual
patient document or outbound email is sent during verification.
