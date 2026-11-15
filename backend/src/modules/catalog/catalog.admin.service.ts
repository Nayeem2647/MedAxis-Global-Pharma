import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { UrlRedirectModel } from '../cms/cms.schema.js';
import { PlatformSettingModel } from '../settings/settings.schema.js';
import { CategoryModel, GenericModel, ManufacturerModel, ProductModel, type IProduct } from './catalog.schema.js';
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

export function createAdminCatalogService(revalidate: Revalidate) {
  async function persistProduct(
    req: Request,
    input: ProductInput | ProductPatch,
    id: string | undefined,
    session: ClientSession,
  ) {
    const previous = id ? await ProductModel.findById(id).session(session) : null;
    if (id && !previous) throw AppError.notFound();
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
    const parsed = productCreate.parse({ ...(old ? pickProduct(old) : {}), ...input, translations });
    await validateProductSlugs(parsed, id, session);
    const labels = await validateProductReferences(parsed, session);
    const doc = previous ?? new ProductModel();
    doc.set({ ...parsed, ...labels });
    if (!parsed.translations.zhCN) doc.set('translations.zhCN', undefined);
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
    const result = await mongoose.connection.transaction(async (session) => {
      const previous = id ? await masterModel(kind).findById(id).session(session) : null;
      if (id && !previous) throw AppError.notFound();
      const old = previous?.toObject();
      await reserveSlugs(kind, fields, session);
      const doc = previous ?? new (masterModel(kind))();
      doc.set(fields);
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
      return doc.toObject();
    });
    revalidate(req.requestId);
    return result;
  }
  return { persistProduct, saveProduct, saveMaster };
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
    image_keys: record.image_keys,
    status: record.status,
  };
}
export type AdminCatalogService = ReturnType<typeof createAdminCatalogService>;
