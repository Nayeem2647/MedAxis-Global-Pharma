# Super Admin authentication

The authentication and profile endpoints are mounted at `/v1/admin/auth`. All responses use the
standard API envelope and `Cache-Control: no-store`.

| Method / path              | Body                                                  | Successful result                                                                      |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| POST `/login`              | `{ "email": "owner@example.com", "password": "..." }` | `requires_2fa`, challenge expiry; signed `pre_auth_session` cookie                     |
| POST `/verify-totp`        | `{ "code": "123456" }`                                | Safe admin summary, session ID, expiry; signed `medaxis_admin_session` cookie          |
| POST `/verify-backup-code` | `{ "backup_code": "..." }`                            | Same session result; consumes the recovery code                                        |
| POST `/2fa/enroll`         | Empty body or `{}`                                    | `qr_data_url` and eight plaintext `backup_codes`, returned once                        |
| GET `/sessions`            | None                                                  | Active sessions with `current`, masked IP, GeoIP, User-Agent, `last_active_at`, expiry |
| POST `/revoke-sessions`    | Empty body or `{}`                                    | `revoked_count`; retains the current session                                           |
| POST `/logout`             | Empty body or `{}`                                    | `logged_out`; clears cookies and revokes the current session                           |
| GET `/profile`             | None                                                  | Safe account ID, login email, display name, phone and a 120-second signed URL for stored avatars (local development or S3) |
| PATCH `/profile`           | Name, phone, email, optional JPEG avatar data URL or `null` to remove it; current password when changing email | Saved safe profile; audited |
| POST `/change-password`    | Current password, new password (at least 12 characters), confirmation | Password changed; other sessions and pending challenges revoked |

All endpoints after MFA verification require full admin authentication. Password-only
challenges last five minutes, are bound to IP and User-Agent, and cannot be used
as full sessions. Completing MFA consumes the challenge exactly once. Full
sessions expire after 30 minutes of inactivity; the guard checks expiration and
revocation directly and renews both database expiry and browser-cookie expiry.
Both cookies are HttpOnly, SameSite=Strict, and Secure in production. Explicit
mutation origins must match `PUBLIC_ORIGIN`.

## Configuration and bootstrap

Set `TOTP_ENCRYPTION_KEY_BASE64` to a separately generated, 32-byte base64 key and
`TOTP_KEY_ID` to its identifier. Use the same key and ID as the bootstrap seed.
Existing `SEED_TOTP_ENCRYPTION_KEY_BASE64` and `SEED_TOTP_KEY_ID` variables are
accepted as fallbacks. These values are required in production. Development
can boot without them, but TOTP verification/enrollment returns 503 until they
are configured. `ADMIN_HOME_COUNTRY` defaults to `BD` for foreign-login alerts.
Keep encryption keys outside MongoDB; changing a key requires re-encrypting
existing secrets. The AES envelope is compatible with the Step 2 bootstrap.

Run `npm run migrate` before serving these routes: admin/session validators now
include TOTP replay tracking, session purpose, GeoIP, and User-Agent fields.
There are still exactly 21 collections. Bootstrap uses the existing seed with
an already enrolled authenticator; enrollment is protected and does not create
an unauthenticated setup bypass. The enrollment endpoint rotates the TOTP
secret, replaces recovery codes, revokes other sessions and challenges, and
retains the caller's authenticated session.

## Write and notification boundaries

Five failures across password/TOTP/recovery share an IP scope and trigger a
15-minute lockout. Correct password entry does not reset MFA failures. The
counter uses a single atomic MongoDB pipeline, handles concurrent initial
upserts, and resets expired records without depending on TTL cleanup. A full
successful MFA transaction clears the counter. Lockout returns
`403 ACCESS_DENIED` and a `Retry-After` header.

MFA completion requires Atlas, a replica set, or mongos. Challenge consumption,
TOTP replay tracking or atomic recovery-code removal, full-session creation,
and the append-only audit entry commit together. Any failure rolls them all
back. Recovery codes generated here use bcrypt cost 12. Passwords use Argon2id.
Revocation and enrollment also use transactions and session generations to
invalidate pending challenges and concurrent stale sessions.

`createApp({ authHooks: { onSecurityEvent } })` accepts an asynchronous login,
lockout, recovery, and enrollment notification hook. Events contain UTC and
Dhaka timestamps, IP, GeoIP, User-Agent, severity, and new/foreign IP flags.
The default writes structured security alerts; email delivery belongs to the
notification-service integration. Hook failures are logged without exposing
credentials or undoing committed authentication. No outbound email is sent by
this module. As explicitly requested in Step 3, a valid password plus an unused
recovery code issues a full session; the PRD's additional out-of-band email
confirmation flow is not part of these seven endpoint contracts.

`writeAuditLog` maps `action` to stored `action_type` and `metadata` to
`safe_changes`. It redacts credential fields and appends request/IP/UA context.
Sessions store SHA-256 token hashes; raw tokens appear only in signed cookies.
DTOs never expose hashes or encrypted secrets. TOTP enrollment exposes only its
QR image and newly generated recovery codes.

## Verification

`npm run typecheck`, `npm test`, `npm run lint`, and `npm run build` check the
implementation locally. To run only the auth integration tests:

```sh
npm run test:auth
```

Set `MONGODB_TEST_URI` (or `MONGODB_URI` in `.env`) to an Atlas / replica-set
server whose test user can create and remove databases. Auth integration tests
create a unique `auth_test_*` database, apply all validators/indexes, and remove
only that database afterward. They never alter the application's admin account.
