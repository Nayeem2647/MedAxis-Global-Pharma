import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { catalogQuery, productCreate, productPatch } from '../src/modules/catalog/catalog.validator.js';
import { publicProduct, type JoinedProduct } from '../src/modules/catalog/catalog.dto.js';
import { ProductModel, ManufacturerModel } from '../src/modules/catalog/catalog.schema.js';
import { UrlRedirectModel } from '../src/modules/cms/cms.schema.js';
import { createPublicCatalogService } from '../src/modules/catalog/catalog.public.service.js';
import { createAdminCatalogService, validateMasterSlugs } from '../src/modules/catalog/catalog.admin.service.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { bannerBody } from '../src/modules/cms/cms.service.js';
import { settingsPatch } from '../src/modules/settings/settings.service.js';
import { cleanHtml, escapeRegex, isSafeInternalPath } from '../src/shared/utils/content.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { createRevalidator } from '../src/shared/utils/revalidate.js';
import { validEnv, productionEnv } from './helpers/env.js';
import { png } from './fixtures/prescriptions.js';

const logger = createLogger({ silent: true });
afterEach(() => vi.restoreAllMocks());

describe('catalog input and safe DTOs', () => {
  it('reports both duplicate manufacturer slugs as editable field errors', async () => {
    vi.spyOn(UrlRedirectModel, 'exists').mockReturnValue({ session: async () => null } as never);
    const exists = vi.spyOn(ManufacturerModel, 'exists').mockReturnValue({ session: async () => ({ _id: randomUUID() }) } as never);
    await expect(validateMasterSlugs('manufacturers', {
      translations: { en: { slug: 'existing-maker' }, zhCN: { slug: 'existing-maker-zh' } },
    })).rejects.toMatchObject({ status: 422, code: 'CATALOG_SLUG_CONFLICT', details: [
      { field: 'translations.en.slug' }, { field: 'translations.zhCN.slug' },
    ] });
    expect(exists).toHaveBeenCalledWith({ 'translations.en.slug': 'existing-maker' });
    expect(exists).toHaveBeenCalledWith({ 'translations.zhCN.slug': 'existing-maker-zh' });
  });

  it('excludes the current manufacturer when validating an edit with unchanged slugs', async () => {
    vi.spyOn(UrlRedirectModel, 'exists').mockReturnValue({ session: async () => null } as never);
    const exists = vi.spyOn(ManufacturerModel, 'exists').mockReturnValue({ session: async () => null } as never);
    const id = randomUUID();
    await expect(validateMasterSlugs('manufacturers', { translations: { en: { slug: 'same-maker' } } }, id)).resolves.toBeUndefined();
    expect(exists).toHaveBeenCalledExactlyOnceWith({ 'translations.en.slug': 'same-maker', _id: { $ne: id } });
  });

  it('maps a concurrent duplicate-slug rejection to field errors and removes the staged logo', async () => {
    const env = loadEnv(validEnv);
    vi.spyOn(mongoose.connection, 'transaction').mockRejectedValue(Object.assign(new Error('Private duplicate diagnostics'), {
      code: 11000, keyPattern: { 'translations.en.slug': 1 }, keyValue: { 'translations.en.slug': 'private-value' },
    }));
    const storage = createStorageService(env);
    const key = 'products/local/manufacturers/staged.png';
    vi.spyOn(storage, 'uploadPublicImage').mockResolvedValue({ object_key: key, url: `${env.API_ORIGIN}/v1/public/media/${key}`, mime_type: 'image/png', file_size_bytes: png.length });
    const remove = vi.spyOn(storage, 'remove').mockResolvedValue(undefined);
    const catalog = createAdminCatalogService(env, vi.fn(), storage);
    await expect(catalog.saveMaster({} as Request, 'manufacturers', {
      translations: { en: { name: 'Maker', slug: 'maker' } }, logo_data_url: 'data:image/png;base64,' + png.toString('base64'),
    })).rejects.toMatchObject({ status: 422, code: 'CATALOG_SLUG_CONFLICT', details: [{ field: 'translations.en.slug' }] });
    expect(remove).toHaveBeenCalledExactlyOnceWith('products', key);
  });

  it.each([
    ['manufacturers', 'MANUFACTURER_LOGO_UPLOAD_FAILED'],
    ['generics', 'GENERIC_IMAGE_UPLOAD_FAILED'],
    ['categories', 'CATEGORY_IMAGE_UPLOAD_FAILED'],
  ] as const)('reports an image failure before opening a %s database transaction', async (kind, code) => {
    const env = loadEnv(validEnv);
    const transaction = vi.spyOn(mongoose.connection, 'transaction').mockRejectedValue(new Error('Unexpected write'));
    const storage = createStorageService(env);
    vi.spyOn(storage, 'uploadPublicImage').mockRejectedValue(AppError.unavailable('Storage upload failed.'));
    const catalog = createAdminCatalogService(env, vi.fn(), storage);

    await expect(catalog.saveMaster({} as Request, kind, {
      translations: { en: { name: 'Maker', slug: 'maker' } },
      logo_data_url: 'data:image/png;base64,' + png.toString('base64'),
    })).rejects.toMatchObject({ status: 503, code });
    expect(transaction).not.toHaveBeenCalled();
  });

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
    expect(pipeline[1]).toEqual({ $match: { status: 'PUBLISHED', deleted_at: { $exists: false } } });
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
