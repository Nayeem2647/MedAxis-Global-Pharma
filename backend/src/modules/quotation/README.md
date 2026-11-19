# Step 6: FX and quotation service

All seven endpoints require the existing full `ADMIN_AUTH` cookie and admin
request boundary. A password-only pre-auth cookie cannot use them.

## Configuration and startup

Run `npm run migrate` on an existing replica-set database before using this
release. The migration extends the existing strict validators; it adds no new
collections. `locked_fx_rates` remains the Mongoose alias of `fx_snapshot`.

Set `EXCHANGE_RATE_API_KEY` for live rates. The server hydrates the cache at
startup, fetches once, then refreshes every hour. `createApp()` alone starts no
timer or provider request. Shutdown stops the timer. The standard provider
response is fetched with BDT as base, parsed without converting rate literals
to binary floating point, and inverted to BDT per foreign currency. Each batch
is validated before a transaction writes all three currencies. Any rejected
batch leaves the last good DB/cache values intact and queues a high-priority
admin alert at most once per hour. Refresh preserves manual rates and modes.

`GET /v1/admin/fx-rates` exposes live/manual/active decimal strings, provider
timestamps, cache expiry, staleness, and a safe last error code. Provider
publication time determines staleness. Last good rates remain available during
provider outages, with their original timestamps; manual mode is also available.
`PATCH /v1/admin/fx-rates` accepts, for example:

```json
{ "rates": [{ "currency": "USD", "active_mode": "MANUAL_FIXED", "manual_rate_to_bdt": "122.50" }] }
```

The seed initializes currency records; a first successful fetch can also create
them. An existing row and a sane manual rate are required to enable manual mode.
Rates outside the inclusive range 0.1–10000 are rejected.

Also configure `QUOTATION_TOKEN_ENCRYPTION_KEY` (32 random bytes as hex or
base64) and `QUOTATION_TOKEN_KEY_ID` before send/resend. Keep this separate
delivery key outside MongoDB. Missing configuration fails issuance atomically.
Bank instructions must be configured with verified beneficiary, bank, account,
SWIFT and instructions in the `wire_instructions` platform setting, or supplied
as `bank_details` in the draft/send payload.

## Draft and pricing contract

The authenticated quotation directory supports literal search across quotation/RFQ
references and the current version's customer name, company and email. Its explicit
projection returns only the customer name/company/email and commercial summary;
internal cost records, bank instructions and token material remain excluded.
`worklist=AWAITING_PAYMENT|READY_TO_DISPATCH|EXPIRING` uses the same conditions as
the summary counts. Worklists require an ACTIVE parent and EXPIRING includes only
unexpired accepted allocations due within 24 hours. Draft and sent summary counts
also use the active parent's current version. These reads do not write or notify.

`POST /v1/admin/quotations/draft` takes `rfq_id`, `billing_currency`, `items`,
`freight_amount`, `insurance_amount`, `shipping_terms`, optional `bank_details`
and optional `internal_procurement_notes`. Money, cost and percent inputs are
nonnegative decimal **strings**, with at most 18 integer and 8 fractional digits.
Computed totals sent by a client are rejected.

Every RFQ line appears once. Each input line supplies `rfq_item_id`, an active
`manufacturer_id`, `availability_status`, and, for AVAILABLE lines,
`procurement_cost_bdt` **per unit** plus `markup_percent`. Quantity and packaging
come from the RFQ. Catalog specifications are resolved on the server;
uncatalogued lines require a `snapshot` containing `brand_name`, `generic_name`,
`strength`, `dosage_form`, and `pack_size`. UNAVAILABLE lines need a
`customer_facing_note` and contribute no money or internal costs. SOURCING is
permitted in a draft but must be resolved before sending. At least one line
must be AVAILABLE. Cold-chain products require cold-chain shipping.

Pricing uses isolated 80-digit decimal arithmetic and persists Decimal128.
The quoted unit price is rounded HALF_UP to two decimals, then multiplied by
the RFQ's integer quantity. Freight and insurance are rounded HALF_UP to two
decimals, then added to the available-line subtotal. BDT uses a rate of 1.
BDT procurement totals, gross margin and effective margin remain exclusively
in `quotation_internal_costs`; customer-facing versions/DTOs contain none of
those fields. The margin excludes freight and insurance pass-through amounts.

Draft rates are previews. Sending re-prices the draft from stored internal
inputs using current database rates and freezes the commercial/cost snapshots
in the same transaction. Existing issued snapshots are never re-priced.

## Issue, revise and resend

`POST /:id/send` accepts optional `expected_version_id`, `bank_details`,
`validity_days` (1–365; default configured preset or 7), and `allow_stale_fx`.
Issuance requires a current DRAFT, a buyer email, resolved RFQ clarification,
verified bank instructions and three valid active FX rates. Cached LIVE rates
are usable by default as the outage fallback; set `allow_stale_fx: false` to
require fresh rates. Per-currency modes, timestamps and `stale_rates_used` are
captured in the locked snapshot. Manual rates do not expire with live data.

Issuance locks the parent pointer, freezes FX/prices/terms, stores a SHA-256
magic-token hash, moves the RFQ to QUOTED, and writes audit/email/PDF outbox
records atomically. It returns `version` and `magic_link_url` once. No raw token
or URL is persisted or logged. The notification outbox holds only an AES-GCM
encrypted delivery envelope with a deadline of at most 24 hours. The mail
worker must decrypt just before sending, enforce the deadline and current
version/token binding, and erase the envelope on delivery/dead-letter. A
`PDF_RENDER` job contains IDs and mode only. Step 6 queues this work and invokes
the optional non-blocking dispatcher hook. Step 7's PDF worker now consumes
these PDF jobs; Step 8's [notification worker](../notification/README.md) consumes
email jobs. See
[the decision/PDF/admin contract](../pdf/README.md).

`POST /:id/revise` takes the pricing payload plus required
`expected_current_version_id` and optional `issue_immediately`. Only the current
SENT version can be revised. The transaction creates version N+1 and its cost
record, supersedes the previous SENT version, moves the parent pointer and
invalidates its queued work. Direct issue freezes the new version in that same
transaction; otherwise it remains DRAFT. Accepted or changed versions conflict.
The pointer write and conditional SENT update serialize against acceptance.

`POST /:id/resend` takes optional `expected_version_id`. It rotates the token
hash of the current, unexpired SENT version, invalidates old pending emails,
and queues the new encrypted link without changing financial data or adding
another PDF job. `GET /:id` returns the wrapper, ordered commercial versions
and a separate admin-only `internal_costs` projection; it never returns hashes
or delivery envelopes.

## Verification

`npm run typecheck`, `npm run build`, `npm run lint`, and `npm test` check the
TypeScript boundary and unit tests. `npm run test:quotation` uses
`MONGODB_TEST_URI` (or `MONGODB_URI`) with a randomly named disposable database;
it migrates and drops **only that test database**. FX HTTP requests and dispatch
hooks are mocked; no provider, customer email or real PDF delivery is involved.
