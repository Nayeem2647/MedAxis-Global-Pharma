import { Router, type CookieOptions } from 'express';
import { z } from 'zod';
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_IDLE_MS } from '../../config/constants.js';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { adminAuth, sessionCookieOptions } from '../../shared/middleware/adminAuth.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { sendSuccess } from '../../shared/utils/response.js';
import { PRE_AUTH_COOKIE, PRE_AUTH_MS, type AuthHooks } from './auth.security.js';
import { createAuthService, type AuthService } from './auth.service.js';

const loginBody = z
  .object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(1024) })
  .strict();
const totpBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const backupBody = z.object({ backup_code: z.string().min(1).max(72) }).strict();
const emptyBody = z.object({}).strict();

export function createAuthRouter({
  env,
  logger,
  hooks,
  service = createAuthService(env, logger, hooks),
}: {
  env: AppEnv;
  logger: AppLogger;
  hooks?: AuthHooks;
  service?: AuthService;
}) {
  const router = Router();
  const preAuthOptions: CookieOptions = {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'strict',
    signed: true,
    path: '/v1/admin/auth',
  };
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use((req, _res, next) => {
    // JSON-only mutations plus SameSite cookies; reject explicit cross-origin credential use too.
    const origin = req.get('origin');
    if (req.method !== 'GET' && origin && !env.PUBLIC_ORIGIN.includes(origin)) return next(AppError.forbidden());
    next();
  });

  router.post('/login', async (req, res) => {
    const body = loginBody.parse(req.body);
    if (!env.ADMIN_REQUIRE_2FA) {
      const result = await service.loginDirect(req, body.email, body.password);
      res.clearCookie(PRE_AUTH_COOKIE, { ...preAuthOptions, signed: false });
      res.cookie(ADMIN_SESSION_COOKIE, result.token, { ...sessionCookieOptions(env), maxAge: ADMIN_SESSION_IDLE_MS });
      sendSuccess(res, {
        requires_2fa: false,
        admin: result.admin,
        session_id: result.session_id,
        expires_at: result.expires_at,
      });
      return;
    }
    const result = await service.login(req, body.email, body.password);
    res.cookie(PRE_AUTH_COOKIE, result.token, { ...preAuthOptions, maxAge: PRE_AUTH_MS });
    sendSuccess(res, { requires_2fa: true, expires_at: result.expires_at });
  });

  for (const method of ['TOTP', 'BACKUP'] as const) {
    router.post(method === 'TOTP' ? '/verify-totp' : '/verify-backup-code', async (req, res) => {
      const code = method === 'TOTP' ? totpBody.parse(req.body).code : backupBody.parse(req.body).backup_code;
      const result = await service.completeMfa(req, req.signedCookies?.[PRE_AUTH_COOKIE], code, method);
      res.clearCookie(PRE_AUTH_COOKIE, { ...preAuthOptions, signed: false });
      res.cookie(ADMIN_SESSION_COOKIE, result.token, { ...sessionCookieOptions(env), maxAge: ADMIN_SESSION_IDLE_MS });
      sendSuccess(res, { admin: result.admin, session_id: result.session_id, expires_at: result.expires_at });
    });
  }

  const requireAdmin = adminAuth(env);
  router.post('/2fa/enroll', requireAdmin, async (req, res) => {
    emptyBody.parse(req.body ?? {});
    sendSuccess(res, await service.enroll(req));
  });
  router.get('/sessions', requireAdmin, async (req, res) => {
    sendSuccess(res, await service.sessions(req));
  });
  router.post('/revoke-sessions', requireAdmin, async (req, res) => {
    emptyBody.parse(req.body ?? {});
    sendSuccess(res, await service.revokeSessions(req));
  });
  router.post('/logout', requireAdmin, async (req, res) => {
    emptyBody.parse(req.body ?? {});
    const result = await service.logout(req);
    res.clearCookie(ADMIN_SESSION_COOKIE, { ...sessionCookieOptions(env), signed: false });
    res.clearCookie(PRE_AUTH_COOKIE, { ...preAuthOptions, signed: false });
    sendSuccess(res, result);
  });
  return router;
}
