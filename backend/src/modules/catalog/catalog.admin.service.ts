import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import type { AppEnv } from '../../config/env.js';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { UrlRedirectModel } from '../cms/cms.schema.js';
import { PlatformSettingModel } from '../settings/settings.schema.js';
import { publicImageBaseUrl, type StorageService } from '../storage/storage.service.js';
import { CategoryModel, GenericModel, ManufacturerModel, ProductModel, type IProduct } from './catalog.schema.js';
import { manufacturerLogoResponse } from './catalog.admin.reads.js';
import { masterModel } from './catalog.dto.js';
import { catalogPath } from './catalog.public.service.js';
import {
  productCreate,
  masterBodies,
  type ProductInput,
  type ProductPatch,
  type MasterKind,
  type Locale,
} from './catalog.validator.js';

type SlugRecord = { translations: { en: { slug: string }; zhCN?: { slug: string } } };

function slugConflict(fields: string[]): AppError {
  return new AppError({
    status: 422,
    code: 'CATALOG_SLUG_CONFLICT',
    message: 'This page slug is already used by an existing record. Edit that record or choose a different slug.',
    details: fields.map((field) => ({ field, issue: 'This page slug is already in use, including inactive records.' })),
  });
}

function duplicateSlugError(error: unknown): AppError | undefined {
  if (!error || typeof error !== 'object' || !('code' in error) ||
      ![11000, 11001].includes(Number(error.code)) || !('keyPattern' in error) ||
      !error.keyPattern || typeof error.keyPattern !== 'object') return;
  const fields = Object.keys(error.keyPattern);
  if (fields.length && fields.every((field) => ['translations.en.slug', 'translations.zhCN.slug'].includes(field)))
    return slugConflict(fields);
}

export async function validateMasterSlugs(kind: MasterKind, next: SlugRecord, id?: string, session?: ClientSession) {
  await reserveSlugs(kind, next, session);
  const duplicates: string[] = [];
  for (const key of ['en', 'zhCN'] as const) {
    const slug = next.translations[key]?.slug;
    if (slug && await masterModel(kind).exists({
      [`translations.${key}.slug`]: slug,
      ...(id ? { _id: { $ne: id } } : {}),
    }).session(session ?? null)) duplicates.push(`translations.${key}.slug`);
  }
  if (duplicates.length) throw slugConflict(duplicates);
}

export async function reserveSlugs(
  kind: 'products' | MasterKind,
  next: SlugRecord,
  session?: ClientSession,
): Promise<void> {
  for (const [locale, key] of [
    ['en', 'en'],
    ['zh-CN', 'zhCN'],
  ] as const) {
    const slug = next.translations[key]?.slug;
    if (
      slug &&
      (await UrlRedirectModel.exists({ source_path: catalogPath(locale, kind, slug) }).session(session ?? null))
    )
      throw AppError.validation([
        { field: `translations.${key}.slug`, issue: 'This historical slug is reserved by a redirect.' },
      ]);
  }
}

export async function recordSlugChanges(
  kind: 'products' | MasterKind,
  previous: SlugRecord,
  next: SlugRecord,
  session: ClientSession,
) {
  for (const [locale, key] of [
    ['en', 'en'],
    ['zh-CN', 'zhCN'],
  ] as const) {
    const oldSlug = previous.translations[key]?.slug;
    const newSlug = next.translations[key]?.slug ?? next.translations.en.slug;
    if (!oldSlug || oldSlug === newSlug) continue;
    const from = catalogPath(locale, kind, oldSlug);
    const to = catalogPath(locale as Locale, kind, newSlug);
    // Reserved historical slugs cannot be reused, and all inbound redirects are
    // flattened in the same transaction to prevent chains as well as cycles.
    if (await UrlRedirectModel.exists({ source_path: to }).session(session))
      throw AppError.conflict('Redirect target is not canonical.');
    await UrlRedirectModel.updateMany({ target_path: from }, { $set: { target_path: to } }, { session });
    await UrlRedirectModel.updateOne(
      { source_path: from },
      { $set: { target_path: to, http_status_code: 301 } },
      { session, upsert: true, runValidators: true },
    );
  }
}

