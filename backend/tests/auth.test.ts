import { randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { AdminModel, AdminSessionModel } from '../src/modules/auth/auth.schema.js';
import { createAuthSecurity, LOCKOUT_MS } from '../src/modules/auth/auth.security.js';
import { AuthAttemptModel } from '../src/modules/auth/auth.schema.js';
import { adminAuth, sessionCookieOptions } from '../src/shared/middleware/adminAuth.js';
import { writeAuditLog } from '../src/shared/middleware/auditLogger.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import {
  decrypt,
  encrypt,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../src/shared/utils/crypto.js';
import { lookupGeoIp, maskIp } from '../src/shared/utils/geoip.js';
import geoip from 'geoip-lite';
import { createLogger, redact } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';

const env = loadEnv(validEnv);
const logger = createLogger({ silent: true });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('auth cryptography', () => {
  it('issues distinct 256-bit tokens and stores deterministic SHA-256 hashes', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toHaveLength(64);
    expect(hashToken(a)).not.toBe(a);
    expect(hashToken(a)).toBe(hashToken(a));
  });
  it('round-trips arbitrary bytes with randomized authenticated encryption', () => {
    const key = randomBytes(32);
    const data = randomBytes(257);
    const a = encrypt(data, key, 'test-v1');
    expect(decrypt(a, key, 'test-v1')).toEqual(data);
    expect(encrypt(data, key, 'test-v1').iv).not.toBe(a.iv);
    expect(() => decrypt({ ...a, ciphertext: randomBytes(32).toString('base64') }, key, 'test-v1')).toThrow(
      'Unable to decrypt',
    );
    expect(() => decrypt(a, randomBytes(32), 'test-v1')).toThrow('Unable to decrypt');
    expect(() => decrypt(a, key, 'wrong-id')).toThrow('Unable to decrypt');
    expect(() => decrypt({ ...a, algorithm: 'aes-128-cbc' }, key, 'test-v1')).toThrow('Unable to decrypt');
    expect(() => encrypt(data, Buffer.alloc(16), 'test-v1')).toThrow('Invalid encryption');
  });
  it('uses Argon2id and refuses invalid or incorrect passwords', async () => {
    const hash = await hashPassword('test-only password');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'test-only password')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
    expect(await verifyPassword('malformed', 'wrong')).toBe(false);
  });
});

describe('GeoIP safety', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.1.2',
    '192.168.1.2',
    '169.254.1.2',
    '100.64.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'invalid',
    undefined,
  ])('returns unknown for private or malformed IP %s', (ip) => {
    const lookup = vi.spyOn(geoip, 'lookup');
    expect(lookupGeoIp(ip)).toEqual({ country: null, city: null });
    expect(lookup).not.toHaveBeenCalled();
  });
  it('handles lookup failure and masks both IP families', () => {
    vi.spyOn(geoip, 'lookup').mockImplementation(() => {
      throw new Error('lookup unavailable');
    });
    expect(lookupGeoIp('8.8.8.8')).toEqual({ country: null, city: null });
    expect(maskIp('::ffff:8.8.8.8')).toBe('8.8.8.*');
    expect(maskIp('2606:4700:4700::1111')).toBe('2606:4700:4700:*');
    expect(maskIp('invalid')).toBeNull();
  });
});

describe('admin session guard', () => {
  const req = (token?: unknown) => ({ signedCookies: { medaxis_admin_session: token } }) as unknown as Request;
  const res = () => ({ cookie: vi.fn() }) as unknown as Response;
  it.each([undefined, false, 'bad', 's:forged', 'a'.repeat(65)])(
    'rejects missing or malformed signed tokens',
    async (token) => {
      const find = vi.spyOn(AdminSessionModel, 'findOne');
      const next = vi.fn();
      await adminAuth(env)(req(token), res(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401, code: 'AUTHENTICATION_REQUIRED' }));
      expect(find).not.toHaveBeenCalled();
    },
  );
  it('filters session purpose, revocation and exact expiry before renewal', async () => {
    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue({ lean: async () => null } as never);
    const next = vi.fn();
    const token = generateToken();
    await adminAuth(env)(req(token), res(), next);
    expect(AdminSessionModel.findOne).toHaveBeenCalledWith({
      token_hash: hashToken(token),
      purpose: 'ADMIN',
      revoked_at: null,
      expires_at: { $gt: expect.any(Date) },
    });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });
  it('renews a valid session by 30 minutes and attaches only the admin/session IDs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T00:00:00Z'));
    const candidate = { _id: randomUUID(), admin_id: randomUUID(), session_generation: 4 };
    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue({ lean: async () => candidate } as never);
    vi.spyOn(AdminModel, 'exists').mockResolvedValue({ _id: candidate.admin_id });
    vi.spyOn(AdminSessionModel, 'findOneAndUpdate').mockReturnValue({ lean: async () => candidate } as never);
    const next = vi.fn();
    const incoming = req(generateToken());
    const response = res();
    await adminAuth(env)(incoming, response, next);
    expect(next).toHaveBeenCalledWith();
    expect(incoming.admin).toEqual({ id: candidate.admin_id, sessionId: candidate._id });
    expect(AdminSessionModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: null, session_generation: 4 }),
      { $max: { last_seen_at: new Date(), expires_at: new Date(Date.now() + 30 * 60_000) } },
      { returnDocument: 'after' },
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'medaxis_admin_session',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', signed: true, maxAge: 1_800_000 }),
    );
    expect(sessionCookieOptions({ isProduction: true }).secure).toBe(true);
  });
  it('does not revive a session revoked between reading and renewal', async () => {
    vi.spyOn(AdminSessionModel, 'findOne').mockReturnValue({
      lean: async () => ({ _id: randomUUID(), admin_id: randomUUID(), session_generation: 0 }),
    } as never);
    vi.spyOn(AdminModel, 'exists').mockResolvedValue({ _id: randomUUID() });
    vi.spyOn(AdminSessionModel, 'findOneAndUpdate').mockReturnValue({ lean: async () => null } as never);
    const next = vi.fn();
    await adminAuth(env)(req(generateToken()), res(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });
});

