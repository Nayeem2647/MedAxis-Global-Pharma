# Persistence scripts

Run from `backend/` with `MONGODB_URI` set (or in `.env`):

```sh
npm run migrate
npm run seed
```

`migrate` creates exactly 21 collections, applies strict/error `$jsonSchema`
validators, and creates the indexes declared on the schemas. Repeated runs are
safe; it never drops data or indexes. An incompatible existing index fails the
migration for operator review. Mongoose index creation is disabled on every
schema; startup cannot replace this migration. Deploy it before application
traffic. Atlas Search is installed separately using `atlas-search-index.json`.
Search queries must filter `status: PUBLISHED` and project public fields.

## Verification

From `backend/`:

```sh
npm run typecheck
npm test
npm run test:db
```

Unit tests compile all 21 validators as JSON Schema draft 4 with BSON type
support, reject invalid RFQ statuses and quantities, and exercise Mongoose
immutability guards without a database connection.

The persistence suite in `test:db` uses `MONGODB_TEST_URI`, falling back to `MONGODB_URI` from the
environment or `.env`. Point it at an Atlas / replica-set test database. It runs
the migration twice, verifies every installed validator and declared index,
checks native-driver RFQ insert/update rejection, and exercises saved FX/audit
records. It applies indexes and validators to that database; all fixture writes
run inside transactions that are aborted after each test. No test records are
committed. Database tests are separate from the default unit test command and
fail if the database is unavailable or does not support transactions.
The auth integration suite additionally creates and removes its own unique
`auth_test_*` database on the same server. Its fixtures never touch the configured
application database. See `../modules/auth/README.md` for its focused command.
The catalog suite uses a separate `catalog_test_*` database with the same cleanup
boundary. Run it alone with `npm run test:catalog`; its R2/webhook transports are
mocked. See `../modules/catalog/README.md` for API payloads and configuration.
The RFQ suite uses a separate `rfq_test_*` database. Run `npm run test:rfq`;
Turnstile/R2/email transports are mocked while MongoDB transactions and medical
encryption run normally. See `../modules/rfq/README.md` for schema changes,
staging ownership, payloads and deployment configuration.

The initial seed requires these environment variables only when the singleton
admin does not already exist:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD` (at least 12 characters; hashed with Argon2id)
- `SEED_ADMIN_TOTP_SECRET` (existing base32 enrollment secret)
- `SEED_TOTP_ENCRYPTION_KEY_BASE64` (32 random bytes, base64 encoded)
- `SEED_TOTP_KEY_ID` (identifier for the externally stored encryption key)
- `SEED_ADMIN_BACKUP_CODE_HASHES` (JSON array of bcrypt hashes for backup codes
  already provided to the administrator)

TOTP is encrypted with AES-256-GCM. Its stored string is a JSON envelope with
algorithm, key identifier, IV, authentication tag and ciphertext. Keep the key
outside MongoDB. No passwords, TOTP secrets or backup codes are printed. Existing
credentials, settings, rates and catalog entries are preserved. Demo products
start as DRAFT; FX defaults are synthetic with epoch fetch dates; bank details
start unconfigured. Verify/configure those values before issuing real quotes.

## Contract decisions

The supplied `Database.md` ends at Section 11; there is no Section 17.
`Database-Schema.md` Section 2 remains the canonical stored field contract.
The requested `locked_fx_rates`, `active_mode` and notification `retry_count`
are typed Mongoose aliases for `fx_snapshot`, `mode` and `attempt_count`.
Use canonical names in filters/updates; aliases work on documents and are not
duplicated in BSON. Exchange rates store both `_id` and `currency_code` with the
same currency code to reconcile Section 2's key and Section 4's unique index.
Product `brand_name`, `generic_name` and `manufacturer` are optional materialized
search labels explicitly permitted by Database.md Section 4. Keep them current
when master names change.

## Write boundaries

Use registered models, `runValidators` and explicit DTOs. The schema guards
protect financial snapshots, RFQ contact snapshots and append-only audit writes.
Internal costs must be saved in a transaction: the guard touches the parent
DRAFT version in that transaction to serialize against quotation issuance.
Register all models via `shared/persistence/models.ts` before cost writes.
Financial documents cannot be deleted, replaced or modified with bulk writes.
Audit supports inserts only. Native driver/`Model.collection` calls bypass
Mongoose; production database roles must separately prohibit audit updates and
deletes and restrict writes to commercial collections.

Collection validators enforce field shape and conditional line/contact rules.
They cannot compare old/new documents or enforce cross-collection ownership.
RFQ and quotation services enforce their reference checks and transactional
intake/issuance/revision boundaries. Step 6 implements exact totals, bank
instruction verification, FX freshness and immutable issue-time snapshots;
see [the quotation service contract](../modules/quotation/README.md). Payment,
dispatch and buyer decision prerequisites belong in their respective services.
TTL is asynchronous cleanup. Prescription content verification, R2 deletion and
purge scheduling also belong in their application services.

Money and FX persist as Decimal128. API boundaries must use decimal strings;
arithmetic uses decimal.js and ROUND_HALF_UP for two-decimal quoted unit prices
before quantity multiplication, retaining FX precision.
