import type { Request, RequestHandler } from 'express';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';

export type TurnstileFetch = typeof fetch;
export function turnstileToken(req: Request): string {
  const body = req.body as { turnstile_token?: unknown } | undefined;
  const header = req.get('cf-turnstile-response');
  const token = body?.turnstile_token ?? header;
  if (
    typeof token !== 'string' ||
    !token.trim() ||
    token.length > 2048 ||
    (header && body?.turnstile_token && header !== body.turnstile_token)
  )
    throw AppError.forbidden('Bot verification failed.', 'TURNSTILE_VERIFICATION_FAILED');
  return token;
}
export function turnstile(env: AppEnv, fetcher: TurnstileFetch = fetch): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = turnstileToken(req);
      if (!env.CLOUDFLARE_TURNSTILE_SECRET) throw new Error();
      const form = new URLSearchParams({ secret: env.CLOUDFLARE_TURNSTILE_SECRET, response: token });
      if (req.clientIp && isIP(req.clientIp)) form.set('remoteip', req.clientIp);
      const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
        redirect: 'error',
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error();
      const result = z.object({ success: z.boolean(), hostname: z.string().optional() }).parse(await response.json());
      const hosts = env.PUBLIC_ORIGIN.map((origin) => new URL(origin).hostname);
      if (!result.success || (env.isProduction && (!result.hostname || !hosts.includes(result.hostname))))
        throw new Error();
      next();
    } catch {
      next(AppError.forbidden('Bot verification failed.', 'TURNSTILE_VERIFICATION_FAILED'));
    }
  };
}
