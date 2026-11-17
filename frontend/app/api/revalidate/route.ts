import { timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { parseCatalogPath } from '../../../lib/catalog-path';
import { sitemapPaths } from '../../../lib/sitemap';

export const runtime = 'nodejs';
const payloadSchema = z.object({
  tags: z.array(z.enum(['catalog', 'cms', 'settings'])).max(3).default([]),
  paths: z.array(z.string().max(1024).refine((path) => /^\/(en|zh-CN)(?:\/(products|services))?$/.test(path) || parseCatalogPath(path) !== null || sitemapPaths.includes(path))).max(100).default([]),
  request_id: z.uuid().optional(),
}).strict().refine((body) => body.tags.length > 0 || body.paths.length > 0);

function json(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_WEBHOOK_SECRET;
  if (!secret) return json({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Revalidation is not configured.' } }, 503);
  const provided = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const suppliedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return json({ success: false, error: { code: 'AUTHENTICATION_REQUIRED', message: 'Unauthorized.' } }, 401);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Expected JSON.' } }, 400);
  }
  let input: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 16_384) return json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Payload too large.' } }, 413);
    input = JSON.parse(body);
  } catch { return json({ success: false, error: { code: 'INVALID_REQUEST', message: 'Invalid JSON.' } }, 400); }
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return json({ success: false, error: { code: 'VALIDATION_FAILED', message: 'Invalid revalidation targets.' } }, 422);
  try {
    for (const tag of new Set(parsed.data.tags)) revalidateTag(tag);
    for (const path of new Set(parsed.data.paths)) revalidatePath(path);
    if (parsed.data.tags.includes('catalog')) for(const path of sitemapPaths) revalidatePath(path);
    return json({ success: true, data: { revalidated: true, tags: parsed.data.tags, paths: parsed.data.paths } });
  } catch { return json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Revalidation failed.' } }, 500); }
}
