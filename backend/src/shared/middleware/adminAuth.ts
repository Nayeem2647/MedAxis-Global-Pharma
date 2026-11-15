import type { CookieOptions, RequestHandler } from 'express';
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_IDLE_MS } from '../../config/constants.js';
import type { AppEnv } from '../../config/env.js';
import { AdminModel, AdminSessionModel } from '../../modules/auth/auth.schema.js';
import { AppError } from '../errors/AppError.js';
import { hashToken } from '../utils/crypto.js';

export const sessionCookieOptions = (env: Pick<AppEnv, 'isProduction'>): CookieOptions => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  signed: true,
  path: '/v1/admin',
});

export function adminAuth(env: Pick<AppEnv, 'isProduction'>): RequestHandler {
  return async (req, res, next) => {
    try {
      const token: unknown = req.signedCookies?.[ADMIN_SESSION_COOKIE];
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw AppError.unauthorized();
      const now = new Date();
      const filter = {
        token_hash: hashToken(token),
        purpose: 'ADMIN' as const,
        revoked_at: null,
        expires_at: { $gt: now },
      };
      const candidate = await AdminSessionModel.findOne(filter).lean();
      if (!candidate) throw AppError.unauthorized();
      const admin = await AdminModel.exists({
        _id: candidate.admin_id,
        is_active: true,
        session_generation: candidate.session_generation,
      });
      if (!admin) throw AppError.unauthorized();
      // Expiry/revocation are checked again in the write, so a concurrent revoke cannot be undone by sliding renewal.
      const session = await AdminSessionModel.findOneAndUpdate(
        { ...filter, _id: candidate._id, session_generation: candidate.session_generation },
        { $max: { last_seen_at: now, expires_at: new Date(now.getTime() + ADMIN_SESSION_IDLE_MS) } },
        { returnDocument: 'after' },
      ).lean();
      if (!session) throw AppError.unauthorized();
      req.admin = { id: session.admin_id, sessionId: session._id };
      res.cookie(ADMIN_SESSION_COOKIE, token, { ...sessionCookieOptions(env), maxAge: ADMIN_SESSION_IDLE_MS });
      next();
    } catch (error) {
      next(error);
    }
  };
}