export async function validateProductReferences(input: ProductInput, session?: ClientSession) {
  const options = { session };
  // Touch referenced masters during commit to serialize against concurrent deactivation/name changes.
  const manufacturer = session
    ? await ManufacturerModel.findOneAndUpdate(
        { _id: input.manufacturer_id, is_active: true },
        { $set: { updated_at: new Date() } },
        { ...options, returnDocument: 'after' },
      ).lean()
    : await ManufacturerModel.findOne({ _id: input.manufacturer_id, is_active: true }).lean();
  if (!manufacturer)
    throw AppError.validation([{ field: 'manufacturer_id', issue: 'An active manufacturer is required.' }]);
  const generic = session
    ? await GenericModel.findOneAndUpdate(
        { _id: input.generic_id, is_active: true },
        { $set: { updated_at: new Date() } },
        { ...options, returnDocument: 'after' },
      ).lean()
    : await GenericModel.findOne({ _id: input.generic_id, is_active: true }).lean();
  if (!generic) throw AppError.validation([{ field: 'generic_id', issue: 'An active generic is required.' }]);
  const categories = await CategoryModel.countDocuments({ _id: { $in: input.category_ids }, is_active: true }).session(
    session ?? null,
  );
  if (categories !== input.category_ids.length)
    throw AppError.validation([{ field: 'category_ids', issue: 'Every category must exist and be active.' }]);
  if (session)
    await CategoryModel.updateMany(
      { _id: { $in: input.category_ids }, is_active: true },
      { $set: { updated_at: new Date() } },
      options,
    );
  const packaging = await PlatformSettingModel.findOne({ key: 'packaging_units' })
    .session(session ?? null)
    .lean();
  if (packaging) {
    const units = packaging.value.units;
    if (!Array.isArray(units) || !units.includes(input.packaging_unit))
      throw AppError.validation([{ field: 'packaging_unit', issue: 'Packaging unit is not configured.' }]);
  }
  return {
    manufacturer: manufacturer.translations.en.name,
    generic_name: generic.translations.en.name,
    brand_name: input.translations.en.brand_name,
  };
}

export async function validateProductSlugs(input: ProductInput, id?: string, session?: ClientSession) {
  await reserveSlugs('products', input, session);
  for (const key of ['en', 'zhCN'] as const) {
    const slug = input.translations[key]?.slug;
    if (
      slug &&
      (await ProductModel.exists({ ...(id ? { _id: { $ne: id } } : {}), [`translations.${key}.slug`]: slug }).session(
        session ?? null,
      ))
    )
      throw AppError.validation([{ field: `translations.${key}.slug`, issue: 'Slug is already in use.' }]);
  }
}

