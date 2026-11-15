import mongoose from 'mongoose';
import { z } from 'zod';
import type { Request } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { cleanHtml, isSafeInternalPath } from '../../shared/utils/content.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { localeKey, uuid, type Locale } from '../catalog/catalog.validator.js';
import { CmsBannerModel } from './cms.schema.js';

const translation = z
  .object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000).transform(cleanHtml) })
  .strict();
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
  return { active, save };
}
