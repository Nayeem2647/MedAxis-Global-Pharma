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
import { MAX_ADMIN_AVATAR_LENGTH } from './auth.schema.js';
import type { StorageService } from '../storage/storage.service.js';

const loginBody = z
  .object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(1024) })
  .strict();
const totpBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
const backupBody = z.object({ backup_code: z.string().min(1).max(72) }).strict();
const emptyBody = z.object({}).strict();
const profileBody = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(200),
  display_name: z.string().trim().min(1).max(120),
  phone_number: z.string().trim().regex(/^(?:\+?[0-9][0-9\s()-]{5,23})?$/),
  avatar_url: z.string().min(1).max(MAX_ADMIN_AVATAR_LENGTH).nullable().optional(),
  current_password: z.string().min(1).max(1024).optional(),
});
const passwordBody = z.object({ current_password: z.string().min(1).max(1024), new_password: z.string().min(12).max(1024), confirm_password: z.string() }).strict().refine((value) => value.new_password === value.confirm_password, { path: ['confirm_password'], message: 'Passwords do not match.' });
const forgotPasswordBody = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict();
const resetPasswordBody = z.object({ token: z.string().trim().min(16).max(256), new_password: z.string().min(12).max(1024), confirm_password: z.string() }).strict().refine((value) => value.new_password === value.confirm_password, { path: ['confirm_password'], message: 'Passwords do not match.' });

export function createAuthRouter({
  env,
  logger,
  hooks,
  storage,
  service = createAuthService(env, logger, hooks, storage),
}: {
  env: AppEnv;
  logger: AppLogger;
  hooks?: AuthHooks;
  storage?: StorageService;
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

  router.post('/forgot-password', async (req, res) => {
    const body = forgotPasswordBody.parse(req.body);
    sendSuccess(res, await service.requestPasswordReset(req, body.email));
  });

  router.post('/reset-password', async (req, res) => {
    const body = resetPasswordBody.parse(req.body);
    sendSuccess(res, await service.resetPassword(req, body.token, body.new_password));
  });

  const requireAdmin = adminAuth(env);
  router.get('/profile', requireAdmin, async (req, res) => { sendSuccess(res, await service.profile(req)); });
  router.patch('/profile', requireAdmin, async (req, res) => { sendSuccess(res, await service.updateProfile(req, profileBody.parse(req.body))); });
  router.post('/change-password', requireAdmin, async (req, res) => {
    const body = passwordBody.parse(req.body);
    sendSuccess(res, await service.changePassword(req, body.current_password, body.new_password));
  });
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
