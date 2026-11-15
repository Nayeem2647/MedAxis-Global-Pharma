import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { AdminSessionModel } from '../src/modules/auth/auth.schema.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';

const env = loadEnv(validEnv);
const spec = readFileSync(new URL('../../Docs/API-Spec.md', import.meta.url), 'utf8');
const protectedEndpoints = [
  ...spec.matchAll(/\|\s*\*\*(\d{2})\*\*\s*\|\s*(GET|POST|PATCH)\s*\|\s*(\/v1\/[^\s|]+)\s*\|/g),
]
  .filter((match) => Number(match[1]) >= 21)
  .map((match) => ({
    id: Number(match[1]),
    method: match[2]!.toLowerCase() as 'get' | 'post' | 'patch',
    path: match[3]!,
  }));
const token = 'a'.repeat(64);
const signature = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(token).digest('base64').replace(/=+$/, '');
const challengeCookie = `pre_auth_session=${encodeURIComponent(`s:${token}.${signature}`)}`;

afterEach(() => vi.restoreAllMocks());

describe.each(['anonymous', 'pre-authentication only'] as const)('all ADMIN_AUTH routes: %s', (identity) => {
  it.each(protectedEndpoints)(
    '#$id $method $path requires a completed 2FA session before validation',
    async ({ id, method, path }) => {
      const lookup = vi.spyOn(AdminSessionModel, 'findOne');
      const app = createApp({ env, logger: createLogger({ silent: true }) });
      const url = path.replace(/:(?:itemId|id)/g, 'invalid-id');
      const call = request(app)[method](url);
      if (identity === 'pre-authentication only') call.set('Cookie', challengeCookie);
      if (id === 41) call.field('dry_run', 'true');
      else if (method !== 'get') call.send({ unexpected: true });
      const result = await call;
      expect(result.status).toBe(401);
      expect(result.body.success).toBe(false);
      expect(result.body.error).toMatchObject({ status: 401, code: 'AUTHENTICATION_REQUIRED' });
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.meta.request_id).toBe(result.headers['x-request-id']);
      expect(lookup).not.toHaveBeenCalled();
    },
  );
});
