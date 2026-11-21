import { Router } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { sendPaginated, sendSuccess } from '../../shared/utils/response.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { catalogDelete, uuid } from '../catalog/catalog.validator.js';
import {
  bannerBody,
  bannerQuery,
  blogBody,
  blogQuery,
  createCmsService,
  publicBannerQuery,
  publicBlogQuery,
} from './cms.service.js';

export function createCmsRouters(env: AppEnv, revalidate: Revalidate) {
  const service = createCmsService(revalidate, env);
  const publicRouter = Router();
  const adminRouter = Router();
  publicRouter.get('/banners', async (req, res) => {
    const query = publicBannerQuery.parse(req.query);
    sendSuccess(res, await service.active(query.locale, query.placement));
  });
  publicRouter.get('/blogs', async (req, res) => {
    const query = publicBlogQuery.parse(req.query);
    sendSuccess(res, await service.activeBlogs(query.locale, query.category));
  });
  adminRouter.use(adminBoundary(env), adminAuth(env));
  adminRouter.get('/banners', async (req, res) => {
    const query = bannerQuery.parse(req.query);
    const result = await service.list(query);
    sendPaginated(res, result.items, { ...query, totalItems: result.total });
  });
  adminRouter.get('/banners/:id', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await service.detail(uuid.parse(req.params.id)));
  });
  adminRouter.post('/banners', async (req, res) => {
    sendSuccess(res, await service.save(req, bannerBody.parse(req.body)));
  });
  adminRouter.delete('/banners/:id', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const input = catalogDelete.parse(req.body);
    sendSuccess(res, await service.remove(req, uuid.parse(req.params.id), new Date(input.expected_updated_at)));
  });
  adminRouter.get('/blogs', async (req, res) => {
    const query = blogQuery.parse(req.query);
    const result = await service.listBlogs(query);
    sendPaginated(res, result.items, { ...query, totalItems: result.total });
  });
  adminRouter.get('/blogs/:id', async (req, res) => {
    z.object({}).strict().parse(req.query);
    sendSuccess(res, await service.blogDetail(uuid.parse(req.params.id)));
  });
  adminRouter.post('/blogs', async (req, res) => {
    sendSuccess(res, await service.saveBlog(req, blogBody.parse(req.body)));
  });
  adminRouter.delete('/blogs/:id', async (req, res) => {
    z.object({}).strict().parse(req.query);
    const input = catalogDelete.parse(req.body);
    sendSuccess(res, await service.removeBlog(req, uuid.parse(req.params.id), new Date(input.expected_updated_at)));
  });
  return { publicRouter, adminRouter };
}
