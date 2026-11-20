'use client';

import { z } from 'zod';
import { parseApiResponse } from './api-client';
import { customerProxyRule } from './customer-contract';

export async function customerRequest<T>(path: string, schema: z.ZodType<T>, options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}) {
  const method = options.method ?? 'GET';
  if (!customerProxyRule(path.split('?')[0]!, method)) throw new Error('Unknown customer endpoint.');
  const response = await fetch(`/api/customer/${path}`, { method, headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: options.signal ?? AbortSignal.timeout(30000) });
  return parseApiResponse(response, schema);
}