export function createAdminCatalogService(
  env: AppEnv,
  revalidate: Revalidate,
  storage: StorageService,
) {
  async function persistProduct(
    req: Request,
    input: ProductInput | ProductPatch,
    id: string | undefined,
    session: ClientSession,
  ) {
    const previous = id ? await ProductModel.findById(id).session(session) : null;
    if (id && (!previous || previous.deleted_at)) throw AppError.notFound();
    const old = previous?.toObject();
    const translations = old
      ? {
          en: { ...old.translations.en, ...input.translations?.en },
          ...(input.translations?.zhCN === null
            ? {}
            : {
                ...(old.translations.zhCN || input.translations?.zhCN
                  ? { zhCN: { ...old.translations.zhCN, ...input.translations?.zhCN } }
                  : {}),
              }),
        }
      : input.translations;
    const parsed = productCreate.parse({
      ...(old ? pickProduct(old) : {}),
      ...input,
      storage_condition: input.storage_condition === null ? undefined : (input.storage_condition ?? old?.storage_condition),
      translations: translations ? Object.fromEntries(Object.entries(translations).map(([lang, fields]) => [lang, fields ? Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null)) : fields])) : translations,
      review_metadata:
        input.review_metadata === null
          ? undefined
          : (input.review_metadata ?? (old ? pickProduct(old).review_metadata : undefined)),
    });
    if (await ProductModel.exists({ sku: parsed.sku, ...(id ? { _id: { $ne: id } } : {}) }).session(session))
      throw AppError.validation([{ field: 'sku', issue: 'This SKU is already in use. Enter or generate a different SKU.' }]);
    await validateProductSlugs(parsed, id, session);
    const labels = await validateProductReferences(parsed, session);
    const doc = previous ?? new ProductModel();
    doc.set({ ...parsed, ...labels, video_key: parsed.video_key ?? undefined, seo_image_key: parsed.seo_image_key ?? undefined });
    for (const lang of ['en', 'zhCN'] as const) {
      for (const [key, value] of Object.entries(input.translations?.[lang] ?? {}))
        if (value === null) doc.set('translations.' + lang + '.' + key, undefined);
    }
    if (input.storage_condition === null) doc.set('storage_condition', undefined);
    if (!parsed.translations.zhCN) doc.set('translations.zhCN', undefined);
    if (!parsed.review_metadata) doc.set('review_metadata', undefined);
    await doc.save({ session });
    if (old?.status === 'PUBLISHED') await recordSlugChanges('products', old, parsed, session);
    await writeAuditLog(
      req,
      {
        actor_type: 'SUPER_ADMIN',
        actor_id: req.admin!.id,
        action: old ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED',
        entity_type: 'products',
        entity_id: doc._id,
        metadata: { fields: Object.keys(input), status: doc.status },
      },
      session,
    );
    return doc.toObject();
  }

  async function saveProduct(req: Request, input: ProductInput | ProductPatch, id?: string) {
    const result = await mongoose.connection.transaction((session) => persistProduct(req, input, id, session));
    revalidate(req.requestId);
    return result;
  }

  async function saveMaster(req: Request, kind: MasterKind, raw: unknown) {
    const parsed = masterBodies[kind].parse(raw);
    const { id, ...fields } = parsed;
    const logo = 'logo_data_url' in fields ? fields.logo_data_url : undefined;
    let logoObjectKey: string | undefined;
    if (logo) {
      const [prefix, encoded, extra] = logo.split(',', 3);
      const buffer = Buffer.from(encoded ?? '', 'base64');
      const type = await fileTypeFromBuffer(buffer).catch(() => undefined);
      if (extra !== undefined || buffer.toString('base64') !== encoded || prefix !== 'data:' + type?.mime + ';base64')
        throw AppError.validation([{ field: 'logo_data_url', issue: 'Choose a valid PNG or WebP image.' }]);
      try {
        logoObjectKey = (await storage.uploadPublicImage(buffer, kind)).object_key;
      } catch (error) {
        if (!(error instanceof AppError) || error.status !== 503) throw error;
        // Upload runs before the database transaction, so this failure rules out a committed master write.
        throw new AppError({
          status: 503,
          code: kind === 'categories' ? 'CATEGORY_IMAGE_UPLOAD_FAILED' : kind === 'generics' ? 'GENERIC_IMAGE_UPLOAD_FAILED' : 'MANUFACTURER_LOGO_UPLOAD_FAILED',
          message: kind === 'categories' ? 'Category was not saved because the picture could not be uploaded.' : kind === 'generics' ? 'Generic was not saved because the picture could not be uploaded.' : 'Manufacturer was not saved because the logo could not be uploaded.',
          cause: error,
        });
      }
    }
    const result = await mongoose.connection.transaction(async (session) => {
      const previous = id
        ? await masterModel(kind).findById(id).select('+logo_data_url +logo_object_key').session(session)
        : null;
      if (id && (!previous || previous.deleted_at)) throw AppError.notFound();
      const old = previous?.toObject();
      await validateMasterSlugs(kind, fields, id, session);
      const doc = previous ?? new (masterModel(kind))();
      doc.set(fields);
      if (logo !== undefined) {
        doc.set('logo_object_key', logoObjectKey);
        if (logo === null || logoObjectKey) doc.set('logo_data_url', undefined);
      }
      if (!fields.translations.zhCN) doc.set('translations.zhCN', undefined);
      await doc.save({ session });
      if (old?.is_active) await recordSlugChanges(kind, old, fields, session);
      if (kind === 'manufacturers' || kind === 'generics') {
        await ProductModel.updateMany(
          { [kind === 'manufacturers' ? 'manufacturer_id' : 'generic_id']: doc._id },
          { $set: { [kind === 'manufacturers' ? 'manufacturer' : 'generic_name']: fields.translations.en.name } },
          { session },
        );
      }
      await writeAuditLog(
        req,
        {
          actor_type: 'SUPER_ADMIN',
          actor_id: req.admin!.id,
          action: 'CATALOG_MASTER_SAVED',
          entity_type: kind,
          entity_id: doc._id,
          metadata: { fields: Object.keys(fields) },
        },
        session,
      );
      const saved = doc.toObject();
      return {
        record: manufacturerLogoResponse(saved, publicImageBaseUrl(env), env.R2_PUBLIC_BASE_URL),
        replacedLogo: logo !== undefined ? old?.logo_object_key : undefined,
      };
    }).catch(async (error: unknown) => {
      const failure = duplicateSlugError(error) ?? error;
      // Only remove the staged object when the application knows the transaction aborted.
      if (logoObjectKey && failure instanceof AppError && failure.status < 500)
        await storage.remove('products', logoObjectKey).catch(() => undefined);
      throw failure;
    });
    if (result.replacedLogo && new RegExp(`^products/(?:local|s3)/${kind}/`).test(result.replacedLogo))
      await storage.remove('products', result.replacedLogo).catch(() => undefined);
    revalidate(req.requestId);
    return result.record;
  }
  async function deleteRecord(req: Request, kind: 'products' | MasterKind, id: string, expectedUpdatedAt: string) {
    const result = await mongoose.connection.transaction(async (session) => {
      const previous = kind === 'products'
        ? await ProductModel.findById(id).session(session)
        : await masterModel(kind).findById(id).session(session);
      if (!previous) throw AppError.notFound();
      if (previous.deleted_at) return { id, deleted: true as const };
      if (previous.updated_at.getTime() !== Date.parse(expectedUpdatedAt))
        throw AppError.conflict('This record has changed. Refresh the list before deleting it.');
      if (kind !== 'products') {
        const referenceField = kind === 'manufacturers' ? 'manufacturer_id' : kind === 'generics' ? 'generic_id' : 'category_ids';
        if (await ProductModel.exists({ [referenceField]: id, deleted_at: { $exists: false } }).session(session))
          throw AppError.validation([{ field: 'id', issue: 'This record is used by a product. Reassign or delete those products first.' }], 'This record is used by a product. Reassign or delete those products first.');
      }
      // Save the referenced master itself so concurrent product writes serialize with deletion.
      previous.set({ deleted_at: new Date(), ...(kind === 'products' ? { status: 'ARCHIVED' } : { is_active: false }) });
      await previous.save({ session });
      await writeAuditLog(req, {
        actor_type: 'SUPER_ADMIN', actor_id: req.admin!.id,
        action: kind === 'products' ? 'PRODUCT_DELETED' : 'CATALOG_MASTER_DELETED',
        entity_type: kind, entity_id: id, metadata: { retained_for_history: true },
      }, session);
      return { id, deleted: true as const };
    });
    revalidate(req.requestId);
    return result;
  }
  return { persistProduct, saveProduct, saveMaster, deleteRecord, uploadVideo: storage.uploadPublicVideo };
}

function pickProduct(record: IProduct): ProductInput {
  return {
    sku: record.sku,
    manufacturer_id: record.manufacturer_id,
    generic_id: record.generic_id,
    category_ids: record.category_ids,
    translations: record.translations,
    strength: record.strength,
    dosage_form: record.dosage_form,
    pack_size: record.pack_size,
    packaging_unit: record.packaging_unit,
    cold_chain_required: record.cold_chain_required,
    storage_condition: record.storage_condition,
    review_metadata: record.review_metadata
      ? { ...record.review_metadata, reviewed_at: record.review_metadata.reviewed_at.toISOString() }
      : undefined,
    image_keys: record.image_keys,
    video_key: record.video_key,
    seo_image_key: record.seo_image_key,
    status: record.status,
  };
}
export type AdminCatalogService = ReturnType<typeof createAdminCatalogService>;
