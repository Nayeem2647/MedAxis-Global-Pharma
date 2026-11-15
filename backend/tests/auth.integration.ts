import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import request, { type Response as HttpResponse } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ADMIN_SESSION_IDLE_MS } from '../src/config/constants.js';
import { loadEnv } from '../src/config/env.js';
import { AdminModel, AdminSessionModel, AuthAttemptModel } from '../src/modules/auth/auth.schema.js';
import { createAuthSecurity, type SecurityEvent } from '../src/modules/auth/auth.security.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import { migrate } from '../src/scripts/migrate.js';
import { decrypt, encrypt, hashPassword, hashToken } from '../src/shared/utils/crypto.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';

// Every destructive fixture operation is confined to this fresh, uniquely named database.
const databaseName = `auth_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
const key = Buffer.alloc(32, 7);
const env = loadEnv({ ...validEnv, TOTP_ENCRYPTION_KEY_BASE64: key.toString('base64'), TOTP_KEY_ID: 'auth-test-v1' });
const logger = createLogger({ silent: true });
const email = 'admin@example.test';
const password = 'A test-only password with entropy';
const recoveryCode = 'test-recovery-code';
const secret = speakeasy.generateSecret({ length: 32 }).base32;
const events: SecurityEvent[] = [];
let app: Express;
let adminId: string;
let passwordHash: string;
let recoveryHash: string;

function cookies(response: HttpResponse): string[] {
  const values = response.headers['set-cookie'];
  return values ? (Array.isArray(values) ? values : [values]) : [];
}
function cookie(response: HttpResponse, name: string): string {
  const found = cookies(response).find((value) => value.startsWith(`${name}=`));
  expect(found, `missing ${name} cookie`).toBeDefined();
  return found!.split(';')[0]!;
}
function rawToken(value: string): string {
  const signed = decodeURIComponent(value.slice(value.indexOf('=') + 1));
  const raw = cookieParser.signedCookie(signed, env.ADMIN_SESSION_SECRET);
  expect(typeof raw).toBe('string');
  return raw as string;
}
async function preAuth() {
  const response = await request(app).post('/v1/admin/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return { response, cookie: cookie(response, 'pre_auth_session') };
}
async function loginBackup() {
  const challenge = await preAuth();
  const response = await request(app)
    .post('/v1/admin/auth/verify-backup-code')
    .set('Cookie', challenge.cookie)
    .send({ backup_code: recoveryCode });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { response, cookie: cookie(response, 'medaxis_admin_session') };
}
function totp(time = Date.now()) {
  return speakeasy.totp({ secret, encoding: 'base32', time: Math.floor(time / 1000) });
}
function wrongTotp() {
  return ['000000', '111111', '222222', '333333'].find(
    (token) => !speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 }),
  )!;
}

beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_TEST_URI or MONGODB_URI for auth database tests');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10_000,
  });
  await migrate();
  [passwordHash, recoveryHash] = await Promise.all([hashPassword(password), bcrypt.hash(recoveryCode, 12)]);
  app = createApp({
    env,
    logger,
    authHooks: {
      onSecurityEvent: (event) => {
        events.push(event);
      },
    },
  });
});

beforeEach(async () => {
  if (mongoose.connection.name !== databaseName) throw new Error('Refusing to alter a non-test database');
  for (const name of ['admins', 'admin_sessions', 'auth_attempts', 'audit_logs'])
    await mongoose.connection.db!.collection(name).deleteMany({});
  const admin = await AdminModel.create({
    email,
    password_hash: passwordHash,
    totp_secret_encrypted: JSON.stringify(encrypt(secret, key, 'auth-test-v1')),
    backup_code_hashes: [recoveryHash],
  });
  adminId = admin._id;
  events.length = 0;
});

afterAll(async () => {
  try {
    if (mongoose.connection.name === databaseName && databaseName.startsWith('auth_test_'))
      await mongoose.connection.db?.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Super Admin authentication against MongoDB', () => {
  it('issues only a five-minute signed pre-auth challenge after password verification', async () => {
    const { response, cookie: challenge } = await preAuth();
    expect(response.body.data.requires_2fa).toBe(true);
    expect(cookies(response).join(' ')).toMatch(/HttpOnly.*SameSite=Strict/);
    expect(cookies(response).join(' ')).toContain('Max-Age=300');
    expect(cookies(response).some((value) => value.startsWith('medaxis_admin_session='))).toBe(false);
    const row = await AdminSessionModel.findOne({ purpose: 'PRE_AUTH' }).select('+token_hash').lean();
    expect(row!.token_hash).toBe(hashToken(rawToken(challenge)));
    expect(JSON.stringify(response.body)).not.toContain(password);
    const swapped = challenge.replace('pre_auth_session=', 'medaxis_admin_session=');
    // Reject the actual challenge cookie and a validly signed challenge renamed to the full-session cookie.
    for (const suppliedCookie of [challenge, swapped]) {
      const denied = await Promise.all([
        request(app).get('/v1/admin/auth/sessions').set('Cookie', suppliedCookie),
        request(app).post('/v1/admin/auth/2fa/enroll').set('Cookie', suppliedCookie).send({}),
        request(app).post('/v1/admin/auth/revoke-sessions').set('Cookie', suppliedCookie).send({}),
        request(app).post('/v1/admin/auth/logout').set('Cookie', suppliedCookie),
      ]);
      for (const result of denied) {
        expect(result.status).toBe(401);
        expect(result.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      }
    }
  });

  it('verifies TOTP, stores a hashed full session and returns safe masked session details', async () => {
    const challenge = await preAuth();
    const response = await request(app)
      .post('/v1/admin/auth/verify-totp')
      .set('Cookie', challenge.cookie)
      .send({ code: totp() });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const fullCookie = cookie(response, 'medaxis_admin_session');
    const full = await AdminSessionModel.findOne({ purpose: 'ADMIN' }).select('+token_hash').lean();
    expect(full!.token_hash).toBe(hashToken(rawToken(fullCookie)));
    expect(cookies(response).join(' ')).toContain('Max-Age=1800');
    const list = await request(app).get('/v1/admin/auth/sessions').set('Cookie', fullCookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ current: true, ip_address: '127.0.0.*' });
    expect(list.body.data[0]).toHaveProperty('last_active_at');
    for (const forbidden of [
      full!.token_hash,
      rawToken(fullCookie),
      secret,
      'totp_secret_encrypted',
      'backup_code_hashes',
    ])
      expect(JSON.stringify(list.body)).not.toContain(forbidden);
    expect(events).toContainEqual(expect.objectContaining({ event: 'ADMIN_LOGIN', new_ip: true, severity: 'HIGH' }));
  });

  it('rejects challenge replay and rejects the same TOTP through a new challenge', async () => {
    const challenge = await preAuth();
    const code = totp();
    expect(
      (await request(app).post('/v1/admin/auth/verify-totp').set('Cookie', challenge.cookie).send({ code })).status,
    ).toBe(200);
    expect(
      (await request(app).post('/v1/admin/auth/verify-totp').set('Cookie', challenge.cookie).send({ code })).status,
    ).toBe(401);
    const other = await preAuth();
    expect(
      (await request(app).post('/v1/admin/auth/verify-totp').set('Cookie', other.cookie).send({ code })).status,
    ).toBe(401);
    expect(await AdminSessionModel.countDocuments({ purpose: 'ADMIN' })).toBe(1);
  });

  it('accepts RFC 6238 codes from the allowed adjacent time window', async () => {
    const challenge = await preAuth();
    const response = await request(app)
      .post('/v1/admin/auth/verify-totp')
      .set('Cookie', challenge.cookie)
      .send({ code: totp(Date.now() - 30_000) });
    expect(response.status).toBe(200);
  });

  it('consumes a backup code once even when two valid challenges race', async () => {
    const a = await preAuth();
    const b = await preAuth();
    const results = await Promise.all(
      [a, b].map((challenge) =>
        request(app)
          .post('/v1/admin/auth/verify-backup-code')
          .set('Cookie', challenge.cookie)
          .send({ backup_code: recoveryCode }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
    const admin = await AdminModel.findById(adminId).select('+backup_code_hashes').lean();
    expect(admin!.backup_code_hashes).toHaveLength(0);
    expect(await AdminSessionModel.countDocuments({ purpose: 'ADMIN' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action_type: 'ADMIN_BACKUP_LOGIN' })).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ event: 'ADMIN_BACKUP_LOGIN', severity: 'HIGH' }));
  });

  it('rolls back code consumption and challenge use if auditing fails', async () => {
    const challenge = await preAuth();
    const save = vi.spyOn(AuditLogModel.prototype, 'save').mockRejectedValueOnce(new Error('Test audit failure'));
    try {
      const response = await request(app)
        .post('/v1/admin/auth/verify-backup-code')
        .set('Cookie', challenge.cookie)
        .send({ backup_code: recoveryCode });
      expect(response.status).toBe(500);
      expect(await AdminSessionModel.countDocuments({ purpose: 'ADMIN' })).toBe(0);
      const admin = await AdminModel.findById(adminId).select('+backup_code_hashes').lean();
      expect(admin!.backup_code_hashes).toContain(recoveryHash);
      expect(await AdminSessionModel.countDocuments({ purpose: 'PRE_AUTH', revoked_at: null })).toBe(1);
    } finally {
      save.mockRestore();
    }
  });

  it('shares five-failure lockout across password, TOTP and recovery, with no password-only reset', async () => {
    const challenge = await preAuth();
    for (let i = 0; i < 2; i++)
      expect((await request(app).post('/v1/admin/auth/login').send({ email, password: 'wrong' })).status).toBe(401);
    await preAuth(); // Correct password alone must not erase the accumulated failures.
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(app)
            .post('/v1/admin/auth/verify-totp')
            .set('Cookie', challenge.cookie)
            .send({ code: wrongTotp() })
        ).status,
      ).toBe(401);
    const fifth = await request(app)
      .post('/v1/admin/auth/verify-backup-code')
      .set('Cookie', challenge.cookie)
      .send({ backup_code: 'wrong' });
    expect(fifth.status).toBe(403);
    expect(fifth.body.error.code).toBe('ACCESS_DENIED');
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(890);
    expect((await request(app).post('/v1/admin/auth/login').send({ email, password })).status).toBe(403);
    expect(events.filter((event) => event.event === 'ADMIN_LOCKOUT')).toHaveLength(1);
  });

  it('counts simultaneous failures atomically and emits one lockout alert', async () => {
    const onSecurityEvent = vi.fn();
    const security = createAuthSecurity(env, logger, { onSecurityEvent });
    const req = { clientIp: '8.8.8.8', requestId: randomUUID(), get: () => 'test-agent' } as unknown as Request;
    const failures = await Promise.allSettled(Array.from({ length: 10 }, () => security.fail(req)));
    expect(failures.every((result) => result.status === 'rejected')).toBe(true);
    const record = await AuthAttemptModel.findOne({ scope_key: security.scopeKey(req) }).lean();
    expect(record!.failed_count).toBe(5);
    expect(record!.locked_until!.getTime() - record!.window_started_at.getTime()).toBeGreaterThanOrEqual(15 * 60_000);
    expect(onSecurityEvent).toHaveBeenCalledTimes(1);
  });

  it('returns 403 ACCESS_DENIED on the fifth incorrect password and blocks subsequent login', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await request(app).post('/v1/admin/auth/login').send({ email, password: 'wrong' });
      expect(response.status).toBe(attempt === 5 ? 403 : 401);
      expect(response.body.error.code).toBe(attempt === 5 ? 'ACCESS_DENIED' : 'AUTHENTICATION_REQUIRED');
    }
    const blocked = await request(app).post('/v1/admin/auth/login').send({ email, password });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCESS_DENIED');
    expect(await AdminSessionModel.countDocuments()).toBe(0);
  });

  it.each([
    [-1, 200],
    [0, 401],
    [1, 401],
  ] as const)('handles a request %i ms from the 30-minute idle deadline with status %i', async (offset, status) => {
    const full = await loginBackup();
    const session = await AdminSessionModel.findOne({ purpose: 'ADMIN' }).lean();
    expect(session!.expires_at.getTime() - session!.last_seen_at.getTime()).toBe(30 * 60_000);
    const now = new Date(session!.expires_at.getTime() + offset);
    // Fake only Date: HTTP, MongoDB and their timers remain real. The deadline is
    // in the server's future, so TTL cannot delete the fixture while we inspect it.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const response = await request(app).get('/v1/admin/auth/sessions').set('Cookie', full.cookie);
    expect(response.status).toBe(status);
    const stored = await AdminSessionModel.findById(session!._id).lean();
    expect(stored).not.toBeNull();
    if (status === 200) {
      expect(stored!.last_seen_at).toEqual(now);
      expect(stored!.expires_at).toEqual(new Date(now.getTime() + ADMIN_SESSION_IDLE_MS));
    } else {
      expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      expect(stored!.last_seen_at).toEqual(session!.last_seen_at);
      expect(stored!.expires_at).toEqual(session!.expires_at);
      expect(cookies(response)).toHaveLength(0);
    }
  });

  it('slides the idle deadline on activity and expires after 30 minutes without further activity', async () => {
    const full = await loginBackup();
    const session = await AdminSessionModel.findOne({ purpose: 'ADMIN' }).lean();
    const startedAt = session!.last_seen_at.getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    // Activity at minute 29 extends expiry to minute 59; the original cookie
    // must still work after the original minute-30 database deadline.
    for (const minute of [29, 31]) {
      const now = new Date(startedAt + minute * 60_000);
      vi.setSystemTime(now);
      const response = await request(app).get('/v1/admin/auth/sessions').set('Cookie', full.cookie);
      expect(response.status).toBe(200);
      expect(cookies(response).join(' ')).toContain('Max-Age=1800');
      const renewed = await AdminSessionModel.findById(session!._id).lean();
      expect(renewed!.last_seen_at).toEqual(now);
      expect(renewed!.expires_at).toEqual(new Date(now.getTime() + ADMIN_SESSION_IDLE_MS));
    }
    vi.setSystemTime(new Date(startedAt + 61 * 60_000));
    const expired = await request(app).get('/v1/admin/auth/sessions').set('Cookie', full.cookie);
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(await AdminSessionModel.exists({ _id: session!._id })).not.toBeNull();
  });

  it('rejects expired and revoked sessions without relying on TTL cleanup', async () => {
    const full = await loginBackup();
    await AdminSessionModel.updateOne({ purpose: 'ADMIN' }, { $set: { expires_at: new Date(0) } });
    expect((await request(app).get('/v1/admin/auth/sessions').set('Cookie', full.cookie)).status).toBe(401);
    await AdminSessionModel.updateOne(
      { purpose: 'ADMIN' },
      { $set: { expires_at: new Date(Date.now() + 60_000), revoked_at: new Date() } },
    );
    expect((await request(app).get('/v1/admin/auth/sessions').set('Cookie', full.cookie)).status).toBe(401);
  });

  it('revokes other sessions and pending challenges while retaining the current session', async () => {
    const current = await loginBackup();
    const challenge = await preAuth();
    const other = await request(app)
      .post('/v1/admin/auth/verify-totp')
      .set('Cookie', challenge.cookie)
      .send({ code: totp() });
    expect(other.status).toBe(200);
    const pending = await preAuth();
    const revoked = await request(app).post('/v1/admin/auth/revoke-sessions').set('Cookie', current.cookie).send({});
    expect(revoked.status).toBe(200);
    const denied = await request(app)
      .get('/v1/admin/auth/sessions')
      .set('Cookie', cookie(other, 'medaxis_admin_session'));
    expect(denied.status).toBe(401);
    expect(denied.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect((await request(app).get('/v1/admin/auth/sessions').set('Cookie', current.cookie)).status).toBe(200);
    expect(
      (await request(app).post('/v1/admin/auth/verify-totp').set('Cookie', pending.cookie).send({ code: totp() }))
        .status,
    ).toBe(401);
  });

  it('logs out, clears the cookie and invalidates the server session', async () => {
    const full = await loginBackup();
    const logout = await request(app).post('/v1/admin/auth/logout').set('Cookie', full.cookie);
    expect(logout.status).toBe(200);
    expect(cookies(logout).some((value) => value.startsWith('medaxis_admin_session=;'))).toBe(true);
    expect((await request(app).get('/v1/admin/auth/sessions').set('Cookie', full.cookie)).status).toBe(401);
    expect(await AuditLogModel.countDocuments({ action_type: 'ADMIN_LOGOUT' })).toBe(1);
  });

  it('enrolls encrypted TOTP and eight cost-12 backup codes, and returns plaintext codes only once', async () => {
    const full = await loginBackup();
    const enrolled = await request(app).post('/v1/admin/auth/2fa/enroll').set('Cookie', full.cookie).send({});
    expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(200);
    const data = enrolled.body.data as { qr_data_url: string; backup_codes: string[] };
    expect(data.qr_data_url).toMatch(/^data:image\/png;base64,/);
    expect(new Set(data.backup_codes).size).toBe(8);
    const admin = await AdminModel.findById(adminId).select('+totp_secret_encrypted +backup_code_hashes').lean();
    expect(admin!.backup_code_hashes).toHaveLength(8);
    expect(bcrypt.getRounds(admin!.backup_code_hashes[0]!)).toBe(12);
    expect(await bcrypt.compare(data.backup_codes[0]!, admin!.backup_code_hashes[0]!)).toBe(true);
    const decrypted = decrypt(JSON.parse(admin!.totp_secret_encrypted) as unknown, key, 'auth-test-v1').toString();
    expect(decrypted).toMatch(/^[A-Z2-7]+$/);
    expect(decrypted).not.toBe(secret);
    const audit = JSON.stringify(await AuditLogModel.find({}).lean());
    for (const sensitive of [...data.backup_codes, decrypted, data.qr_data_url, password, recoveryCode])
      expect(audit).not.toContain(sensitive);
    const list = await request(app).get('/v1/admin/auth/sessions').set('Cookie', full.cookie);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(data.backup_codes[0]);
  });
});
