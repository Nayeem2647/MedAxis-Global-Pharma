import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { ADMIN_LOCKOUT_MINUTES, ADMIN_MAX_FAILED_ATTEMPTS } from '../../config/constants.js';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { hashToken } from '../../shared/utils/crypto.js';
import { normalizeIp } from '../../shared/utils/geoip.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { AuthAttemptModel } from './auth.schema.js';

export const PRE_AUTH_COOKIE = 'pre_auth_session';
export const PRE_AUTH_MS = 5 * 60_000;
export const LOCKOUT_MS = ADMIN_LOCKOUT_MINUTES * 60_000;
export const MAX_FAILURES = ADMIN_MAX_FAILED_ATTEMPTS;

export interface SecurityEvent {
  event: 'ADMIN_LOGIN' | 'ADMIN_BACKUP_LOGIN' | 'ADMIN_LOCKOUT' | 'ADMIN_2FA_ENROLLED';
  severity: 'INFO' | 'HIGH';
  admin_id?: string;
  session_id?: string;
  ip_address: string;
  user_agent: string;
  country: string | null;
  city: string | null;
  new_ip?: boolean;
  foreign_ip?: boolean;
  occurred_at: string;
  local_time: string;
  request_id: string;
}

/** Delivery is injected by the notification service; the default is a structured alert hook. */
export interface AuthHooks {
  onSecurityEvent?: (event: SecurityEvent) => void | Promise<void>;
}

export function securityContext(req: Request) {
  return {
    ip: normalizeIp(req.clientIp || req.ip || 'unknown'),
    userAgent: (req.get('user-agent') || 'unknown').slice(0, 2000),
  };
}

export function createAuthSecurity(env: AppEnv, logger: AppLogger, hooks: AuthHooks = {}) {
  function notify(event: SecurityEvent): void {
    const log = event.severity === 'HIGH' ? logger.warn.bind(logger) : logger.info.bind(logger);
    log('admin security event', { ...event });
    if (hooks.onSecurityEvent) {
      void Promise.resolve()
        .then(() => hooks.onSecurityEvent!(event))
        .catch(() => {
          logger.error('admin security notification hook failed', { request_id: event.request_id, event: event.event });
        });
    }
  }

  function eventTimes(now: Date) {
    return { occurred_at: now.toISOString(), local_time: now.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) };
  }

  // One scope across password, TOTP and recovery prevents resetting MFA failures by redoing Step 1.
  const scopeKey = (req: Request) => `admin-auth:ip:${hashToken(securityContext(req).ip)}`;

  async function assertUnlocked(req: Request): Promise<void> {
    const record = await AuthAttemptModel.findOne({
      scope_key: scopeKey(req),
      locked_until: { $gt: new Date() },
    }).lean();
    if (record) throw locked(record.locked_until!);
  }

  function locked(until: Date): AppError {
    return new AppError({
      status: 403,
      code: 'ACCESS_DENIED',
      message: 'Too many failed authentication attempts. Try again later.',
      retryAfter: Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)),
    });
  }

  async function fail(req: Request): Promise<never> {
    const now = new Date();
    const until = new Date(now.getTime() + LOCKOUT_MS);
    const active = { $gt: [{ $ifNull: ['$locked_until', new Date(0)] }, now] };
    const expired = { $lte: [{ $ifNull: ['$expires_at', new Date(0)] }, now] };
    // Native aggregation expressions are evaluated under MongoDB's single-document write lock.
    const pipeline = [
      {
        $set: {
          _id: { $ifNull: ['$_id', { $literal: randomUUID() }] },
          scope_key: { $literal: scopeKey(req) },
          failed_count: {
            $cond: [
              active,
              '$failed_count',
              { $cond: [expired, 1, { $min: [MAX_FAILURES, { $add: [{ $ifNull: ['$failed_count', 0] }, 1] }] }] },
            ],
          },
          window_started_at: { $cond: [expired, now, { $ifNull: ['$window_started_at', now] }] },
          created_at: { $ifNull: ['$created_at', now] },
          updated_at: now,
        },
      },
      {
        $set: {
          locked_until: {
            $cond: [active, '$locked_until', { $cond: [{ $gte: ['$failed_count', MAX_FAILURES] }, until, '$$REMOVE'] }],
          },
          expires_at: { $cond: [active, '$expires_at', until] },
        },
      },
    ];
    const update = (upsert: boolean) =>
      AuthAttemptModel.findOneAndUpdate({ scope_key: scopeKey(req) }, pipeline, {
        upsert,
        returnDocument: 'before',
        updatePipeline: true,
        timestamps: false,
        setDefaultsOnInsert: false,
      }).lean();
    let previous;
    try {
      previous = await update(true);
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      previous = await update(false);
    }
    const count = previous && previous.expires_at > now ? previous.failed_count + 1 : 1;
    if (previous?.locked_until && previous.locked_until > now) throw locked(previous.locked_until);
    if (count >= MAX_FAILURES) {
      const { ip, userAgent } = securityContext(req);
      notify({
        event: 'ADMIN_LOCKOUT',
        severity: 'HIGH',
        ip_address: ip,
        user_agent: userAgent,
        country: null,
        city: null,
        ...eventTimes(now),
        request_id: req.requestId,
      });
      throw locked(until);
    }
    throw AppError.unauthorized('Authentication failed.');
  }

  return { notify, eventTimes, assertUnlocked, fail, scopeKey, homeCountry: env.ADMIN_HOME_COUNTRY };
}

export type AuthSecurity = ReturnType<typeof createAuthSecurity>;
