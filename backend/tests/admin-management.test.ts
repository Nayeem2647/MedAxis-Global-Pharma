import { readFileSync } from 'node:fs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';
import { adminCatalogQuery, productAdminProjection } from '../src/modules/catalog/catalog.admin.reads.js';
import { quotationListQuery, quotationSummaryQuery } from '../src/modules/quotation/quotation.admin.reads.js';
import { bannerBody, bannerQuery } from '../src/modules/cms/cms.service.js';
import { productPatch, reviewMetadata } from '../src/modules/catalog/catalog.validator.js';
import { csvRow } from '../src/modules/catalog/catalog.csv.service.js';
describe('registered Step 8 boundaries', () => {
  it.each([
    '/v1/admin/catalog/products',
    '/v1/admin/catalog/manufacturers',
    '/v1/admin/catalog/generics',
    '/v1/admin/catalog/categories',
    '/v1/admin/cms/banners',
    '/v1/admin/quotations',
    '/v1/admin/quotations/summary',
  ])('requires full Express auth for %s', async (path) => {
    const response = await request(createApp({ env: loadEnv(validEnv), logger: createLogger({ silent: true }) })).get(
      path,
    );
    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('bounds collections, rejects invented query keys and includes unpublished/inactive states deliberately', () => {
    expect(adminCatalogQuery.parse({ status: 'ARCHIVED', is_active: 'false' }).status).toBe('ARCHIVED');
    expect(adminCatalogQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(adminCatalogQuery.safeParse({ price: '10' }).success).toBe(false);
    expect(quotationListQuery.safeParse({ sort: 'price' }).success).toBe(false);
    expect(quotationSummaryQuery.safeParse({ window_hours: 169 }).success).toBe(false);
    expect(bannerQuery.safeParse({ featured: true }).success).toBe(false);
    expect(Object.keys(productAdminProjection).join(' ')).not.toMatch(/price|procurement|margin|token/);
  });
  it('registers real review metadata, explicit clearing, and prevents future/inferred reviews', () => {
    expect(
      reviewMetadata.safeParse({
        kind: 'TECHNICAL',
        reviewed_at: '2026-11-15T00:00:00Z',
        reviewer_name: 'Actual reviewer',
      }).success,
    ).toBe(true);
    expect(productPatch.parse({ review_metadata: null }).review_metadata).toBeNull();
    expect(
      reviewMetadata.safeParse({ kind: 'MEDICAL', reviewed_at: '2099-01-01T00:00:00Z', reviewer_name: 'Person' })
        .success,
    ).toBe(false);
    expect(productPatch.safeParse({ prescription_required: true }).success).toBe(false);
  });
  it('keeps the downloadable CSV template aligned with the actual strict csvRow schema', () => {
    const source = readFileSync(new URL('../../frontend/lib/admin-management.ts', import.meta.url), 'utf8');
    const columns = /export const csvColumns\s*=\s*\[([^\]]+)\]/
      .exec(source)?.[1]
      ?.match(/["']([^"']+)["']/g)
      ?.map((value) => value.slice(1, -1));
    expect(columns).toEqual(Object.keys(csvRow.shape));
  });
  it.each(['USD 50', '25% off', '¥100'])('rejects price/discount banner copy %s', (body) => {
    expect(
      bannerBody.safeParse({ translations: { en: { title: 'Sourcing', body } }, is_active: true, sort_order: 0 })
        .success,
    ).toBe(false);
  });
});
