import { randomBytes, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { fileTypeFromBuffer } from 'file-type';
import { ADMIN_SESSION_IDLE_MS } from '../../config/constants.js';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { decrypt, encrypt, generateToken, hashPassword, hashToken, verifyPassword } from '../../shared/utils/crypto.js';
import { lookupGeoIp, maskIp } from '../../shared/utils/geoip.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { AuditLogModel } from '../audit/audit.schema.js';
import { createMailTransport } from '../notification/notification.transport.js';
import { ADMIN_AVATAR_JPEG_PREFIX, AdminModel, AdminSessionModel, AuthAttemptModel, type IAdmin } from './auth.schema.js';
import { createStorageService } from '../storage/storage.service.js';
import { createAuthSecurity, PRE_AUTH_MS, securityContext, type AuthHooks } from './auth.security.js';

class MfaRejected extends Error {}

export function createAuthService(env: AppEnv, logger: AppLogger, hooks: AuthHooks = {}, storage = createStorageService(env)) {
  const security = createAuthSecurity(env, logger, hooks);
  let dummyHash: Promise<string> | undefined;
  const encryptionKey = () => {
    if (!env.TOTP_ENCRYPTION_KEY_BASE64 || !env.TOTP_KEY_ID)
      throw AppError.unavailable('TOTP encryption is not configured.');
    const key = Buffer.from(env.TOTP_ENCRYPTION_KEY_BASE64, 'base64');
    if (key.length !== 32) throw AppError.unavailable('TOTP encryption is not configured.');
    return { key, keyId: env.TOTP_KEY_ID };
  };

  async function verifyCredentials(req: Request, email: string, password: string) {
    await security.assertUnlocked(req);
    const admin = await AdminModel.findOne({ email }).select('+password_hash').lean();
    const hash = admin?.password_hash ?? (await (dummyHash ??= hashPassword(generateToken())));
    const valid = await verifyPassword(hash, password);
    if (!admin?.is_active || !valid) return security.fail(req);
    return admin;
  }

  async function issueAdminSession(
    req: Request,
    admin: { _id: string; email: string; session_generation: number },
    method: 'TOTP' | 'BACKUP' | 'PASSWORD',
    now: Date,
    extra: {
      challengeFilter?: Record<string, unknown>;
      challengeId?: string;
      totpSecretEncrypted?: string;
      backupHash?: string;
      matchedStep?: number;
    } = {},
  ) {
    const rawToken = generateToken();
    const sessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + ADMIN_SESSION_IDLE_MS);
    const { ip, userAgent } = securityContext(req);
    const geo = lookupGeoIp(ip);
    let newIp = false;
    try {
      await mongoose.connection.transaction(async (transaction) => {
        const locked = await AuthAttemptModel.exists({
          scope_key: security.scopeKey(req),
          locked_until: { $gt: new Date() },
        }).session(transaction);
        if (locked) throw AppError.forbidden('Too many failed authentication attempts. Try again later.');
        if (extra.challengeFilter && extra.challengeId) {
          const consumed = await AdminSessionModel.findOneAndUpdate(
            { ...extra.challengeFilter, _id: extra.challengeId },
            { $set: { revoked_at: now } },
            { session: transaction, returnDocument: 'after' },
          );
          if (!consumed) throw new MfaRejected();
        }
        if (method !== 'PASSWORD') {
          const updated = await AdminModel.findOneAndUpdate(
            {
              _id: admin._id,
              is_active: true,
              session_generation: admin.session_generation,
              totp_secret_encrypted: extra.totpSecretEncrypted,
              ...(method === 'BACKUP'
                ? { backup_code_hashes: extra.backupHash }
                : {
                    $or: [{ last_totp_step: { $exists: false } }, { last_totp_step: { $lt: extra.matchedStep } }],
                  }),
            },
            method === 'BACKUP'
              ? { $pull: { backup_code_hashes: extra.backupHash } }
              : { $set: { last_totp_step: extra.matchedStep } },
            { session: transaction, returnDocument: 'after' },
          );
          if (!updated) throw new MfaRejected();
        }
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

  async function login(req: Request, email: string, password: string) {
    const admin = await verifyCredentials(req, email, password);
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

  async function loginDirect(req: Request, email: string, password: string) {
    const admin = await verifyCredentials(req, email, password);
    return issueAdminSession(req, admin, 'PASSWORD', new Date());
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
    return issueAdminSession(req, admin, method, now, {
      challengeFilter,
      challengeId: challenge._id,
      totpSecretEncrypted: admin.totp_secret_encrypted,
      backupHash,
      matchedStep,
    });
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

  async function profileResult(admin: Pick<IAdmin, '_id' | 'email' | 'display_name' | 'phone_number' | 'avatar_url' | 'avatar_object_key'>) {
    return {
      id: admin._id,
      email: admin.email,
      display_name: admin.display_name ?? '',
      phone_number: admin.phone_number ?? '',
      avatar_url: admin.avatar_object_key ? await storage.signAvatar(admin.avatar_object_key) : admin.avatar_url || null,
    };
  }

  async function profile(req: Request) {
    const admin = await AdminModel.findOne({ _id: req.admin!.id, is_active: true }).select('+avatar_url +avatar_object_key').lean();
    if (!admin) throw AppError.unauthorized();
    return profileResult(admin);
  }

  async function updateProfile(req: Request, body: { email: string; display_name: string; phone_number: string; avatar_url?: string | null; current_password?: string }) {
    const admin = await AdminModel.findOne({ _id: req.admin!.id, is_active: true }).select('+password_hash +avatar_url +avatar_object_key').lean();
    if (!admin) throw AppError.unauthorized();
    const emailChanged = body.email !== admin.email;
    if (emailChanged && (!body.current_password || !await verifyPassword(admin.password_hash, body.current_password)))
      throw AppError.forbidden('Current password is required to change the login email.');
    const avatar = body.avatar_url;
    const avatarChanged = avatar !== undefined && (avatar !== (admin.avatar_url || null) || Boolean(admin.avatar_object_key));
    let avatarKey: string | undefined;
    if (avatarChanged && avatar) {
      const data = avatar.startsWith(ADMIN_AVATAR_JPEG_PREFIX) ? avatar.slice(ADMIN_AVATAR_JPEG_PREFIX.length) : null;
      const bytes = data === null ? null : Buffer.from(data, 'base64');
      const validJpeg = bytes && bytes.toString('base64') === data &&
        (await fileTypeFromBuffer(bytes).catch(() => undefined))?.mime === 'image/jpeg';
      if (!validJpeg || !bytes)
        throw AppError.validation([{ field: 'avatar_url', issue: 'Choose a valid profile picture.' }]);
      avatarKey = await storage.uploadAvatar(bytes);
    }
    let saved;
    try {
      saved = await mongoose.connection.transaction(async (transaction) => {
        const unset = {
          ...(avatarChanged || admin.avatar_url === '' ? { avatar_url: 1 } : {}),
          ...(avatarChanged && !avatarKey ? { avatar_object_key: 1 } : {}),
        };
        const changed = await AdminModel.findOneAndUpdate(
          { _id: admin._id, is_active: true, updated_at: admin.updated_at },
          {
            $set: { email: body.email, display_name: body.display_name, phone_number: body.phone_number, ...(avatarKey ? { avatar_object_key: avatarKey } : {}) },
            ...(Object.keys(unset).length ? { $unset: unset } : {}),
          },
          { session: transaction, returnDocument: 'after', runValidators: true },
        ).select('+avatar_url +avatar_object_key').lean();
        if (!changed) throw AppError.conflict('Profile changed elsewhere. Refresh and try again.');
        await writeAuditLog(req, {
          actor_type: 'SUPER_ADMIN', actor_id: admin._id, action: 'ADMIN_PROFILE_UPDATED',
          entity_type: 'admins', entity_id: admin._id, metadata: { email_changed: emailChanged, avatar_changed: avatarChanged },
        }, transaction);
        return changed;
      });
    } catch (error) {
      // An uncertain commit may still reference the uploaded object.
      if (avatarKey && error instanceof AppError && error.status === 409)
        await storage.remove('avatars', avatarKey).catch(() => logger.warn('Unable to remove unused avatar'));
      throw error;
    }
    if (avatarChanged && admin.avatar_object_key)
      await storage.remove('avatars', admin.avatar_object_key).catch(() => logger.warn('Unable to remove replaced avatar'));
    return profileResult(saved);
  }

  async function changePassword(req: Request, currentPassword: string, newPassword: string) {
    const admin = await AdminModel.findOne({ _id: req.admin!.id, is_active: true }).select('+password_hash').lean();
    if (!admin) throw AppError.unauthorized();
    if (!await verifyPassword(admin.password_hash, currentPassword)) throw AppError.forbidden('Current password is incorrect.');
    if (await verifyPassword(admin.password_hash, newPassword)) throw AppError.validation([{ field: 'new_password', issue: 'Choose a different password.' }]);
    const passwordHash = await hashPassword(newPassword);
    const now = new Date();
    await mongoose.connection.transaction(async (transaction) => {
      const changed = await AdminModel.findOneAndUpdate(
        { _id: admin._id, is_active: true, password_hash: admin.password_hash, session_generation: admin.session_generation },
        { $set: { password_hash: passwordHash }, $inc: { session_generation: 1 } },
        { session: transaction, returnDocument: 'after' },
      );
      if (!changed) throw AppError.conflict('Credentials changed. Sign in again.');
      const current = await AdminSessionModel.updateOne(
        { _id: req.admin!.sessionId, admin_id: admin._id, purpose: 'ADMIN', revoked_at: null, expires_at: { $gt: now }, session_generation: admin.session_generation },
        { $set: { session_generation: changed.session_generation } }, { session: transaction },
      );
      if (current.matchedCount !== 1) throw AppError.unauthorized();
      await AdminSessionModel.updateMany({ admin_id: admin._id, _id: { $ne: req.admin!.sessionId }, revoked_at: null }, { $set: { revoked_at: now } }, { session: transaction });
      await writeAuditLog(req, { actor_type: 'SUPER_ADMIN', actor_id: admin._id, action: 'ADMIN_PASSWORD_CHANGED', entity_type: 'admins', entity_id: admin._id }, transaction);
    });
    return { changed: true };
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

  const PASSWORD_RESET_MS = 15 * 60_000;
  const mail = createMailTransport(env);

  async function requestPasswordReset(req: Request, email: string) {
    await security.assertUnlocked(req);
    const admin = await AdminModel.findOne({ email, is_active: true }).lean();
    if (!admin) return { requested: true as const };
    const now = new Date();
    const rawToken = generateToken();
    const tokenId = randomUUID();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_MS);
    const { ip, userAgent } = securityContext(req);
    await mongoose.connection.transaction(async (transaction) => {
      await AdminSessionModel.updateMany(
        { admin_id: admin._id, purpose: 'PASSWORD_RESET', revoked_at: null },
        { $set: { revoked_at: now } },
        { session: transaction },
      );
      await new AdminSessionModel({
        _id: tokenId,
        admin_id: admin._id,
        purpose: 'PASSWORD_RESET',
        token_hash: hashToken(rawToken),
        session_generation: admin.session_generation,
        last_seen_at: now,
        expires_at: expiresAt,
        ip_address: ip,
        device_label: userAgent.slice(0, 200),
        user_agent: userAgent,
      }).save({ session: transaction });
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: admin._id,
          action: 'ADMIN_PASSWORD_RESET_REQUESTED',
          entity_type: 'admins',
          entity_id: admin._id,
          metadata: { severity: 'HIGH', token_id: tokenId },
        },
        transaction,
      );
    });
    const resetOrigin = (env.PUBLIC_ORIGIN[0] ?? 'http://localhost:3000').replace(/\/$/, '');
    const resetUrl = `${resetOrigin}/admin/login?reset=${encodeURIComponent(rawToken)}`;
    if (mail.ready()) {
      try {
        await mail.send(
          env.RESEND_API_KEY ? 'RESEND' : 'BREVO',
          admin.email,
          {
            subject: 'MedAxis Admin Password Reset',
            locale: 'en',
            text: `A password reset was requested for your MedAxis admin account.\n\nOpen this link within 15 minutes to set a new password:\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
            html: `<p>A password reset was requested for your MedAxis admin account.</p><p><a href="${resetUrl}">Reset admin password</a> (valid for 15 minutes).</p><p>If you did not request this, you can ignore this email.</p>`,
          },
          `admin-password-reset:${tokenId}`,
          tokenId,
        );
      } catch {
        logger.error('admin password reset email delivery failed', { request_id: req.requestId, admin_id: admin._id });
      }
    } else if (!env.isProduction) {
      logger.info('admin password reset link (development only)', { email: admin.email, reset_url: resetUrl });
    } else {
      logger.warn('admin password reset email not sent: mail transport not configured', { request_id: req.requestId });
    }
    return { requested: true as const };
  }

  async function resetPassword(req: Request, token: string, newPassword: string) {
    await security.assertUnlocked(req);
    const now = new Date();
    const record = await AdminSessionModel.findOne({
      token_hash: hashToken(token),
      purpose: 'PASSWORD_RESET',
      revoked_at: null,
      expires_at: { $gt: now },
    }).lean();
    if (!record) return security.fail(req);
    const admin = await AdminModel.findOne({ _id: record.admin_id, is_active: true }).select('+password_hash').lean();
    if (!admin) return security.fail(req);
    if (await verifyPassword(admin.password_hash, newPassword)) {
      throw AppError.validation([{ field: 'new_password', issue: 'Choose a different password.' }]);
    }
    const passwordHash = await hashPassword(newPassword);
    await mongoose.connection.transaction(async (transaction) => {
      const consumed = await AdminSessionModel.findOneAndUpdate(
        { _id: record._id, purpose: 'PASSWORD_RESET', revoked_at: null, expires_at: { $gt: now } },
        { $set: { revoked_at: now } },
        { session: transaction, returnDocument: 'after' },
      );
      if (!consumed) throw AppError.unauthorized('Reset link is invalid or has expired.');
      const changed = await AdminModel.findOneAndUpdate(
        { _id: admin._id, is_active: true, session_generation: admin.session_generation },
        { $set: { password_hash: passwordHash }, $inc: { session_generation: 1 } },
        { session: transaction, returnDocument: 'after' },
      );
      if (!changed) throw AppError.conflict('Credentials changed. Request a new reset link.');
      await AdminSessionModel.updateMany(
        { admin_id: admin._id, revoked_at: null },
        { $set: { revoked_at: now } },
        { session: transaction },
      );
      await AuthAttemptModel.deleteOne({ scope_key: security.scopeKey(req) }).session(transaction);
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: admin._id,
          action: 'ADMIN_PASSWORD_RESET_COMPLETED',
          entity_type: 'admins',
          entity_id: admin._id,
          metadata: { severity: 'HIGH' },
        },
        transaction,
      );
    });
    return { reset: true as const };
  }

  return { login, loginDirect, completeMfa, enroll, sessions, revokeSessions, logout, profile, updateProfile, changePassword, requestPasswordReset, resetPassword };
}

export type AuthService = ReturnType<typeof createAuthService>;
