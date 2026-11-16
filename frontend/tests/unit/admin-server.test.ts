import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { meta } from '../fixtures';

const mocks = vi.hoisted(() => ({ headers: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }) }));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
import { guardedAdminRead, requireAdminSession } from '../../lib/admin-server';

const signed = 'medaxis_admin_session=s%3Aopaque%2Fsigned.VALUE';
const session = { id: '82f591d0-346b-4cc4-8d67-e25358fa0272', current: true, ip_address: '127.0.0.*', geo: {}, user_agent: null, last_active_at: meta.timestamp, expires_at: '2030-11-16T12:00:00.000Z', token_hash: 'NEVER_FORWARD' };
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test'); vi.stubEnv('API_INTERNAL_BASE_URL', ''); vi.stubEnv('ADMIN_FRONTEND_ORIGIN', 'https://medaxis.test'); mocks.headers.mockResolvedValue(new Headers({ cookie: `${signed}; pre_auth_session=ignored; unrelated=secret` })); });

describe('independent sensitive server guards', () => {
  it('validates each read with Express, preserves raw signed bytes, and never serializes the cookie', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => Response.json({ success: true, data: String(url).includes('auth/sessions') ? [session] : { value: 'authorized', internal: 'stripped' }, meta })); vi.stubGlobal('fetch', fetcher);
    const schema = z.object({ value: z.string() });
    const result = await guardedAdminRead('/v1/admin/fx-rates', schema); await guardedAdminRead('/v1/admin/rfqs', schema);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('auth/sessions'))).toHaveLength(2);
    for (const [, options] of fetcher.mock.calls) { expect(new Headers(options?.headers).get('cookie')).toBe(signed); expect(options?.cache).toBe('no-store'); }
    expect(JSON.stringify(result)).not.toMatch(/opaque|signed|internal|token_hash/);
  });
  it('pre-auth alone never calls a private endpoint', async () => {
    mocks.headers.mockResolvedValue(new Headers({ cookie: 'pre_auth_session=password-only' })); const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher);
    await expect(requireAdminSession()).rejects.toThrow('REDIRECT:/admin/login'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('backend rejection redirects instead of rendering private data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('unauthorized', { status: 401 })); vi.stubGlobal('fetch', fetcher);
    await expect(guardedAdminRead('/v1/admin/rfqs', z.unknown())).rejects.toThrow('REDIRECT:/admin/login'); expect(fetcher).toHaveBeenCalledOnce();
  });
});
