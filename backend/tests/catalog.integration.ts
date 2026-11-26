import 'dotenv/config';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
import { s3EnvSettings, validEnv } from './helpers/env.js';
import { png } from './fixtures/prescriptions.js';
import { rfqRecord } from './fixtures/rfq.js';
import { mp4 } from './fixtures/catalog-media.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createStorageService } from '../src/modules/storage/storage.service.js';

const databaseName = `catalog_test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const env = loadEnv({
  ...validEnv,
  ...s3EnvSettings,
  REVALIDATE_WEBHOOK_SECRET: 'test-revalidation-key',
});
const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 200 }));
const s3Send = vi.fn().mockResolvedValue({});
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

it('changes homepage visibility independently of catalog availability', async () => {
  const toggle = (showOnHome: boolean, authenticated = true) => {
    const call = request(app).patch(`/v1/admin/catalog/categories/${categoryId}/home-visibility`);
    if (authenticated) call.set('Cookie', adminCookie);
    return call.send({ show_on_home: showOnHome });
  };
  const home = (locale = 'en') => request(app).get(`/v1/public/categories?locale=${locale}&home=true`);
  await createProduct();
  expect((await home()).body.data.categories).toMatchObject([{ id: categoryId, product_count: 1 }]);
  expect((await toggle(false, false)).status).toBe(401);

  const hidden = await toggle(false);
  expect(hidden.status, JSON.stringify(hidden.body)).toBe(200);
  expect(hidden.body.data).toMatchObject({ show_on_home: false, is_active: true });
  expect((await home()).body.data.categories).toEqual([]);
  expect((await home('zh-CN')).body.data.categories).toEqual([]);
  const directory = await request(app).get('/v1/public/categories');
  expect(directory.body.data.categories).toMatchObject([{ id: categoryId }]);
  const category = await request(app).get('/v1/public/categories/oncology');
  expect(category.body.data.products).toMatchObject([{ sku: 'DEMO-001' }]);

  const list = await request(app).get('/v1/admin/catalog/categories').set('Cookie', adminCookie);
  expect(list.body.data).toMatchObject([{ _id: categoryId, show_on_home: false }]);
  expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
    body: expect.stringContaining('catalog'),
  }));

  expect((await toggle(true)).status).toBe(200);
  expect((await home()).body.data.categories).toMatchObject([{ id: categoryId }]);
  expect((await home('zh-CN')).body.data.categories).toMatchObject([{ id: categoryId, slug: 'oncology-zh' }]);
  await CategoryModel.updateOne({ _id: categoryId }, { $set: { is_active: false } });
  expect((await home()).body.data.categories).toEqual([]);
});
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
  if (mongoose.connection.name !== databaseName) throw new Error('Refusing to migrate a non-test database');
  await migrate();
  passwordHash = await hashPassword('test-only admin password');
  app = createApp({ env, logger: createLogger({ silent: true }), revalidateFetch: fetcher, storage: createStorageService(env, { send: s3Send }) });
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
    'rfqs',
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
  it('shows featured homepage categories first and keeps sort order within each group', async () => {
    const category = (slug: string, sort_order: number) => CategoryModel.create({
      translations: { en: { name: slug, slug } }, sort_order,
    });
    const [featuredLater, featuredFirst, regular, hidden] = await Promise.all([
      category('featured-later', 8),
      category('featured-first', 5),
      category('regular-category', 1),
      category('hidden-featured', 2),
    ]);
    const settings = (id: string, changes: { home_featured?: boolean; show_on_home?: boolean }) =>
      request(app).patch(`/v1/admin/catalog/categories/${id}/home-visibility`).set('Cookie', adminCookie).send(changes);
    const ids = async (query: string) => {
      const response = await request(app).get(`/v1/public/categories?${query}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return (response.body.data.categories as { id: string }[]).map(({ id }) => id);
    };

    expect((await settings(featuredLater._id, { home_featured: true })).status).toBe(200);
    const pinned = await settings(featuredFirst._id, { home_featured: true });
    expect(pinned.body.data).toMatchObject({ home_featured: true, is_active: true, sort_order: 5 });
    expect((await settings(regular._id, { home_featured: false })).status).toBe(200);
    expect((await settings(hidden._id, { home_featured: true, show_on_home: false })).status).toBe(200);
    const expected = [featuredFirst._id, featuredLater._id, categoryId, regular._id];
    expect(await ids('home=true&locale=en')).toEqual(expected);
    expect(await ids('home=true&locale=zh-CN')).toEqual(expected);
    expect(await ids('locale=en')).toEqual([categoryId, regular._id, hidden._id, featuredFirst._id, featuredLater._id]);

    expect((await settings(featuredFirst._id, { home_featured: false })).status).toBe(200);
    expect(await ids('home=true')).toEqual([featuredLater._id, categoryId, regular._id, featuredFirst._id]);
  });

  it('saves long generic indications and Chinese descriptions, including public and admin reads', async () => {
    const indication = 'Owner supplied and verified medicine information. '.repeat(25).trim();
    const body = { translations: { en: { name: 'Osimertinib', slug: 'osimertinib' }, zhCN: { name: '奥希替尼', slug: 'osimertinib-zh', description: '管理员核实的中文说明。' } }, therapeutic_indications: [indication], is_active: true };
    const result = await request(app).post('/v1/admin/catalog/generics').set('Cookie', adminCookie).send(body);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const id = result.body.data._id as string;
    expect((await GenericModel.findById(id).lean())?.therapeutic_indications).toEqual([indication]);
    const admin = await request(app).get(`/v1/admin/catalog/generics/${id}`).set('Cookie', adminCookie);
    expect(admin.body.data).toMatchObject({ therapeutic_indications: [indication], translations: body.translations });
    const publicRecord = await request(app).get('/v1/public/generics/osimertinib-zh?locale=zh-CN');
    expect(publicRecord.status, JSON.stringify(publicRecord.body)).toBe(200);
    expect(publicRecord.body.data).toMatchObject({ therapeutic_indications: [indication], description: body.translations.zhCN.description });
    const translation = await request(app).post('/v1/admin/catalog/translate-indications').set('Cookie', adminCookie).send({ text: indication });
    expect(translation.status).toBe(503);
    expect(translation.body.error.code).toBe('TRANSLATION_NOT_CONFIGURED');
    expect((await request(app).post('/v1/admin/catalog/translate-indications').send({ text: indication })).status).toBe(401);
    expect((await request(app).post('/v1/admin/catalog/translate-indications').set('Cookie', adminCookie).set('Origin', 'https://untrusted.example').send({ text: indication })).status).toBe(403);
  });

  it('round-trips six ordered pictures, optional video and SEO fields, then clears optional content explicitly', async () => {
    const upload = await request(app).post('/v1/admin/catalog/videos').set('Cookie', adminCookie).attach('video', mp4, { filename: 'product.mp4', contentType: 'video/mp4' });
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const videoKey = upload.body.data.object_key as string;
    const imageKeys = Array.from({ length: 6 }, (_, index) => `products/s3/image-${index}.png`);
    const body = { ...productBody(), image_keys: imageKeys, video_key: videoKey, seo_image_key: 'products/s3/social.png', storage_condition: 'Below 25C',
      translations: { en: { brand_name: 'Demo Medicine', slug: 'demo-medicine', description: '<h3>Product details</h3><p><strong>Verified</strong> medicine.</p><script>unsafe()</script>', seo_title: 'Medicine sourcing', meta_description: 'Request product information.' } },
    };
    const created = await request(app).post('/v1/admin/catalog/products').set('Cookie', adminCookie).send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data._id as string;
    expect(created.body.data).toMatchObject({ video_key: videoKey, seo_image_key: body.seo_image_key, image_keys: imageKeys });
    const publicRecord = (await request(app).get('/v1/public/products/demo-medicine')).body.data;
    expect(publicRecord.primary_image_url).toBe(`${env.S3_PUBLIC_BASE_URL}/${imageKeys[0]}`);
    expect(publicRecord.image_urls).toHaveLength(6);
    expect(publicRecord.video_url).toBe(upload.body.data.url);
    expect(publicRecord.seo_image_url).toBe(`${env.S3_PUBLIC_BASE_URL}/products/s3/social.png`);
    expect(publicRecord.description_html).toContain('<strong>Verified</strong>');
    expect(publicRecord.description_html).not.toMatch(/script|unsafe/);
    expect(publicRecord).not.toHaveProperty('video_key');
    const reordered = [imageKeys[4], ...imageKeys.filter((_, index) => index !== 4)];
    const updated = await request(app).patch(`/v1/admin/catalog/products/${id}`).set('Cookie', adminCookie).send({ image_keys: reordered, video_key: null, seo_image_key: null, storage_condition: null, translations: { en: { seo_title: null, meta_description: null, description: null } } });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const stored = await ProductModel.findById(id).lean();
    expect(stored).not.toHaveProperty('video_key');
    expect(stored).not.toHaveProperty('seo_image_key');
    expect(stored).not.toHaveProperty('storage_condition');
    expect(stored?.translations.en).not.toHaveProperty('seo_title');
    expect(stored?.translations.en).not.toHaveProperty('description');
    const cleared = (await request(app).get('/v1/public/products/demo-medicine')).body.data;
    expect(cleared).not.toHaveProperty('video_url');
    expect(cleared).not.toHaveProperty('seo_image_url');
    expect(cleared.primary_image_url).toBe(`${env.S3_PUBLIC_BASE_URL}/${imageKeys[4]}`);
    const omitted = await request(app).patch(`/v1/admin/catalog/products/${id}`).set('Cookie', adminCookie).send({ strength: '20 mg' });
    expect(omitted.status).toBe(200);
    expect(omitted.body.data.image_keys).toEqual(reordered);
  });

  it('rejects extra pictures, unsafe video references and unauthorized or spoofed video uploads', async () => {
    for (const input of [
      { ...productBody(), image_keys: Array.from({ length: 7 }, (_, index) => `products/s3/${index}.png`) },
      { ...productBody(), video_key: 'https://untrusted.example/movie.mp4' },
      { ...productBody(), video_key: 'prescriptions/local/private.mp4' },
      { ...productBody(), seo_image_key: 'products/local/videos/movie.mp4' },
    ]) expect((await request(app).post('/v1/admin/catalog/products').set('Cookie', adminCookie).send(input)).status).toBe(422);
    expect((await request(app).post('/v1/admin/catalog/videos').attach('video', mp4, 'movie.mp4')).status).toBe(401);
    expect((await request(app).post('/v1/admin/catalog/videos').set('Cookie', adminCookie).set('Origin', 'https://untrusted.example').attach('video', mp4, 'movie.mp4')).status).toBe(403);
    expect((await request(app).post('/v1/admin/catalog/videos').set('Cookie', adminCookie).attach('video', png, { filename: 'fake.mp4', contentType: 'video/mp4' })).status).toBe(422);
    expect(await ProductModel.countDocuments()).toBe(0);
  });

  it('deletes a product from every catalog view, preserves RFQ history and cannot republish it', async () => {
    const created = await createProduct();
    const detailPath = `/v1/admin/catalog/products/${created._id}`;
    const before = await request(app).get(detailPath).set('Cookie', adminCookie);
    const body = { expected_updated_at: before.body.data.updated_at };
    const rfq = rfqRecord();
    rfq.items[0]!.is_uncatalogued = false;
    rfq.items[0]!.product_id = created._id;
    delete rfq.items[0]!.custom_medicine_name;
    await mongoose.connection.db!.collection('rfqs').insertOne(rfq as never);
    const historyBefore = await mongoose.connection.db!.collection('rfqs').findOne({ _id: rfq._id } as never);
    s3Send.mockClear();
    const deleted = await request(app).delete(detailPath).set('Cookie', adminCookie).send(body);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body.data).toEqual({ id: created._id, deleted: true });
    expect((await request(app).get(detailPath).set('Cookie', adminCookie)).status).toBe(404);
    for (const query of ['', '?status=ARCHIVED', '?q=DEMO-001']) {
      const list = await request(app).get(`/v1/admin/catalog/products${query}`).set('Cookie', adminCookie);
      expect(list.body.data).toEqual([]);
      expect(list.body.meta.pagination.total_items).toBe(0);
    }
    expect((await request(app).get('/v1/public/products')).body.data.products).toEqual([]);
    expect((await request(app).get('/v1/public/products/demo-medicine')).status).toBe(404);
    expect((await request(app).get('/v1/public/sitemap-catalog')).body.data.products).toEqual([]);
    const retained = await ProductModel.findById(created._id).lean();
    expect(retained).toMatchObject({ status: 'ARCHIVED', image_keys: ['products/demo.png'], deleted_at: expect.any(Date) });
    expect(await mongoose.connection.db!.collection('rfqs').findOne({ _id: rfq._id } as never)).toEqual(historyBefore);
    const makers = await request(app).get('/v1/admin/catalog/manufacturers').set('Cookie', adminCookie);
    expect(makers.body.data[0]).toMatchObject({ product_count: 0, rfq_count: 1 });
    expect((await request(app).delete(detailPath).set('Cookie', adminCookie).send(body)).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ entity_id: created._id, action_type: 'PRODUCT_DELETED' })).toBe(1);
    expect((await request(app).patch(detailPath).set('Cookie', adminCookie).send({ status: 'PUBLISHED' })).status).toBe(404);
    const dryRun = await request(app).post('/v1/admin/catalog/import-csv?dry_run=true')
      .set('Cookie', adminCookie).attach('file', csv(csvLine('DEMO-001', 'demo-medicine')), 'catalog.csv');
    expect(dryRun.status).toBe(200);
    expect(dryRun.body.data.valid).toBe(false);
    expect(dryRun.body.data.rows[0].errors[0].field).toBe('sku');
    expect(s3Send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(false);
  });

  it.each(['manufacturers', 'generics', 'categories'] as const)('protects products using %s and deletes unused entries without losing history', async (kind) => {
    const product = await createProduct();
    const id = kind === 'manufacturers' ? manufacturerId : kind === 'generics' ? genericId : categoryId;
    const detailPath = `/v1/admin/catalog/${kind}/${id}`;
    const before = await request(app).get(detailPath).set('Cookie', adminCookie);
    const body = { expected_updated_at: before.body.data.updated_at };
    const blocked = await request(app).delete(detailPath).set('Cookie', adminCookie).send(body);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.message).toContain('used by a product');
    expect((await request(app).get(`/v1/public/${kind}/${before.body.data.translations.en.slug}`)).status).toBe(200);
    const productBefore = await request(app).get(`/v1/admin/catalog/products/${product._id}`).set('Cookie', adminCookie);
    expect((await request(app).delete(`/v1/admin/catalog/products/${product._id}`).set('Cookie', adminCookie)
      .send({ expected_updated_at: productBefore.body.data.updated_at })).status).toBe(200);
    const deleted = await request(app).delete(detailPath).set('Cookie', adminCookie).send(body);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(deleted.body.data).toEqual({ id, deleted: true });
    expect((await request(app).get(detailPath).set('Cookie', adminCookie)).status).toBe(404);
    for (const query of ['', '?is_active=true', '?is_active=false']) {
      const list = await request(app).get(`/v1/admin/catalog/${kind}${query}`).set('Cookie', adminCookie);
      expect(list.body.data).toEqual([]);
      expect(list.body.meta.pagination.total_items).toBe(0);
    }
    expect((await request(app).get(`/v1/public/${kind}/${before.body.data.translations.en.slug}`)).status).toBe(404);
    expect((await request(app).get('/v1/public/sitemap-catalog')).body.data[kind]).toEqual([]);
    const record = await mongoose.connection.db!.collection(kind).findOne({ _id: id } as never);
    expect(record).toMatchObject({ is_active: false, deleted_at: expect.any(Date) });
    expect((await request(app).delete(detailPath).set('Cookie', adminCookie).send(body)).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ entity_id: id, action_type: 'CATALOG_MASTER_DELETED' })).toBe(1);
    const restore = await request(app).post(`/v1/admin/catalog/${kind}`).set('Cookie', adminCookie).send({
      id, translations: before.body.data.translations, is_active: true,
    });
    expect(restore.status).toBe(404);
  });

  it('rejects stale, unauthorized and malformed deletion requests without altering the catalog', async () => {
    const product = await createProduct();
    const detailPath = `/v1/admin/catalog/products/${product._id}`;
    const body = { expected_updated_at: '2000-01-01T00:00:00.000Z' };
    expect((await request(app).delete(detailPath).send(body)).status).toBe(401);
    expect((await request(app).delete(detailPath).set('Cookie', adminCookie).set('Origin', 'https://untrusted.example').send(body)).status).toBe(403);
    expect((await request(app).delete(detailPath).set('Cookie', adminCookie).send(body)).status).toBe(409);
    for (const invalid of [{}, { expected_updated_at: 'bad' }, { ...body, deleted_at: 'now' }]) {
      expect((await request(app).delete(detailPath).set('Cookie', adminCookie).send(invalid)).status).toBe(422);
    }
    expect((await request(app).delete(`${detailPath}?force=true`).set('Cookie', adminCookie).send(body)).status).toBe(422);
    expect((await request(app).get(detailPath).set('Cookie', adminCookie)).status).toBe(200);
    expect(await AuditLogModel.countDocuments({ entity_id: product._id, action_type: 'PRODUCT_DELETED' })).toBe(0);
  });

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

  it('publishes only the supply network destinations selected by an administrator', async () => {
    const read = () => request(app).get('/v1/public/supply-network');
    const write = (countries: string[]) => request(app).patch('/v1/admin/settings').set('Cookie', adminCookie)
      .send({ supply_network: { countries } });
    expect((await read()).body.data).toEqual({ destinations: [] });
    expect((await request(app).patch('/v1/admin/settings').send({ supply_network: { countries: ['US'] } })).status).toBe(401);
    for (const invalid of [['US', 'US'], ['ZZ'], ['BD']]) expect((await write(invalid)).status).toBe(422);
    const save = await write(['GB', 'US']);
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(save.body.data.supply_network.value.countries).toEqual(['GB', 'US']);
    expect(save.body.data.supply_network_country_codes).toEqual(expect.arrayContaining(['GB', 'US', 'CN']));
    expect((await read()).body.data).toEqual({ destinations: [
      { country: 'GB', latitude: expect.any(Number), longitude: expect.any(Number) },
      { country: 'US', latitude: expect.any(Number), longitude: expect.any(Number) },
    ] });
    expect(await AuditLogModel.countDocuments({ action_type: 'PLATFORM_SETTING_UPDATED' })).toBe(1);
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ body: expect.stringContaining('settings') }));
    expect((await write([])).status).toBe(200);
    expect((await read()).body.data).toEqual({ destinations: [] });
  });

  it('matches only the starting letter of the displayed medicine name before pagination', async () => {
    const create = (sku: string, name: string, localizedName?: string, status: 'PUBLISHED' | 'ARCHIVED' = 'PUBLISHED') => {
      const body = productBody(sku, sku.toLowerCase());
      return ProductModel.create({ ...body, status, translations: {
        en: { ...body.translations.en, brand_name: name },
        ...(localizedName ? { zhCN: { ...body.translations.zhCN, brand_name: localizedName } } : {}),
      } });
    };
    await Promise.all([
      create('INITIAL-1', 'Alpha medicine', 'Beta translated medicine'),
      create('INITIAL-2', 'a second medicine'),
      create('INITIAL-3', 'Beta with alpha in the middle'),
      create('INITIAL-4', 'Archived Alpha', undefined, 'ARCHIVED'),
    ]);
    const result = await request(app).get('/v1/public/products').query({ initial: 'a', category: 'oncology', manufacturer: 'maker', limit: 1, page: 2 });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.meta.pagination.total_items).toBe(2);
    expect(result.body.data.products).toMatchObject([{ brand_name: 'a second medicine' }]);
    const localized = await request(app).get('/v1/public/products').query({ initial: 'A', locale: 'zh-CN' });
    expect(localized.body.data.products).toMatchObject([{ brand_name: 'a second medicine', locale: 'en' }]);
    const text = await request(app).get('/v1/public/products').query({ q: 'alpha' });
    expect(text.body.meta.pagination.total_items).toBe(2);
    expect((await request(app).get('/v1/public/products?initial=AA')).status).toBe(422);
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
      .send({ id: manufacturerId, translations: { en: { name: 'New Maker', slug: 'maker' } } });
    expect(manufacturer.status).toBe(200);
    expect(manufacturer.body.data.country).toBe('BD');
    expect((await ProductModel.findById(product._id).lean())!.manufacturer).toBe('New Maker');
    expect((await request(app).get('/v1/public/products?q=Renamed')).body.data.products).toHaveLength(1);
  });

  it('rejects duplicate manufacturer slugs while allowing edits and new unique manufacturers', async () => {
    const path = '/v1/admin/catalog/manufacturers';
    const save = (body: object) => request(app).post(path).set('Cookie', adminCookie).send(body);
    const count = await ManufacturerModel.countDocuments();
    const duplicateEnglish = await save({ translations: { en: { name: 'Maker', slug: 'maker' } } });
    expect(duplicateEnglish.status).toBe(422);
    expect(duplicateEnglish.body.error).toMatchObject({ code: 'CATALOG_SLUG_CONFLICT', details: [{ field: 'translations.en.slug' }] });
    const duplicateChinese = await save({ translations: { en: { name: 'Other Maker', slug: 'other-maker' }, zhCN: { name: 'Other', slug: 'maker-zh' } } });
    expect(duplicateChinese.status).toBe(422);
    expect(duplicateChinese.body.error.details).toMatchObject([{ field: 'translations.zhCN.slug' }]);
    expect(await ManufacturerModel.countDocuments()).toBe(count);
    const edit = await save({ id: manufacturerId, translations: { en: { name: 'Updated Maker', slug: 'maker' }, zhCN: { name: 'Updated', slug: 'maker-zh' } } });
    expect(edit.status).toBe(200);
    expect(edit.body.data._id).toBe(manufacturerId);
    const created = await save({ translations: { en: { name: 'Other Maker', slug: 'other-maker' }, zhCN: { name: 'Other', slug: 'other-maker-zh' } } });
    expect(created.status).toBe(200);
    expect(created.body.data._id).not.toBe(manufacturerId);
    expect(await ManufacturerModel.countDocuments()).toBe(count + 1);
  });

  it.each(['generics', 'categories'] as const)('stores, preserves, replaces and removes %s pictures on local disk without changing other details', async (kind) => {
    const directory = mkdtempSync(path.join(tmpdir(), `medaxis-${kind}-picture-`));
    try {
      const localEnv = loadEnv({ ...validEnv, STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: directory });
      const localApp = createApp({ env: localEnv, logger: createLogger({ silent: true }), storage: createStorageService(localEnv) });
      const endpoint = `/v1/admin/catalog/${kind}`;
      const recordId = kind === 'categories' ? categoryId : genericId;
      const readImage = () => kind === 'categories'
        ? CategoryModel.findById(recordId).select('+logo_object_key +logo_data_url').lean()
        : GenericModel.findById(recordId).select('+logo_object_key +logo_data_url').lean();
      const slug = kind === 'categories' ? 'oncology' : 'ingredient';
      const details = kind === 'categories' ? { sort_order: 7 } : { therapeutic_indications: ['Saved indication'] };
      const fields = { id: recordId, translations: { en: { name: 'Image record', slug }, zhCN: { name: 'Image record ZH', slug: `${slug}-zh` } }, ...details, is_active: true };
      const save = (extra: object = {}) => request(localApp).post(endpoint).set('Cookie', adminCookie).send({ ...fields, ...extra });
      const image = 'data:image/png;base64,' + png.toString('base64');
      expect((await save({ logo_data_url: 'data:image/png;base64,AAAA' })).status).toBe(422);
      expect((await save({ logo_data_url: 'https://attacker.test/image.png' })).status).toBe(422);
      const uploaded = await save({ logo_data_url: image });
      expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
      const url = uploaded.body.data.logo_data_url as string;
      expect(url).toMatch(new RegExp(`^http://localhost:4000/v1/public/media/products/local/${kind}/.+\\.png$`));
      const stored = await readImage();
      const key = stored!.logo_object_key!;
      expect(stored!.logo_data_url).toBeUndefined();
      expect(readFileSync(path.join(directory, key))).toEqual(png);
      const media = await request(localApp).get(new URL(url).pathname).set('Accept', 'image/png');
      expect(media.status).toBe(200);
      expect(Buffer.from(media.body)).toEqual(png);
      const read = () => request(localApp).get(`${endpoint}/${recordId}`).set('Cookie', adminCookie);
      expect((await read()).body.data.logo_data_url).toBe(url);
      const list = await request(localApp).get(endpoint).set('Cookie', adminCookie);
      expect(list.body.data.find((item: { _id: string }) => item._id === recordId).logo_url).toBe(url);
      expect(JSON.stringify(list.body)).not.toContain('logo_object_key');
      const retained = await save({ is_active: false });
      expect(retained.body.data.logo_data_url).toBe(url);
      expect(existsSync(path.join(directory, key))).toBe(true);
      const replaced = await save({ logo_data_url: image });
      expect(replaced.status).toBe(200);
      expect(replaced.body.data.logo_data_url).not.toBe(url);
      const next = await readImage();
      expect(existsSync(path.join(directory, key))).toBe(false);
      expect(readFileSync(path.join(directory, next!.logo_object_key!))).toEqual(png);
      expect((await save({ logo_data_url: null })).status).toBe(200);
      expect(existsSync(path.join(directory, next!.logo_object_key!))).toBe(false);
      const removed = await read();
      expect(removed.body.data.logo_data_url).toBeUndefined();
      expect(removed.body.data).toMatchObject(details);
      expect(removed.body.data.translations).toEqual(fields.translations);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('saves a manufacturer logo, reloads it on detail, and removes it on request', async () => {
    const path = '/v1/admin/catalog/manufacturers';
    const fields = {
      translations: { en: { name: 'Logo Maker', slug: 'logo-maker' }, zhCN: { name: '测试药厂', slug: '测试药厂' } },
    };
    const save = (body: Record<string, unknown>) => request(app).post(path).set('Cookie', adminCookie).send({ ...fields, ...body });
    const logo = 'data:image/png;base64,' + png.toString('base64');
    expect((await save({ logo_data_url: 'data:image/png;base64,AAAA' })).status).toBe(422);
    s3Send.mockRejectedValueOnce(new Error('Storage provider unavailable'));
    const outage = await save({ logo_data_url: logo });
    expect(outage.status).toBe(503);
    expect(outage.body.error.code).toBe('MANUFACTURER_LOGO_UPLOAD_FAILED');
    expect(await ManufacturerModel.exists({ 'translations.en.slug': 'logo-maker' })).toBeNull();
    const created = await save({ logo_data_url: logo });
    expect(created.status).toBe(200);
    expect(created.body.data.country).toBeUndefined();
    expect(created.body.data.translations.zhCN).toEqual(fields.translations.zhCN);
    const url = created.body.data.logo_data_url as string;
    expect(url).toMatch(/^https:\/\/cdn\.example\.test\/products\/s3\/manufacturers\//);
    const id = created.body.data._id as string;
    const read = () => request(app).get(path + '/' + id).set('Cookie', adminCookie);
    expect((await read()).body.data.logo_data_url).toBe(url);

    expect((await save({ id })).body.data.logo_data_url).toBe(url);
    expect(JSON.stringify((await request(app).get(path).set('Cookie', adminCookie)).body)).not.toContain('logo_data_url');
    expect((await save({ id, logo_data_url: null })).status).toBe(200);
    expect((await read()).body.data.logo_data_url).toBeUndefined();
    expect(s3Send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand && url.endsWith('/' + command.input.Key))).toBe(true);
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
