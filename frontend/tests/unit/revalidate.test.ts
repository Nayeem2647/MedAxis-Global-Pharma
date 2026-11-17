import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revalidatePath, revalidateTag } from 'next/cache';
import { POST } from '../../app/api/revalidate/route';
import { requestId } from '../fixtures';
import { sitemapPaths } from '../../lib/sitemap';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

function request(body: unknown, token = 'test-secret'): Request {
  return new Request('https://medaxis.test/api/revalidate', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => vi.stubEnv('REVALIDATE_WEBHOOK_SECRET', 'test-secret'));

describe('authenticated revalidation webhook', () => {
  it('accepts the exact Express catalog-save payload and invalidates sitemap output', async () => {
    const response = await POST(request({ tags: ['catalog', 'cms', 'settings'], request_id: requestId }));
    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith('/sitemap.xml');
    for(const path of sitemapPaths)expect(revalidatePath).toHaveBeenCalledWith(path);
  });

  it('supports explicit public paths and deduplicates targets', async () => {
    const response = await POST(request({ paths: ['/en/products/osimert', '/zh-CN', '/en/products/osimert'] }));
    expect(response.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it.each(['wrong-secret', ''])('rejects token %s before invalidating anything', async (token) => {
    expect((await POST(request({ tags: ['catalog'] }, token))).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('fails closed if the server secret is missing', async () => {
    vi.stubEnv('REVALIDATE_WEBHOOK_SECRET', '');
    expect((await POST(request({ tags: ['catalog'] }))).status).toBe(503);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it.each([
    {}, { tags: ['unknown'] }, { paths: ['/admin/login'] }, { paths: ['/q/secret'] },
    { paths: ['https://evil.test/en'] }, { paths: ['/en/products/../admin'] },
    { tags: ['catalog'], surprise: true }, { tags: ['catalog'], request_id: 123 },
  ])('rejects invalid targets: %j', async (body) => {
    expect((await POST(request(body))).status).toBe(422);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON without throwing', async () => {
    const req = new Request('https://medaxis.test/api/revalidate', { method: 'POST', headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' }, body: '{broken' });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns a sanitized error when Next cache invalidation fails', async () => {
    vi.mocked(revalidateTag).mockImplementationOnce(() => { throw new Error('private internals'); });
    const response = await POST(request({ tags: ['catalog'] }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private internals');
  });
});
