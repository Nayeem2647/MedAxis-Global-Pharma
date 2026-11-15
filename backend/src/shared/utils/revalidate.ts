import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from './logger.js';

export function createRevalidator(env: AppEnv, logger: AppLogger, fetcher: typeof fetch = fetch) {
  return (requestId: string): void => {
    if (!env.REVALIDATE_WEBHOOK_SECRET) {
      logger.warn('catalog revalidation is not configured', { request_id: requestId });
      return;
    }
    for (const origin of env.PUBLIC_ORIGIN) {
      void Promise.resolve()
        .then(async () => {
          const response = await fetcher(new URL('/api/revalidate', origin), {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(5_000),
            headers: { Authorization: `Bearer ${env.REVALIDATE_WEBHOOK_SECRET}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['catalog', 'cms', 'settings'], request_id: requestId }),
          });
          await response.body?.cancel();
          if (!response.ok) throw new Error();
        })
        .catch(() => logger.warn('catalog revalidation failed', { request_id: requestId }));
    }
  };
}

export type Revalidate = ReturnType<typeof createRevalidator>;
