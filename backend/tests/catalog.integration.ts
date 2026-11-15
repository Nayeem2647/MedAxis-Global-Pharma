import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { AdminModel, AdminSessionModel } from '../src/modules/auth/auth.schema.js';
import { AuditLogModel } from '../src/modules/audit/audit.schema.js';
import { ProductModel, ManufacturerModel, GenericModel, CategoryModel } from '../src/modules/catalog/catalog.schema.js';
import { CmsBannerModel, UrlRedirectModel } from '../src/modules/cms/cms.schema.js';
import { migrate } from '../src/scripts/migrate.js';
import { generateToken, hashPassword, hashToken } from '../src/shared/utils/crypto.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { validEnv } from './helpers/env.js';

const databaseName = `catalog_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const env = loadEnv({
  ...validEnv,
  R2_PUBLIC_BASE_URL: 'https://cdn.example.test',
  REVALIDATE_WEBHOOK_SECRET: 'test-revalidation-key',
});
const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 200 }));
let app: Express;
let adminCookie: string;
let passwordHash: string;
let manufacturerId: string;
let genericId: string;
let categoryId: string;

const productBody = (sku = 'DEMO-001', enSlug = 'demo-medicine') => ({
  sku,
  manufacturer_id: manufacturerId,
  generic_id: genericId,
  category_ids: [categoryId],
  translations: {
    en: { brand_name: 'Demo Medicine', slug: enSlug, description: '<p>Public description</p>' },
    zhCN: { brand_name: '示例药品', slug: `${enSlug}-zh`, description: '<p>中文说明</p>' },
  },
  strength: '10 mg',
  dosage_form: 'Tablet',
  pack_size: '10 tablets',
  packaging_unit: 'BOX',
  cold_chain_required: false,
  storage_condition: 'Below 25C',
  image_keys: ['products/demo.png'],
  status: 'PUBLISHED' as const,
});
async function createProduct(sku?: string, slug?: string) {
  const response = await request(app)
    .post('/v1/admin/catalog/products')
    .set('Cookie', adminCookie)
    .send(productBody(sku, slug));
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data as { _id: string; translations: { en: { slug: string } } };
}
const csvHeaders =
  'sku,manufacturer_slug,generic_slug,category_slugs,brand_name_en,slug_en,strength,dosage_form,pack_size,packaging_unit,cold_chain_required,status';
const csvLine = (sku: string, slug: string, manufacturer = 'maker') =>
  `${sku},${manufacturer},ingredient,oncology,CSV Medicine,${slug},10 mg,Tablet,10 tablets,BOX,false,PUBLISHED`;
const csv = (...lines: string[]) => Buffer.from([csvHeaders, ...lines].join('\n'));

function noCommercialKeys(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(noCommercialKeys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toMatch(/price|cost|markup|margin|fx_|admin_note|internal_note|token|password/i);
    noCommercialKeys(child);
  }
}

beforeAll(async () => {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Set MONGODB_TEST_URI or MONGODB_URI for catalog integration tests');
  await mongoose.connect(uri, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10_000,
  });
  await migrate();
  passwordHash = await hashPassword('test-only admin password');
  app = createApp({ env, logger: createLogger({ silent: true }), revalidateFetch: fetcher });
});
beforeEach(async () => {
  if (mongoose.connection.name !== databaseName) throw new Error('Refusing to alter a non-test database');
  for (const name of [
    'products',
    'manufacturers',
    'generics',
    'categories',
    'admins',
    'admin_sessions',
    'audit_logs',
    'cms_banners',
    'url_redirects',
    'platform_settings',
  ])
    await mongoose.connection.db!.collection(name).deleteMany({});
  const [admin, maker, generic, category] = await Promise.all([
    AdminModel.create({
      email: 'catalog-admin@example.test',
      password_hash: passwordHash,
      totp_secret_encrypted: 'unused-fixture-envelope',
      backup_code_hashes: [],
    }),
    ManufacturerModel.create({
      translations: { en: { name: 'Demo Maker', slug: 'maker' }, zhCN: { name: '制造商', slug: 'maker-zh' } },
      country: 'BD',
      certifications: ['GMP'],
    }),
    GenericModel.create({
      translations: {
        en: { name: 'Demo Ingredient', slug: 'ingredient' },
        zhCN: { name: '通用成分', slug: 'ingredient-zh' },
      },
    }),
    CategoryModel.create({
      translations: { en: { name: 'Oncology', slug: 'oncology' }, zhCN: { name: '肿瘤', slug: 'oncology-zh' } },
    }),
  ]);
  manufacturerId = maker._id;
  genericId = generic._id;
  categoryId = category._id;
  const token = generateToken();
  const now = new Date();
  await AdminSessionModel.create({
    admin_id: admin._id,
    purpose: 'ADMIN',
    token_hash: hashToken(token),
    session_generation: 0,
    last_seen_at: now,
    expires_at: new Date(now.getTime() + 1_800_000),
  });
  const signature = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(token).digest('base64').replace(/=+$/, '');
  adminCookie = `medaxis_admin_session=${encodeURIComponent(`s:${token}.${signature}`)}`;
  fetcher.mockClear();
});
afterAll(async () => {
  try {
    if (mongoose.connection.name === databaseName && databaseName.startsWith('catalog_test_'))
      await mongoose.connection.db?.dropDatabase();
  } finally {
    await mongoose.disconnect();
  }
});

describe('public/admin catalog, CMS and settings against MongoDB', () => {
  it('serves only published products and never leaks poisoned pricing fields through public endpoints', async () => {
    const published = await createProduct();
    await ProductModel.create({ ...productBody('DRAFT', 'draft'), status: 'DRAFT' });
    await ProductModel.create({ ...productBody('ARCHIVED', 'archived'), status: 'ARCHIVED' });
    await mongoose.connection.db!.collection<{ _id: string } & Record<string, unknown>>('products').updateOne(
      { _id: published._id },
      {
        $set: {
          price: 999,
          procurement_cost_bdt: '999',
          admin_notes: 'hidden',
          'translations.en.price': 999,
          'translations.zhCN.price': 999,
          'translations.zhCN.internal_note': 'hidden',
        },
      },
      { bypassDocumentValidation: true },
    );
    await mongoose.connection
      .db!.collection<{ _id: string } & Record<string, unknown>>('manufacturers')
      .updateOne(
        { _id: manufacturerId },
        { $set: { internal_cost: 999, 'translations.en.price': 999, 'translations.zhCN.procurement_cost_bdt': 999 } },
        { bypassDocumentValidation: true },
      );
    for (const [locale, suffix] of [
      ['en', ''],
      ['zh-CN', '-zh'],
    ] as const) {
      for (const path of [
        '/products',
        `/products/demo-medicine${suffix}`,
        `/manufacturers/maker${suffix}`,
        `/generics/ingredient${suffix}`,
        `/categories/oncology${suffix}`,
      ]) {
        const response = await request(app).get(`/v1/public${path}`).query({ locale });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        noCommercialKeys(response.body);
      }
    }
    const sitemap = await request(app).get('/v1/public/sitemap-catalog');
    expect(sitemap.status).toBe(200);
    noCommercialKeys(sitemap.body);
    const list = await request(app).get('/v1/public/products');
    expect(list.body.data.products).toHaveLength(1);
    expect(list.body.meta.pagination.total_items).toBe(1);
    expect((await request(app).get('/v1/public/products/draft')).status).toBe(404);
    expect((await request(app).get('/v1/public/products/archived')).status).toBe(404);
  });

  it('localizes product/master DTOs, supports filters, and returns bounded facets/pagination', async () => {
    await createProduct();
    const english = await request(app).get('/v1/public/products?locale=en');
    expect(english.status).toBe(200);
    expect(english.body.data.products[0]).toMatchObject({
      brand_name: 'Demo Medicine',
      locale: 'en',
      manufacturer: { name: 'Demo Maker' },
    });
    const chinese = await request(app).get(
      '/v1/public/products?locale=zh-CN&manufacturer=maker-zh&generic=ingredient-zh&category=oncology-zh&cold_chain=false&q=示例&limit=1',
    );
    expect(chinese.status).toBe(200);
    expect(chinese.body.data.products[0]).toMatchObject({
      brand_name: '示例药品',
      manufacturer: { name: '制造商' },
      alternate_slugs: { en: 'demo-medicine', zhCN: 'demo-medicine-zh' },
    });
    expect(chinese.body.data.facets.cold_chain).toEqual([{ required: false, count: 1 }]);
    const detail = await request(app).get('/v1/public/products/demo-medicine-zh?locale=zh-CN');
    expect(detail.body.data.brand_name).toBe('示例药品');
    expect((await request(app).get('/v1/public/products?q=.*')).body.meta.pagination.total_items).toBe(0);
    expect((await request(app).get('/v1/public/products?cold_chain=true')).body.data.products).toHaveLength(0);
    expect((await request(app).get('/v1/public/products?limit=101')).status).toBe(422);
  });

  it('falls back to English and omits inactive master entities from the sitemap', async () => {
    const body = productBody();
    await ProductModel.create({ ...body, translations: { en: body.translations.en } });
    const detail = await request(app).get('/v1/public/products/demo-medicine?locale=zh-CN');
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({
      brand_name: 'Demo Medicine',
      locale: 'en',
      alternate_slugs: { en: 'demo-medicine', zhCN: null },
    });
    await CategoryModel.create({ translations: { en: { name: 'Hidden', slug: 'hidden' } }, is_active: false });
    const sitemap = await request(app).get('/v1/public/sitemap-catalog');
    expect(sitemap.body.data.products[0]).toMatchObject({ en: 'demo-medicine', zhCN: null });
    expect(sitemap.body.data.categories).toHaveLength(1);
    expect((await request(app).get('/v1/public/categories/hidden')).body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('rejects inactive/missing master references with 422 before creating a product', async () => {
    await ManufacturerModel.updateOne({ _id: manufacturerId }, { $set: { is_active: false } });
    const inactive = await request(app)
      .post('/v1/admin/catalog/products')
      .set('Cookie', adminCookie)
      .send(productBody());
    expect(inactive.status).toBe(422);
    expect(inactive.body.error.details[0].field).toBe('manufacturer_id');
    expect(await ProductModel.countDocuments()).toBe(0);
    const missingManufacturer = await request(app)
      .post('/v1/admin/catalog/products')
      .set('Cookie', adminCookie)
      .send({ ...productBody(), manufacturer_id: randomUUID() });
    expect(missingManufacturer.status).toBe(422);
    expect(missingManufacturer.body.error.details[0].field).toBe('manufacturer_id');
    expect(await ProductModel.countDocuments()).toBe(0);
    await ManufacturerModel.updateOne({ _id: manufacturerId }, { $set: { is_active: true } });
    for (const input of [
      { ...productBody(), generic_id: randomUUID() },
      { ...productBody(), category_ids: [randomUUID()] },
    ])
      expect(
        (await request(app).post('/v1/admin/catalog/products').set('Cookie', adminCookie).send(input)).status,
      ).toBe(422);
  });

  it('writes redirects atomically, flattens history, and prevents historical-slug reuse/loops', async () => {
    const product = await createProduct();
    for (const next of ['second-name', 'third-name']) {
      const changed = await request(app)
        .patch(`/v1/admin/catalog/products/${product._id}`)
        .set('Cookie', adminCookie)
        .send({ translations: { en: { slug: next } } });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(changed.body.data.status).toBe('PUBLISHED');
    }
    for (const previous of ['demo-medicine', 'second-name']) {
      const redirect = await request(app).get(`/v1/public/products/${previous}`);
      expect(redirect.status).toBe(301);
      expect(redirect.headers.location).toBe('/en/products/third-name');
    }
    expect(await UrlRedirectModel.countDocuments({ target_path: '/en/products/third-name' })).toBe(2);
    const loop = await request(app)
      .patch(`/v1/admin/catalog/products/${product._id}`)
      .set('Cookie', adminCookie)
      .send({ translations: { en: { slug: 'demo-medicine' } } });
    expect(loop.status).toBe(422);
    const reused = await request(app)
      .post('/v1/admin/catalog/products')
      .set('Cookie', adminCookie)
      .send(productBody('NEW', 'demo-medicine'));
    expect(reused.status).toBe(422);
    expect(await ProductModel.countDocuments()).toBe(1);
  });

  it('rolls back the product, redirect and webhook when an audit write fails', async () => {
    const product = await createProduct();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    fetcher.mockClear();
    const save = vi.spyOn(AuditLogModel.prototype, 'save').mockRejectedValueOnce(new Error('Test audit failure'));
    try {
      const changed = await request(app)
        .patch(`/v1/admin/catalog/products/${product._id}`)
        .set('Cookie', adminCookie)
        .send({ translations: { en: { slug: 'will-roll-back' } } });
      expect(changed.status).toBe(500);
      expect((await ProductModel.findById(product._id).lean())!.translations.en.slug).toBe('demo-medicine');
      expect(await UrlRedirectModel.countDocuments()).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
    }
  });

  it('updates master profiles, redirects and materialized product search labels together', async () => {
    const product = await createProduct();
    const generic = await request(app)
      .post('/v1/admin/catalog/generics')
      .set('Cookie', adminCookie)
      .send({ id: genericId, translations: { en: { name: 'Renamed Ingredient', slug: 'renamed-ingredient' } } });
    expect(generic.status).toBe(200);
    expect((await ProductModel.findById(product._id).lean())!.generic_name).toBe('Renamed Ingredient');
    expect((await request(app).get('/v1/public/generics/ingredient')).headers.location).toBe(
      '/en/generics/renamed-ingredient',
    );
    const manufacturer = await request(app)
      .post('/v1/admin/catalog/manufacturers')
      .set('Cookie', adminCookie)
      .send({ id: manufacturerId, country: 'BD', translations: { en: { name: 'New Maker', slug: 'maker' } } });
    expect(manufacturer.status).toBe(200);
    expect((await ProductModel.findById(product._id).lean())!.manufacturer).toBe('New Maker');
    expect((await request(app).get('/v1/public/products?q=Renamed')).body.data.products).toHaveLength(1);
  });

  it('hides products and redirects whose manufacturer becomes inactive, including sitemap entries', async () => {
    const product = await createProduct();
    expect(
      (
        await request(app)
          .patch(`/v1/admin/catalog/products/${product._id}`)
          .set('Cookie', adminCookie)
          .send({ translations: { en: { slug: 'renamed' } } })
      ).status,
    ).toBe(200);
    const disabled = await request(app)
      .post('/v1/admin/catalog/manufacturers')
      .set('Cookie', adminCookie)
      .send({
        id: manufacturerId,
        country: 'BD',
        is_active: false,
        translations: { en: { name: 'Maker', slug: 'maker' } },
      });
    expect(disabled.status).toBe(200);
    expect((await request(app).get('/v1/public/products')).body.data.products).toHaveLength(0);
    expect((await request(app).get('/v1/public/products/renamed')).status).toBe(404);
    expect((await request(app).get('/v1/public/products/demo-medicine')).status).toBe(404);
    const sitemap = await request(app).get('/v1/public/sitemap-catalog');
    expect(sitemap.body.data.products).toHaveLength(0);
    expect(sitemap.body.data.manufacturers).toHaveLength(0);
  });

  it('validates CSV without writes during dry run, then commits and upserts the same SKU', async () => {
    const data = csv(csvLine('CSV-001', 'csv-medicine'));
    const dry = await request(app)
      .post('/v1/admin/catalog/import-csv?dry_run=true')
      .set('Cookie', adminCookie)
      .attach('file', data, 'catalog.csv');
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.data).toMatchObject({ valid: true, committed: 0, total_rows: 1 });
    expect(await ProductModel.countDocuments()).toBe(0);
    expect(await AuditLogModel.countDocuments()).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const committed = await request(app)
        .post('/v1/admin/catalog/import-csv?dry_run=false')
        .set('Cookie', adminCookie)
        .attach('file', data, 'catalog.csv');
      expect(committed.status, JSON.stringify(committed.body)).toBe(202);
      expect(committed.body.data.committed).toBe(1);
    }
    expect(await ProductModel.countDocuments({ sku: 'CSV-001' })).toBe(1);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  });

  it('reports invalid CSV row numbers and never partially commits a malformed batch', async () => {
    const data = csv(csvLine('GOOD', 'good'), csvLine('BAD', 'bad', 'missing-manufacturer'));
    const dry = await request(app)
      .post('/v1/admin/catalog/import-csv?dry_run=true')
      .set('Cookie', adminCookie)
      .attach('file', data, 'catalog.csv');
    expect(dry.body.data.valid).toBe(false);
    expect(dry.body.data.rows[1]).toMatchObject({
      row: 3,
      valid: false,
      errors: [{ field: 'manufacturer_slug', issue: 'Active manufacturer not found.' }],
    });
    const commit = await request(app)
      .post('/v1/admin/catalog/import-csv?dry_run=false')
      .set('Cookie', adminCookie)
      .attach('file', data, 'catalog.csv');
    expect(commit.status).toBe(422);
    expect(commit.body.error.details[0].field).toBe('rows[3].manufacturer_slug');
    expect(await ProductModel.countDocuments()).toBe(0);
  });

  it('rolls back the entire CSV batch if a later row cannot be audited', async () => {
    const original = AuditLogModel.prototype.save;
    const save = vi
      .spyOn(AuditLogModel.prototype, 'save')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Test second-row audit failure'));
    try {
      const commit = await request(app)
        .post('/v1/admin/catalog/import-csv?dry_run=false')
        .set('Cookie', adminCookie)
        .attach('file', csv(csvLine('FIRST', 'first'), csvLine('SECOND', 'second')), 'catalog.csv');
      expect(commit.status).toBe(500);
      expect(await ProductModel.countDocuments()).toBe(0);
      expect(await AuditLogModel.countDocuments()).toBe(0);
    } finally {
      save.mockRestore();
    }
  });

  it('serves only scheduled active localized CMS banners in sort order and sanitizes their content', async () => {
    const live = await request(app)
      .post('/v1/admin/cms/banners')
      .set('Cookie', adminCookie)
      .send({
        translations: {
          en: { title: 'Live', body: '<p>Safe</p><script>evil()</script>' },
          zhCN: { title: '公告', body: '<p>正文</p>' },
        },
        sort_order: 2,
        link_path: '/en/products/demo-medicine',
      });
    expect(live.status).toBe(200);
    await CmsBannerModel.create([
      { translations: { en: { title: 'First', body: 'First' } }, sort_order: 1 },
      { translations: { en: { title: 'Disabled', body: 'Hidden' } }, is_active: false },
      { translations: { en: { title: 'Expired', body: 'Hidden' } }, ends_at: new Date(Date.now() - 1000) },
      { translations: { en: { title: 'Future', body: 'Hidden' } }, starts_at: new Date(Date.now() + 60_000) },
    ]);
    const banners = await request(app).get('/v1/public/cms/banners?locale=zh-CN');
    expect(banners.body.data.map((row: { title: string }) => row.title)).toEqual(['First', '公告']);
    expect(JSON.stringify(banners.body)).not.toMatch(/script|evil\(\)|Disabled|Expired|Future/);
  });

  it('persists allowlisted platform settings, validates wire instructions, and enforces configured packaging units', async () => {
    const changed = await request(app)
      .patch('/v1/admin/settings')
      .set('Cookie', adminCookie)
      .send({
        packaging_units: { units: ['BOX', 'VIAL'] },
        wire_instructions: { configured: false, instructions: 'Awaiting bank confirmation' },
      });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const settings = await request(app).get('/v1/admin/settings').set('Cookie', adminCookie);
    expect(settings.body.data.packaging_units.value.units).toEqual(['BOX', 'VIAL']);
    expect(
      (
        await request(app)
          .patch('/v1/admin/settings')
          .set('Cookie', adminCookie)
          .send({ wire_instructions: { configured: true, instructions: 'incomplete' } })
      ).status,
    ).toBe(422);
    expect(
      (await request(app).patch('/v1/admin/settings').set('Cookie', adminCookie).send({ secret: 'forbidden' })).status,
    ).toBe(422);
    const product = await request(app)
      .post('/v1/admin/catalog/products')
      .set('Cookie', adminCookie)
      .send({ ...productBody(), packaging_unit: 'BOTTLE' });
    expect(product.status).toBe(422);
    expect(await AuditLogModel.countDocuments({ action_type: 'PLATFORM_SETTING_UPDATED' })).toBe(2);
  });
});
