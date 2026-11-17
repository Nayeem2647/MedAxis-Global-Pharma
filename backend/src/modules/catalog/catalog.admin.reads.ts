import { z } from 'zod';
import type { QueryFilter } from 'mongoose';
import { AppError } from '../../shared/errors/AppError.js';
import {
  ProductModel,
  ManufacturerModel,
  GenericModel,
  CategoryModel,
  type IProduct,
  type IGeneric,
} from './catalog.schema.js';
import { uuid, type MasterKind } from './catalog.validator.js';

export const adminPage = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const adminCatalogQuery = z
  .object({
    ...adminPage,
    q: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
    manufacturer_id: uuid.optional(),
    generic_id: uuid.optional(),
    category_id: uuid.optional(),
    is_active: z.enum(['true', 'false']).optional(),
  })
  .strict();
export const productAdminProjection = {
  sku: 1,
  manufacturer_id: 1,
  generic_id: 1,
  category_ids: 1,
  translations: 1,
  strength: 1,
  dosage_form: 1,
  pack_size: 1,
  packaging_unit: 1,
  cold_chain_required: 1,
  storage_condition: 1,
  image_keys: 1,
  status: 1,
  review_metadata: 1,
  created_at: 1,
  updated_at: 1,
} as const;
const masterProjection = {
  translations: 1,
  country: 1,
  certifications: 1,
  therapeutic_indications: 1,
  sort_order: 1,
  is_active: 1,
  created_at: 1,
  updated_at: 1,
} as const;
const pattern = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
export function createAdminCatalogReads() {
  async function products(query: z.infer<typeof adminCatalogQuery>) {
    const filter: QueryFilter<IProduct> = {};
    if (query.status) filter.status = query.status;
    if (query.manufacturer_id) filter.manufacturer_id = query.manufacturer_id;
    if (query.generic_id) filter.generic_id = query.generic_id;
    if (query.category_id) filter.category_ids = query.category_id;
    if (query.q)
      filter.$or = ['sku', 'translations.en.brand_name', 'translations.zhCN.brand_name'].map((key) => ({
        [key]: pattern(query.q!),
      }));
    const [items, total] = await Promise.all([
      ProductModel.find(filter)
        .select(productAdminProjection)
        .sort({ updated_at: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .maxTimeMS(10000)
        .lean(),
      ProductModel.countDocuments(filter).maxTimeMS(10000),
    ]);
    return { items, total };
  }
  async function product(id: string) {
    const row = await ProductModel.findById(id).select(productAdminProjection).lean();
    if (!row) throw AppError.notFound();
    return row;
  }
  async function masters(
    kind: MasterKind,
    query: z.infer<typeof adminCatalogQuery>,
  ): Promise<{
    items: (IGeneric & { country?: string; certifications?: string[]; sort_order?: number })[];
    total: number;
  }> {
    const filter: Record<string, unknown> = {};
    if (query.is_active !== undefined) filter.is_active = query.is_active === 'true';
    if (query.q)
      filter.$or = [
        'translations.en.name',
        'translations.zhCN.name',
        'translations.en.slug',
        'translations.zhCN.slug',
      ].map((key) => ({ [key]: pattern(query.q!) }));
    const skip = (query.page - 1) * query.limit;
    const rows =
      kind === 'manufacturers'
        ? ManufacturerModel.find(filter)
            .select(masterProjection)
            .sort({ 'translations.en.name': 1, _id: 1 })
            .skip(skip)
            .limit(query.limit)
            .maxTimeMS(10000)
            .lean()
            .exec()
        : kind === 'generics'
          ? GenericModel.find(filter)
              .select(masterProjection)
              .sort({ 'translations.en.name': 1, _id: 1 })
              .skip(skip)
              .limit(query.limit)
              .maxTimeMS(10000)
              .lean()
              .exec()
          : CategoryModel.find(filter)
              .select(masterProjection)
              .sort({ 'translations.en.name': 1, _id: 1 })
              .skip(skip)
              .limit(query.limit)
              .maxTimeMS(10000)
              .lean()
              .exec();
    const count =
      kind === 'manufacturers'
        ? ManufacturerModel.countDocuments(filter).exec()
        : kind === 'generics'
          ? GenericModel.countDocuments(filter).exec()
          : CategoryModel.countDocuments(filter).exec();
    const [items, total] = await Promise.all([rows, count]);
    return { items, total };
  }
  async function master(kind: MasterKind, id: string) {
    const row =
      kind === 'manufacturers'
        ? await ManufacturerModel.findById(id).select(masterProjection).lean()
        : kind === 'generics'
          ? await GenericModel.findById(id).select(masterProjection).lean()
          : await CategoryModel.findById(id).select(masterProjection).lean();
    if (!row) throw AppError.notFound();
    return row;
  }
  return { products, product, masters, master };
}
