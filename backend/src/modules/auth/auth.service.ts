import { randomBytes, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { ADMIN_SESSION_IDLE_MS } from '../../config/constants.js';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { decrypt, encrypt, generateToken, hashPassword, hashToken, verifyPassword } from '../../shared/utils/crypto.js';
import { lookupGeoIp, maskIp } from '../../shared/utils/geoip.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { AuditLogModel } from '../audit/audit.schema.js';
import { AdminModel, AdminSessionModel, AuthAttemptModel } from './auth.schema.js';
import { createAuthSecurity, PRE_AUTH_MS, securityContext, type AuthHooks } from './auth.security.js';

class MfaRejected extends Error {}

export function createAuthService(env: AppEnv, logger: AppLogger, hooks: AuthHooks = {}) {
  const security = createAuthSecurity(env, logger, hooks);
  let dummyHash: Promise<string> | undefined;
  const encryptionKey = () => {
    if (!env.TOTP_ENCRYPTION_KEY_BASE64 || !env.TOTP_KEY_ID)
      throw AppError.unavailable('TOTP encryption is not configured.');
    const key = Buffer.from(env.TOTP_ENCRYPTION_KEY_BASE64, 'base64');
    if (key.length !== 32) throw AppError.unavailable('TOTP encryption is not configured.');
    return { key, keyId: env.TOTP_KEY_ID };
  };

  async function login(req: Request, email: string, password: string) {
    await security.assertUnlocked(req);
    const admin = await AdminModel.findOne({ email }).select('+password_hash').lean();
    const hash = admin?.password_hash ?? (await (dummyHash ??= hashPassword(generateToken())));
    const valid = await verifyPassword(hash, password);
    if (!admin?.is_active || !valid) return security.fail(req);
    // Successful password checks deliberately preserve the failure counter until MFA completes.
    await security.assertUnlocked(req);
    const now = new Date();
    const token = generateToken();
    const { ip, userAgent } = securityContext(req);
    const expiresAt = new Date(now.getTime() + PRE_AUTH_MS);
    await AdminSessionModel.create({
      admin_id: admin._id,
      token_hash: hashToken(token),
      purpose: 'PRE_AUTH',
      session_generation: admin.session_generation,
      last_seen_at: now,
      expires_at: expiresAt,
      ip_address: ip,
      device_label: hashToken(userAgent),
    });
    return { token, expires_at: expiresAt };
  }

  async function completeMfa(req: Request, preAuthToken: unknown, code: string, method: 'TOTP' | 'BACKUP') {
    await security.assertUnlocked(req);
    if (typeof preAuthToken !== 'string' || !/^[a-f0-9]{64}$/.test(preAuthToken)) return security.fail(req);
    const now = new Date();
    const { ip, userAgent } = securityContext(req);
    const challengeFilter = {
      token_hash: hashToken(preAuthToken),
      purpose: 'PRE_AUTH' as const,
      revoked_at: null,
      expires_at: { $gt: now },
      ip_address: ip,
      device_label: hashToken(userAgent),
    };
    const challenge = await AdminSessionModel.findOne(challengeFilter).lean();
    if (!challenge) return security.fail(req);
    const admin = await AdminModel.findOne({
      _id: challenge.admin_id,
      is_active: true,
      session_generation: challenge.session_generation,
    })
      .select('+totp_secret_encrypted +backup_code_hashes +last_totp_step')
      .lean();
    if (!admin) return security.fail(req);
    let backupHash: string | undefined;
    let matchedStep: number | undefined;
    if (method === 'TOTP') {
      const { key, keyId } = encryptionKey();
      let secret: string;
      try {
        secret = decrypt(JSON.parse(admin.totp_secret_encrypted) as unknown, key, keyId).toString('utf8');
      } catch {
        throw AppError.unavailable('TOTP verification is temporarily unavailable.');
      }
      const options = {
        secret,
        encoding: 'base32' as const,
        token: code,
        window: 1,
        time: Math.floor(now.getTime() / 1000),
      };
      if (!speakeasy.totp.verify(options)) return security.fail(req);
      const delta = speakeasy.totp.verifyDelta(options);
      if (!delta) return security.fail(req);
      matchedStep = Math.floor(now.getTime() / 30_000) + delta.delta;
    } else {
      for (const hash of admin.backup_code_hashes) {
        if (await bcrypt.compare(code, hash)) {
          backupHash = hash;
          break;
        }
      }
      if (!backupHash) return security.fail(req);
    }
    const rawToken = generateToken();
    const sessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_IDLE_MS);
    const geo = lookupGeoIp(ip);
    let newIp = false;
    try {
      await mongoose.connection.transaction(async (transaction) => {
        const locked = await AuthAttemptModel.exists({
          scope_key: security.scopeKey(req),
          locked_until: { $gt: new Date() },
        }).session(transaction);
        if (locked) throw AppError.forbidden('Too many failed authentication attempts. Try again later.');
        const consumed = await AdminSessionModel.findOneAndUpdate(
          { ...challengeFilter, _id: challenge._id },
          { $set: { revoked_at: now } },
          { session: transaction, returnDocument: 'after' },
        );
        if (!consumed) throw new MfaRejected();
        const updated = await AdminModel.findOneAndUpdate(
          {
            _id: admin._id,
            is_active: true,
            session_generation: challenge.session_generation,
            totp_secret_encrypted: admin.totp_secret_encrypted,
            ...(method === 'BACKUP'
              ? { backup_code_hashes: backupHash }
              : {
                  $or: [{ last_totp_step: { $exists: false } }, { last_totp_step: { $lt: matchedStep } }],
                }),
          },
          method === 'BACKUP'
            ? { $pull: { backup_code_hashes: backupHash } }
            : { $set: { last_totp_step: matchedStep } },
          { session: transaction, returnDocument: 'after' },
        );
        if (!updated) throw new MfaRejected();
        newIp = !(await AuditLogModel.exists({
          actor_id: admin._id,
          action_type: { $in: ['ADMIN_LOGIN', 'ADMIN_BACKUP_LOGIN'] },
          ip_address: ip,
        }).session(transaction));
        await new AdminSessionModel({
          _id: sessionId,
          admin_id: admin._id,
          purpose: 'ADMIN',
          token_hash: hashToken(rawToken),
          session_generation: admin.session_generation,
          last_seen_at: now,
          expires_at: expiresAt,
          ip_address: ip,
          device_label: userAgent.slice(0, 200),
          user_agent: userAgent,
          geo: { country: geo.country ?? undefined, city: geo.city?.slice(0, 200) },
        }).save({ session: transaction });
        await writeAuditLog(
          req,
          {
            actor_type: 'SUPER_ADMIN',
            actor_id: admin._id,
            action: method === 'BACKUP' ? 'ADMIN_BACKUP_LOGIN' : 'ADMIN_LOGIN',
            entity_type: 'admin_sessions',
            entity_id: sessionId,
            metadata: {
              severity:
                method === 'BACKUP' || newIp || (geo.country && geo.country !== security.homeCountry) ? 'HIGH' : 'INFO',
              method,
              country: geo.country,
              city: geo.city,
              new_ip: newIp,
            },
          },
          transaction,
        );
        await AuthAttemptModel.deleteOne({ scope_key: security.scopeKey(req) }).session(transaction);
      });
    } catch (error) {
      if (error instanceof MfaRejected) return security.fail(req);
      throw error;
    }
    security.notify({
      event: method === 'BACKUP' ? 'ADMIN_BACKUP_LOGIN' : 'ADMIN_LOGIN',
      severity: method === 'BACKUP' || newIp || (geo.country && geo.country !== security.homeCountry) ? 'HIGH' : 'INFO',
      admin_id: admin._id,
      session_id: sessionId,
      ip_address: ip,
      user_agent: userAgent,
      ...geo,
      new_ip: newIp,
      foreign_ip: !!geo.country && geo.country !== security.homeCountry,
      ...security.eventTimes(now),
      request_id: req.requestId,
    });
    return {
      token: rawToken,
      expires_at: expiresAt,
      admin: { id: admin._id, email: admin.email },
      session_id: sessionId,
    };
  }

  async function enroll(req: Request) {
    const { key, keyId } = encryptionKey();
    const admin = await AdminModel.findOne({ _id: req.admin!.id, is_active: true }).lean();
    if (!admin) throw AppError.unauthorized();
    const secret = speakeasy.generateSecret({
      length: 32,
      name: `MedAxis (${admin.email})`,
      issuer: 'MedAxis Global Pharma',
    });
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!);
    const codes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex'));
    const hashes = await Promise.all(codes.map((code) => bcrypt.hash(code, 12)));
    const encrypted = JSON.stringify(encrypt(secret.base32, key, keyId));
    const now = new Date();
    await mongoose.connection.transaction(async (transaction) => {
      const changed = await AdminModel.findOneAndUpdate(
        { _id: admin._id, is_active: true, session_generation: admin.session_generation },
        {
          $set: { totp_secret_encrypted: encrypted, backup_code_hashes: hashes },
          $inc: { session_generation: 1 },
          $unset: { last_totp_step: 1 },
        },
        { session: transaction, returnDocument: 'after' },
      );
      if (!changed) throw AppError.conflict('Authentication settings changed. Authenticate again.');
      // Rotate the generation and revoke all other full sessions and pending password challenges.
      const current = await AdminSessionModel.updateOne(
        {
          _id: req.admin!.sessionId,
          admin_id: admin._id,
          purpose: 'ADMIN',
          revoked_at: null,
          expires_at: { $gt: now },
          session_generation: admin.session_generation,
        },
        { $set: { session_generation: changed.session_generation } },
        { session: transaction },
      );
      if (current.matchedCount !== 1) throw AppError.unauthorized();
      await AdminSessionModel.updateMany(
        { admin_id: admin._id, _id: { $ne: req.admin!.sessionId }, revoked_at: null },
        { $set: { revoked_at: now } },
        { session: transaction },
      );
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: admin._id,
          action: 'ADMIN_2FA_ENROLLED',
          entity_type: 'admins',
          entity_id: admin._id,
          metadata: { severity: 'HIGH', backup_codes_generated: 8 },
        },
        transaction,
      );
    });
    const { ip, userAgent } = securityContext(req);
    security.notify({
      event: 'ADMIN_2FA_ENROLLED',
      severity: 'HIGH',
      admin_id: admin._id,
      ip_address: ip,
      user_agent: userAgent,
      ...lookupGeoIp(ip),
      ...security.eventTimes(now),
      request_id: req.requestId,
    });
    return { qr_data_url: qrDataUrl, backup_codes: codes };
  }

  async function sessions(req: Request) {
    const admin = await AdminModel.findOne({ _id: req.admin!.id, is_active: true }).lean();
    if (!admin) throw AppError.unauthorized();
    const rows = await AdminSessionModel.find({
      admin_id: admin._id,
      session_generation: admin.session_generation,
      purpose: 'ADMIN',
      revoked_at: null,
      expires_at: { $gt: new Date() },
    })
      .sort({ last_seen_at: -1 })
      .lean();
    return rows.map((row) => ({
      id: row._id,
      current: row._id === req.admin!.sessionId,
      ip_address: maskIp(row.ip_address),
      geo: row.geo ?? lookupGeoIp(row.ip_address),
      user_agent: row.user_agent ?? row.device_label ?? null,
      last_active_at: row.last_seen_at,
      expires_at: row.expires_at,
    }));
  }

  async function revokeSessions(req: Request) {
    const now = new Date();
    let revoked = 0;
    await mongoose.connection.transaction(async (transaction) => {
      const admin = await AdminModel.findOneAndUpdate(
        { _id: req.admin!.id, is_active: true },
        { $inc: { session_generation: 1 } },
        { session: transaction, returnDocument: 'after' },
      );
      if (!admin) throw AppError.unauthorized();
      const current = await AdminSessionModel.updateOne(
        {
          _id: req.admin!.sessionId,
          admin_id: admin._id,
          purpose: 'ADMIN',
          revoked_at: null,
          expires_at: { $gt: now },
          session_generation: admin.session_generation - 1,
        },
        { $set: { session_generation: admin.session_generation } },
        { session: transaction },
      );
      if (current.matchedCount !== 1) throw AppError.unauthorized();
      const result = await AdminSessionModel.updateMany(
        { admin_id: admin._id, _id: { $ne: req.admin!.sessionId }, revoked_at: null, expires_at: { $gt: now } },
        { $set: { revoked_at: now } },
        { session: transaction },
      );
      revoked = result.modifiedCount;
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: admin._id,
          action: 'ADMIN_SESSIONS_REVOKED',
          entity_type: 'admins',
          entity_id: admin._id,
          metadata: { revoked_count: revoked },
        },
        transaction,
      );
    });
    return { revoked_count: revoked };
  }

  async function logout(req: Request) {
    await mongoose.connection.transaction(async (transaction) => {
      await AdminSessionModel.updateOne(
        { _id: req.admin!.sessionId, admin_id: req.admin!.id, purpose: 'ADMIN' },
        { $set: { revoked_at: new Date() } },
        { session: transaction },
      );
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'ADMIN_LOGOUT',
          entity_type: 'admin_sessions',
          entity_id: req.admin!.sessionId,
        },
        transaction,
      );
    });
    return { logged_out: true };
  }

  return { login, completeMfa, enroll, sessions, revokeSessions, logout };
}

export type AuthService = ReturnType<typeof createAuthService>;
