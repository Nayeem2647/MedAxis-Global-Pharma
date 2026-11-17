import mongoose from 'mongoose';
import { z } from 'zod';
import type { Request } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { cleanHtml, isSafeInternalPath } from '../../shared/utils/content.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { localeKey, uuid, type Locale } from '../catalog/catalog.validator.js';
import { CmsBannerModel } from './cms.schema.js';
import { adminPage } from '../catalog/catalog.admin.reads.js';
export const bannerQuery = z
  .object({
    ...adminPage,
    q: z.string().trim().min(1).max(100).optional(),
    is_active: z.enum(['true', 'false']).optional(),
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
  .refine((data) => !data.starts_at || !data.ends_at || data.starts_at < data.ends_at, 'Banner end must follow start.');

export function createCmsService(revalidate: Revalidate) {
  const projection = {
    translations: 1,
    is_active: 1,
    sort_order: 1,
    starts_at: 1,
    ends_at: 1,
    link_path: 1,
    created_at: 1,
    updated_at: 1,
  };
  async function list(query: z.infer<typeof bannerQuery>) {
    const filter: Record<string, unknown> = {};
    if (query.is_active !== undefined) filter.is_active = query.is_active === 'true';
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
    return { items, total };
  }
  async function detail(id: string) {
    const row = await CmsBannerModel.findById(id).select(projection).lean();
    if (!row) throw AppError.notFound();
    return row;
  }
  async function active(locale: Locale) {
    const now = new Date();
    const rows = await CmsBannerModel.find({
      is_active: true,
      $and: [
        { $or: [{ starts_at: { $exists: false } }, { starts_at: { $lte: now } }] },
        { $or: [{ ends_at: { $exists: false } }, { ends_at: { $gt: now } }] },
      ],
    })
      .select({
        _id: 1,
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
      return {
        id: row._id,
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
      for (const optional of ['starts_at', 'ends_at', 'link_path'] as const)
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
    return record;
  }
  return { active, save, list, detail };
}
