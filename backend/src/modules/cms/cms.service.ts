import mongoose from 'mongoose';
import { z } from 'zod';
import type { Request } from 'express';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { cleanHtml, isSafeInternalPath } from '../../shared/utils/content.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { localeKey, uuid, type Locale } from '../catalog/catalog.validator.js';
import { adminPage } from '../catalog/catalog.admin.reads.js';
import { productImageUrl, productVideoUrl, publicImageBaseUrl } from '../storage/storage.service.js';
import { CmsBannerModel } from './cms.schema.js';

export const bannerPlacement = z.enum(['MAIN_HERO', 'PRODUCTS_BANNER', 'BLOG_BANNER', 'ANNOUNCEMENT']);
export const bannerMediaType = z.enum(['IMAGE', 'VIDEO']);
export const bannerResourceType = z.enum(['CUSTOM', 'PRODUCT', 'CATEGORY', 'MANUFACTURER', 'GENERIC']);

const IMAGE_KEY_RE = /^products\/(?:local|s3)\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/;
const VIDEO_KEY_RE = /^products\/(?:local|s3)\/videos\/[a-zA-Z0-9_-]+\.(?:mp4|webm)$/;

export const bannerQuery = z
  .object({
    ...adminPage,
    q: z.string().trim().min(1).max(100).optional(),
    is_active: z.enum(['true', 'false']).optional(),
    placement: bannerPlacement.optional(),
  })
  .strict();

export const publicBannerQuery = z
  .object({
    locale: z.enum(['en', 'zh-CN']).default('en'),
    placement: bannerPlacement.optional(),
  })
  .strict();

const publicCopy = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !/[$€¥৳]\s*\d|\b(?:USD|EUR|CNY|BDT|RMB)\s*\d|\d\s*(?:美元|人民币)|\d+(?:\.\d+)?\s*%\s*(?:off|discount|折扣)/iu.test(
          value,
        ),
      'Public prices and discounts are not allowed.',
    );
const translation = z.object({ title: publicCopy(200), body: publicCopy(5000).transform(cleanHtml) }).strict();
export const bannerBody = z
  .object({
    id: uuid.optional(),
    placement: bannerPlacement.default('ANNOUNCEMENT'),
    media_type: bannerMediaType.optional(),
    media_key: z
      .string()
      .max(500)
      .refine((value) => IMAGE_KEY_RE.test(value) || VIDEO_KEY_RE.test(value), 'Invalid banner media key.')
      .optional(),
    resource_type: bannerResourceType.optional(),
    resource_id: uuid.optional(),
    show_overlay: z.boolean().optional(),
    translations: z.object({ en: translation, zhCN: translation.optional() }).strict(),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    starts_at: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    ends_at: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    link_path: z.string().max(500).refine(isSafeInternalPath, 'Link must be a safe relative site path.').optional(),
  })
  .strict()
  .refine((data) => !data.starts_at || !data.ends_at || data.starts_at < data.ends_at, 'Banner end must follow start.')
  .refine(
    (data) => {
      if (!data.media_key && !data.media_type) return true;
      if (!data.media_key || !data.media_type) return false;
      return data.media_type === 'VIDEO' ? VIDEO_KEY_RE.test(data.media_key) : IMAGE_KEY_RE.test(data.media_key);
    },
    'Banner media_type must match uploaded media file.',
  );

type BannerMediaEnv = Pick<AppEnv, 'STORAGE_DRIVER' | 'S3_PUBLIC_BASE_URL' | 'API_ORIGIN' | 'R2_PUBLIC_BASE_URL'>;

function resolveMediaUrl(env: BannerMediaEnv | undefined, mediaType?: string, mediaKey?: string): string | undefined {
  if (!env || !mediaType || !mediaKey) return undefined;
  const baseUrl = publicImageBaseUrl(env);
  if (mediaType === 'VIDEO') return productVideoUrl(baseUrl, mediaKey) ?? undefined;
  return productImageUrl(baseUrl, mediaKey, env.R2_PUBLIC_BASE_URL) ?? undefined;
}