describe('persistent brute-force controls', () => {
  const req = { clientIp: '127.0.0.1', requestId: randomUUID(), get: () => 'test-agent' } as unknown as Request;
  it('locks the fifth failure with one high-priority alert and does not extend an active lock', async () => {
    const now = new Date();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const notify = vi.fn();
    vi.spyOn(AuthAttemptModel, 'findOneAndUpdate')
      .mockReturnValueOnce({
        lean: async () => ({ failed_count: 4, expires_at: new Date(Date.now() + 60_000) }),
      } as never)
      .mockReturnValueOnce({
        lean: async () => ({
          failed_count: 5,
          locked_until: new Date(Date.now() + 100_000),
          expires_at: new Date(Date.now() + 100_000),
        }),
      } as never);
    const security = createAuthSecurity(env, logger, { onSecurityEvent: notify });
    await expect(security.fail(req)).rejects.toMatchObject({ status: 403, retryAfter: LOCKOUT_MS / 1000 });
    await Promise.resolve();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'ADMIN_LOCKOUT', severity: 'HIGH' }));
    await expect(security.fail(req)).rejects.toMatchObject({ status: 403, retryAfter: 100 });
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('resets an expired record independently of delayed TTL deletion', async () => {
    vi.spyOn(AuthAttemptModel, 'findOneAndUpdate').mockReturnValue({
      lean: async () => ({ failed_count: 5, expires_at: new Date(0), locked_until: new Date(0) }),
    } as never);
    await expect(createAuthSecurity(env, logger).fail(req)).rejects.toMatchObject({ status: 401 });
  });
});

describe('auth HTTP boundaries and audit privacy', () => {
  const app = () => createApp({ env, logger, checkDatabase: async () => ({ status: 'connected' }) });
  it.each(['/2fa/enroll', '/revoke-sessions', '/logout'])('requires full ADMIN_AUTH for %s', async (path) => {
    const result = await request(app()).post(`/v1/admin/auth${path}`).send({});
    expect(result.status).toBe(401);
    expect(result.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
  it('rejects unsigned cookies, hostile origins and malformed payloads', async () => {
    const unsigned = await request(app())
      .get('/v1/admin/auth/sessions')
      .set('Cookie', `medaxis_admin_session=${generateToken()}`);
    expect(unsigned.status).toBe(401);
    expect(
      (
        await request(app())
          .post('/v1/admin/auth/login')
          .set('Origin', 'https://attacker.test')
          .send({ email: 'a@example.test', password: 'p' })
      ).status,
    ).toBe(403);
    expect((await request(app()).post('/v1/admin/auth/verify-totp').send({ code: '123' })).status).toBe(422);
  });
  it('appends audit context with credential metadata redacted', async () => {
    const save = vi.spyOn(AuditLogModel.prototype, 'save').mockImplementation(async function () {
      return this;
    });
    const id = randomUUID();
    await writeAuditLog(
      { requestId: id, clientIp: '127.0.0.1', get: () => 'test-agent' },
      {
        actor_type: 'SYSTEM',
        action: 'TEST',
        entity_type: 'admins',
        entity_id: id,
        metadata: { password: 'DO-NOT-LOG', code: '123456', qr_data_url: 'secret-qr', safe: 'value' },
      },
    );
    const saved = save.mock.instances[0]!;
    expect(saved.action_type).toBe('TEST');
    expect(saved.request_id).toBe(id);
    expect(saved.safe_changes).toEqual({
      password: '[REDACTED]',
      code: '[REDACTED]',
      qr_data_url: '[REDACTED]',
      safe: 'value',
    });
    expect(redact({ backup_code_hashes: ['secret'], recovery_codes: ['secret'], otpauth_url: 'secret' })).toEqual({
      backup_code_hashes: '[REDACTED]',
      recovery_codes: '[REDACTED]',
      otpauth_url: '[REDACTED]',
    });
  });
});
