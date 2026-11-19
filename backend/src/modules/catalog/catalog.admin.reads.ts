import { z } from 'zod';
import type { QueryFilter } from 'mongoose';
import { AppError } from '../../shared/errors/AppError.js';
import { productImageUrl } from '../storage/storage.service.js';
import { RfqModel } from '../rfq/rfq.schema.js';
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
  video_key: 1,
  seo_image_key: 1,
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
export function manufacturerLogoResponse<T extends { logo_object_key?: string; logo_data_url?: string }>(
  row: T,
  imageBase: string | undefined,
  legacyImageBase?: string,
) {
  const { logo_object_key, ...fields } = row;
  return {
    ...fields,
    logo_data_url: (logo_object_key && productImageUrl(imageBase, logo_object_key, legacyImageBase)) || fields.logo_data_url,
  };
}

export function createAdminCatalogReads(imageBase?: string, legacyImageBase?: string) {
  async function products(query: z.infer<typeof adminCatalogQuery>) {
    const filter: QueryFilter<IProduct> = { deleted_at: { $exists: false } };
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
    const row = await ProductModel.findOne({ _id: id, deleted_at: { $exists: false } }).select(productAdminProjection).lean();
    if (!row) throw AppError.notFound();
    return row;
  }
  async function masters(
    kind: MasterKind,
    query: z.infer<typeof adminCatalogQuery>,
  ): Promise<{
    items: (IGeneric & {
      country?: string;
      certifications?: string[];
      sort_order?: number;
      logo_url?: string;
      product_count?: number;
      rfq_count?: number;
    })[];
    total: number;
  }> {
    const filter: Record<string, unknown> = { deleted_at: { $exists: false } };
    if (query.is_active !== undefined) filter.is_active = query.is_active === 'true';
    if (query.q)
      filter.$or = [
        'translations.en.name',
        'translations.zhCN.name',
        'translations.en.slug',
        'translations.zhCN.slug',
      ].map((key) => ({ [key]: pattern(query.q!) }));
    const skip = (query.page - 1) * query.limit;
    if (kind === 'manufacturers') {
      const [rawItems, total] = await Promise.all([
        ManufacturerModel.find(filter)
          .select({ ...masterProjection, logo_object_key: 1 })
          .sort({ 'translations.en.name': 1, _id: 1 })
          .skip(skip)
          .limit(query.limit)
          .maxTimeMS(10000)
          .lean()
          .exec(),
        ManufacturerModel.countDocuments(filter).exec(),
      ]);
      const ids = rawItems.map((item) => item._id);
      const productCounts = new Map<string, number>();
      const productToManufacturer = new Map<string, string>();
      const rfqIdsByManufacturer = new Map<string, Set<string>>();
      if (ids.length > 0) {
        const manufacturerProducts = await ProductModel.find({ manufacturer_id: { $in: ids } })
          .select({ _id: 1, manufacturer_id: 1, deleted_at: 1 })
          .maxTimeMS(10000)
          .lean()
          .exec();
        for (const product of manufacturerProducts) {
          if (!product.deleted_at) productCounts.set(product.manufacturer_id, (productCounts.get(product.manufacturer_id) ?? 0) + 1);
          productToManufacturer.set(product._id, product.manufacturer_id);
        }
        if (manufacturerProducts.length > 0) {
          const matchingRfqs = await RfqModel.find({
            'items.product_id': { $in: manufacturerProducts.map((product) => product._id) },
          })
            .select({ 'items.product_id': 1 })
            .maxTimeMS(10000)
            .lean()
            .exec();
          for (const rfq of matchingRfqs) {
            for (const item of rfq.items) {
              const manufacturerId = item.product_id ? productToManufacturer.get(item.product_id) : undefined;
              if (!manufacturerId) continue;
              let set = rfqIdsByManufacturer.get(manufacturerId);
              if (!set) {
                set = new Set<string>();
                rfqIdsByManufacturer.set(manufacturerId, set);
              }
              set.add(rfq._id);
            }
          }
        }
      }
      const items = rawItems.map(({ logo_object_key, ...rest }) => {
        const logoUrl = logo_object_key ? productImageUrl(imageBase, logo_object_key, legacyImageBase) : undefined;
        return {
          ...rest,
          ...(logoUrl ? { logo_url: logoUrl } : {}),
          product_count: productCounts.get(rest._id) ?? 0,
          rfq_count: rfqIdsByManufacturer.get(rest._id)?.size ?? 0,
        };
      });
      return { items, total };
    }
    const rows =
      kind === 'generics'
        ? GenericModel.find(filter)
            .select({ ...masterProjection, logo_object_key: 1 })
            .sort({ 'translations.en.name': 1, _id: 1 })
            .skip(skip)
            .limit(query.limit)
            .maxTimeMS(10000)
            .lean()
            .exec()
        : CategoryModel.find(filter)
            .select({ ...masterProjection, logo_object_key: 1 })
            .sort({ 'translations.en.name': 1, _id: 1 })
            .skip(skip)
            .limit(query.limit)
            .maxTimeMS(10000)
            .lean()
            .exec();
    const count =
      kind === 'generics'
        ? GenericModel.countDocuments(filter).exec()
        : CategoryModel.countDocuments(filter).exec();
    const [items, total] = await Promise.all([rows, count]);
    return {
      items: items.map((item) => {
        const { logo_object_key, ...row } = item;
        return { ...row, ...(logo_object_key ? { logo_url: productImageUrl(imageBase, logo_object_key, legacyImageBase) ?? undefined } : {}) };
      }),
      total,
    };
  }
  async function master(kind: MasterKind, id: string) {
    if (kind === 'manufacturers') {
      const row = await ManufacturerModel.findOne({ _id: id, deleted_at: { $exists: false } })
        .select({ ...masterProjection, logo_data_url: 1, logo_object_key: 1 }).lean();
      if (!row) throw AppError.notFound();
      return manufacturerLogoResponse(row, imageBase, legacyImageBase);
    }
    const row = kind === 'generics'
      ? await GenericModel.findOne({ _id: id, deleted_at: { $exists: false } }).select({ ...masterProjection, logo_data_url: 1, logo_object_key: 1 }).lean()
      : await CategoryModel.findOne({ _id: id, deleted_at: { $exists: false } }).select({ ...masterProjection, logo_data_url: 1, logo_object_key: 1 }).lean();
    if (!row) throw AppError.notFound();
    return manufacturerLogoResponse(row, imageBase, legacyImageBase);
  }
  return { products, product, masters, master };
}