export function createCmsService(revalidate: Revalidate, mediaEnv?: BannerMediaEnv) {
  const projection = {
    placement: 1,
    media_type: 1,
    media_key: 1,
    resource_type: 1,
    resource_id: 1,
    show_overlay: 1,
    translations: 1,
    is_active: 1,
    sort_order: 1,
    starts_at: 1,
    ends_at: 1,
    link_path: 1,
    created_at: 1,
    updated_at: 1,
  };
  function withMediaUrl<T extends { media_type?: string; media_key?: string; placement?: string }>(row: T) {
    const media_url = resolveMediaUrl(mediaEnv, row.media_type, row.media_key);
    return {
      ...row,
      placement: (row.placement ?? 'ANNOUNCEMENT') as z.infer<typeof bannerPlacement>,
      ...(media_url ? { media_url } : {}),
    };
  }
  async function list(query: z.infer<typeof bannerQuery>) {
    const filter: Record<string, unknown> = {};
    if (query.is_active !== undefined) filter.is_active = query.is_active === 'true';
    if (query.placement) {
      filter.placement =
        query.placement === 'ANNOUNCEMENT'
          ? { $in: ['ANNOUNCEMENT', null] }
          : query.placement;
    }
    if (query.q)
      filter.$or = ['translations.en.title', 'translations.zhCN.title'].map((key) => ({
        [key]: new RegExp(query.q!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      }));
    const [items, total] = await Promise.all([
      CmsBannerModel.find(filter)
        .select(projection)
        .sort({ sort_order: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      CmsBannerModel.countDocuments(filter),
    ]);
    return { items: items.map(withMediaUrl), total };
  }
  async function detail(id: string) {
    const row = await CmsBannerModel.findById(id).select(projection).lean();
    if (!row) throw AppError.notFound();
    return withMediaUrl(row);
  }
  async function active(locale: Locale, placement?: z.infer<typeof bannerPlacement>) {
    const now = new Date();
    const filter: Record<string, unknown> = {
      is_active: true,
      $and: [
        { $or: [{ starts_at: { $exists: false } }, { starts_at: { $lte: now } }] },
        { $or: [{ ends_at: { $exists: false } }, { ends_at: { $gt: now } }] },
      ],
    };
    if (placement) {
      filter.placement = placement === 'ANNOUNCEMENT' ? { $in: ['ANNOUNCEMENT', null] } : placement;
    }
    const rows = await CmsBannerModel.find(filter)
      .select({
        _id: 1,
        placement: 1,
        media_type: 1,
        media_key: 1,
        show_overlay: 1,
        'translations.en.title': 1,
        'translations.en.body': 1,
        'translations.zhCN.title': 1,
        'translations.zhCN.body': 1,
        sort_order: 1,
        link_path: 1,
      })
      .sort({ sort_order: 1, _id: 1 })
      .lean();
    return rows.map((row) => {
      const content = row.translations[localeKey(locale)] ?? row.translations.en;
      const media_url = resolveMediaUrl(mediaEnv, row.media_type, row.media_key);
      return {
        id: row._id,
        placement: row.placement ?? 'ANNOUNCEMENT',
        ...(row.media_type && media_url ? { media_type: row.media_type, media_url } : {}),
        ...(row.show_overlay !== undefined ? { show_overlay: row.show_overlay } : {}),
        title: content.title,
        body: cleanHtml(content.body),
        sort_order: row.sort_order,
        link_path: row.link_path && isSafeInternalPath(row.link_path) ? row.link_path : undefined,
      };
    });
  }
  async function save(req: Request, body: z.infer<typeof bannerBody>) {
    const { id, ...fields } = body;
    const record = await mongoose.connection.transaction(async (session) => {
      const doc = id ? await CmsBannerModel.findById(id).session(session) : new CmsBannerModel();
      if (!doc) throw AppError.notFound();
      doc.set(fields);
      for (const optional of [
        'starts_at',
        'ends_at',
        'link_path',
        'media_type',
        'media_key',
        'resource_type',
        'resource_id',
        'show_overlay',
      ] as const)
        if (fields[optional] === undefined) doc.set(optional, undefined);
      if (!fields.translations.zhCN) doc.set('translations.zhCN', undefined);
      await doc.save({ session });
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'CMS_BANNER_SAVED',
          entity_type: 'cms_banners',
          entity_id: doc._id,
        },
        session,
      );
      return doc.toObject();
    });
    revalidate(req.requestId);
    return withMediaUrl(record);
  }
  async function remove(req: Request, id: string, expectedUpdatedAt: Date) {
    const deleted = await mongoose.connection.transaction(async (session) => {
      const existing = await CmsBannerModel.findById(id).session(session);
      if (!existing) throw AppError.notFound();
      if (existing.updated_at.getTime() !== expectedUpdatedAt.getTime())
        throw AppError.conflict('Banner changed on the server. Refresh before deleting.');
      const res = await CmsBannerModel.deleteOne({ _id: id, updated_at: expectedUpdatedAt }).session(session);
      if (!res.deletedCount) throw AppError.conflict('Banner changed on the server. Refresh before deleting.');
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'CMS_BANNER_DELETED',
          entity_type: 'cms_banners',
          entity_id: id,
        },
        session,
      );
      return { id, deleted: true as const };
    });
    revalidate(req.requestId);
    return deleted;
  }
  return { active, save, list, detail, remove };
}
