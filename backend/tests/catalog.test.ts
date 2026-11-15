import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { catalogQuery, productCreate, productPatch } from '../src/modules/catalog/catalog.validator.js';
import { publicProduct, type JoinedProduct } from '../src/modules/catalog/catalog.dto.js';
import { ProductModel } from '../src/modules/catalog/catalog.schema.js';
import { createPublicCatalogService } from '../src/modules/catalog/catalog.public.service.js';
import { bannerBody } from '../src/modules/cms/cms.service.js';
import { settingsPatch } from '../src/modules/settings/settings.service.js';
import { cleanHtml, escapeRegex, isSafeInternalPath } from '../src/shared/utils/content.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { createRevalidator } from '../src/shared/utils/revalidate.js';
import { validEnv, productionEnv } from './helpers/env.js';

const logger = createLogger({ silent: true });
afterEach(() => vi.restoreAllMocks());

describe('catalog input and safe DTOs', () => {
  it('bounds pagination and rejects operator/boolean ambiguity', () => {
    expect(catalogQuery.parse({ cold_chain: 'false' }).cold_chain).toBe(false);
    for (const query of [
      { limit: '101' },
      { page: '0' },
      { cold_chain: '0' },
      { q: { $ne: null } },
      { manufacturer: { $ne: null } },
    ])
      expect(catalogQuery.safeParse(query).success).toBe(false);
  });
  it('does not introduce defaults into a partial product patch or allow pricing fields', () => {
    expect(productPatch.parse({ translations: { en: { slug: 'changed' } } })).toEqual({
      translations: { en: { slug: 'changed' } },
    });
    expect(productPatch.safeParse({ price: '10' }).success).toBe(false);
    expect(productCreate.safeParse({ manufacturer_id: randomUUID(), price: 10 }).success).toBe(false);
  });
  it('allowlists nested translations and joined profiles even when records are poisoned', () => {
    const record = {
      _id: randomUUID(),
      sku: 'PUBLIC',
      translations: {
        en: {
          brand_name: 'Demo',
          slug: 'demo',
          price: 1,
          internal_note: 'private',
          description: '<p>safe</p><script>bad()</script>',
        },
        zhCN: { brand_name: '中文', slug: 'demo-zh', procurement_cost_bdt: 5 },
      },
      manufacturer_profile: {
        _id: randomUUID(),
        translations: { en: { name: 'Maker', slug: 'maker', price: 1 } },
        cost: 3,
      },
      generic_profile: { _id: randomUUID(), translations: { en: { name: 'Generic', slug: 'generic' } } },
      category_profiles: [],
      strength: '10 mg',
      dosage_form: 'Tablet',
      pack_size: '10',
      packaging_unit: 'BOX',
      cold_chain_required: false,
      price: 10,
      fx_rates: { USD: 120 },
      admin_notes: 'private',
      image_keys: ['products/a.png', 'prescriptions/private.enc'],
    } as unknown as JoinedProduct;
    const dto = publicProduct(record, 'zh-CN', 'https://cdn.example.test');
    expect(dto.brand_name).toBe('中文');
    expect(dto.alternate_slugs).toEqual({ en: 'demo', zhCN: 'demo-zh' });
    expect(dto.image_urls).toEqual(['https://cdn.example.test/products/a.png']);
    expect(JSON.stringify(dto)).not.toMatch(/price|cost|fx_rates|admin_note|internal_note|bad\(\)/);
  });
  it('escapes regex input, sanitizes HTML and rejects unsafe links', () => {
    expect(new RegExp(escapeRegex('a.*(b)')).test('aZZb')).toBe(false);
    expect(cleanHtml('<p onclick="x()">Hello<a href="javascript:bad()">link</a><script>bad()</script></p>')).toBe(
      '<p>Hello<a>link</a></p>',
    );
    for (const path of ['//evil.test', '/%2fexample', '/a/../b', '/a%5cb', '/a\nLocation:x'])
      expect(isSafeInternalPath(path)).toBe(false);
    expect(isSafeInternalPath('/en/products/demo')).toBe(true);
    expect(
      bannerBody.safeParse({ translations: { en: { title: 'T', body: 'B' } }, link_path: '//evil.test' }).success,
    ).toBe(false);
    expect(
      settingsPatch.safeParse({ wire_instructions: { configured: true, instructions: 'Wire here' } }).success,
    ).toBe(false);
    expect(settingsPatch.safeParse({ ADMIN_SESSION_SECRET: 'no' }).success).toBe(false);
  });
});

describe('search and webhook boundaries', () => {
  it('uses an explicit public projection after Atlas Search with no production regex fallback', async () => {
    const aggregate = vi.spyOn(ProductModel, 'aggregate').mockReturnValue({ option: async () => [] } as never);
    await createPublicCatalogService(loadEnv(productionEnv)).list(catalogQuery.parse({ q: 'medicine' }));
    const pipeline = aggregate.mock.calls[0]![0]!;
    expect(pipeline[0]).toHaveProperty('$search');
    expect(pipeline[1]).toEqual({ $match: { status: 'PUBLISHED' } });
    const projection = pipeline[2] as { $project: Record<string, number> };
    expect(projection.$project['translations.en.brand_name']).toBe(1);
    expect(projection.$project).not.toHaveProperty('translations');
    expect(JSON.stringify(pipeline)).not.toContain('$regex');
  });
  it('uses literal escaped regex only for local/development search', async () => {
    const aggregate = vi.spyOn(ProductModel, 'aggregate').mockReturnValue({ option: async () => [] } as never);
    await createPublicCatalogService(loadEnv(validEnv)).list(catalogQuery.parse({ q: 'a.*' }));
    expect(JSON.stringify(aggregate.mock.calls[0]![0])).toContain('a\\\\.\\\\*');
    expect(JSON.stringify(aggregate.mock.calls[0]![0])).not.toContain('$search');
  });
  it('revalidates after mutation without blocking and contains webhook errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const revalidate = createRevalidator(
      loadEnv({ ...validEnv, REVALIDATE_WEBHOOK_SECRET: 'test-webhook-key' }),
      logger,
      fetcher,
    );
    expect(revalidate('test-request')).toBeUndefined();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith(
      new URL('http://localhost:3000/api/revalidate'),
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: 'Bearer test-webhook-key' }),
      }),
    );
  });
  it.each(['/admin/catalog/products', '/admin/catalog/manufacturers', '/admin/cms/banners', '/admin/settings'])(
    'protects %s with ADMIN_AUTH',
    async (path) => {
      const app = createApp({ env: loadEnv(validEnv), logger });
      const res =
        path === '/admin/settings'
          ? await request(app).get(`/v1${path}`)
          : await request(app).post(`/v1${path}`).send({});
      expect(res.status).toBe(401);
    },
  );
});
