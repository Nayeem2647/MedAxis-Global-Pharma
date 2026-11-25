import { Router, type Response } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { sendPaginated, sendSuccess } from '../../shared/utils/response.js';
import { adminCatalogQuery, createAdminCatalogReads } from './catalog.admin.reads.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, publicImageBaseUrl, type StorageService } from '../storage/storage.service.js';
import { createAdminCatalogService } from './catalog.admin.service.js';
import { createIndicationsTranslator } from './catalog.translation.js';
import { createCsvImportService } from './catalog.csv.service.js';
import { createPublicCatalogService } from './catalog.public.service.js';
import { createProductRatingRouter } from './product-rating.routes.js';
import {
  catalogDelete,
  catalogQuery,
  categoryHomePatch,
  localeQuery,
  productCreate,
  productHomePatch,
  productPatch,
  slug,
  uuid,
  type MasterKind,
} from './catalog.validator.js';

export function pagination(page: number, limit: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total_items: total, total_pages: pages, has_next: page < pages, has_prev: page > 1 };
}
function detail(res: Response, data: object) {
  if ('redirect' in data) {
    const target = data.redirect as { status: 301; location: string };
    res.set('Location', target.location);
    return sendSuccess(res, data, { status: 301 });
  }
  return sendSuccess(res, data);
}
export function createPublicCatalogRouter(env: AppEnv) {
  const router = Router();
  const service = createPublicCatalogService(env);
  router.use('/products/:id/ratings', createProductRatingRouter(env, service.productById));
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.tooManyRequests(60)),
  });
  router.get('/products', limiter, async (req, res) => {
    const query = catalogQuery.parse(req.query);
    const data = await service.list(query);
    sendSuccess(
      res,
      { products: data.products, facets: data.facets },
      { meta: { pagination: pagination(query.page, query.limit, data.total) } },
    );
  });
  router.get('/products/:slug', async (req, res) => {
    const query = localeQuery.parse(req.query);
    detail(res, await service.product(slug.parse(req.params.slug), query.locale));
  });
  router.get('/categories', limiter, async (req, res) => {
    const query = localeQuery.extend({ home: z.enum(['true', 'false']).optional() }).parse(req.query);
    sendSuccess(res, await service.categories(query.locale, query.home === 'true'));
  });
  router.get('/manufacturers', limiter, async (req, res) => {
    const query = localeQuery.parse(req.query);
    sendSuccess(res, await service.manufacturers(query.locale));
  });
  for (const kind of ['generics', 'manufacturers', 'categories'] as const)
    router.get(`/${kind}/:slug`, async (req, res) => {
      const query = catalogQuery.parse(req.query);
      const result = await service.master(kind, slug.parse(req.params.slug), query);
      if ('redirect' in result) {
        detail(res, result);
        return;
      }
      const { total, ...data } = result;
      sendSuccess(res, data, { meta: { pagination: pagination(query.page, query.limit, total) } });
    });
  router.get('/sitemap-catalog', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await service.sitemap());
  });
  return router;
}

export function createAdminCatalogRouter(env: AppEnv, revalidate: Revalidate, storage: StorageService) {
  const router = Router();
  const service = createAdminCatalogService(env, revalidate, storage);
  const importCsv = createCsvImportService(service, revalidate);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 1, parts: 2 },
  });
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 1, parts: 2 },
  });
  router.use(adminBoundary(env), adminAuth(env));
  const translateIndications = createIndicationsTranslator(env);
  const translationLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.tooManyRequests(60)) });
  router.post('/translate-indications', translationLimit, async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await translateIndications(req.body));
  });
  const reads = createAdminCatalogReads(publicImageBaseUrl(env), env.R2_PUBLIC_BASE_URL);
  for (const kind of ['products', 'manufacturers', 'generics', 'categories'] as const) {
    router.delete('/' + kind + '/:id', async (req, res) => {
      z.object({}).strict().parse(req.query);
      const input = catalogDelete.parse(req.body);
      sendSuccess(res, await service.deleteRecord(req, kind, uuid.parse(req.params.id), input.expected_updated_at));
    });
  }
  router.get('/products', async (req, res) => {
    const query = adminCatalogQuery.omit({ is_active: true }).parse(req.query);
    const result = await reads.products(query);
    sendPaginated(res, result.items, { ...query, totalItems: result.total });
  });
  router.get('/products/:id', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await reads.product(uuid.parse(req.params.id)));
  });
  for (const kind of ['manufacturers', 'generics', 'categories'] as const) {
    router.get(`/${kind}`, async (req, res) => {
      const query = adminCatalogQuery.pick({ page: true, limit: true, q: true, is_active: true }).parse(req.query);
      const result = await reads.masters(kind, query);
      sendPaginated(res, result.items, { ...query, totalItems: result.total });
    });
    router.get(`/${kind}/:id`, async (req, res) => {
      z.object({}).strict().parse(req.query);
      sendSuccess(res, await reads.master(kind, uuid.parse(req.params.id)));
    });
  }
  router.post('/products', async (req, res) => {
    sendSuccess(res, await service.saveProduct(req, productCreate.parse(req.body)), { status: 201 });
  });
  router.patch('/products/:id', async (req, res) => {
    sendSuccess(res, await service.saveProduct(req, productPatch.parse(req.body), uuid.parse(req.params.id)));
  });
  router.patch('/products/:id/home-sections', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const input = productHomePatch.parse(req.body);
    sendSuccess(res, await service.setProductHomeSettings(req, uuid.parse(req.params.id), input));
  });
  router.patch('/categories/:id/home-visibility', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const input = categoryHomePatch.parse(req.body);
    sendSuccess(res, await service.setCategoryHomeSettings(req, uuid.parse(req.params.id), input));
  });
  const videoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 0, parts: 1 } });
  router.post('/videos', videoUpload.single('video'), async (req, res) => {
    z.object({}).strict().parse(req.query);
    if (!req.file) throw AppError.validation([{ field: 'video', issue: 'Choose an MP4 or WebM video.' }]);
    sendSuccess(res, await service.uploadVideo(req.file.buffer), { status: 201 });
  });
  router.post('/images', imageUpload.single('image'), async (req, res) => {
    if (!req.file) throw AppError.validation([{ field: 'image', issue: 'Image file is required.' }]);
    sendSuccess(res, await storage.uploadPublicImage(req.file.buffer), { status: 201 });
  });
  router.post('/import-csv', upload.single('file'), async (req, res) => {
    const query = z
      .object({ dry_run: z.enum(['true', 'false']).default('true') })
      .strict()
      .parse(req.query);
    z.object({ dry_run: z.enum(['true', 'false']).optional() })
      .strict()
      .parse(req.body ?? {});
    if (!req.file) throw AppError.validation([{ field: 'file', issue: 'CSV file is required.' }]);
    const fromBody = (req.body as { dry_run?: string } | undefined)?.dry_run;
    if (fromBody !== undefined && req.query.dry_run !== undefined && fromBody !== query.dry_run)
      throw AppError.badRequest('Conflicting dry_run values.');
    const dryRun = (fromBody ?? query.dry_run) === 'true';
    sendSuccess(res, await importCsv(req, req.file.buffer, dryRun), { status: dryRun ? 200 : 202 });
  });
  for (const kind of ['generics', 'manufacturers', 'categories'] satisfies MasterKind[])
    router.post(`/${kind}`, async (req, res) => {
      sendSuccess(res, await service.saveMaster(req, kind, req.body));
    });
  return router;
}
