import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export const MAX_MANUFACTURER_LOGO_LENGTH = 262_144;

export interface IManufacturer {
  _id: string;
  translations: {
    en: { name: string; slug: string; description?: string; seo_title?: string; meta_description?: string };
    zhCN?: { name: string; slug: string; description?: string; seo_title?: string; meta_description?: string };
  };
  country?: string;
  logo_data_url?: string;
  logo_object_key?: string;
  certifications?: Array<string>;
  is_active: boolean;
  deleted_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export const ManufacturerSchema = new Schema<IManufacturer>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    translations: {
      type: new Schema(
        {
          en: {
            type: new Schema(
              {
                name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: true,
          },
          zhCN: {
            type: new Schema(
              {
                name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: false,
          },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    country: { type: String, trim: true, maxlength: 2, match: /^[A-Z]{2}$/ },
    logo_data_url: { type: String, maxlength: MAX_MANUFACTURER_LOGO_LENGTH, select: false },
    logo_object_key: { type: String, maxlength: 500, select: false },
    certifications: {
      type: [{ type: String, required: true, trim: true, maxlength: 200 }],
      required: false,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 0 && v.length <= 100,
        message: 'Array length outside contract bounds',
      },
    },
    deleted_at: { type: Date },
    is_active: { type: Boolean, required: true, default: true },
  },
  {
    collection: 'manufacturers',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
ManufacturerSchema.index(
  { 'translations.en.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.en.slug': { $type: 'string' } } },
);
ManufacturerSchema.index(
  { 'translations.zhCN.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.zhCN.slug': { $type: 'string' } } },
);
ManufacturerSchema.index({ is_active: 1 }, {});
installPersistenceGuards(ManufacturerSchema, 'manufacturers');
export const ManufacturerModel = model<IManufacturer>('Manufacturer', ManufacturerSchema, 'manufacturers');

export interface IGeneric {
  _id: string;
  logo_data_url?: string;
  logo_object_key?: string;
  translations: {
    en: { name: string; slug: string; description?: string; seo_title?: string; meta_description?: string };
    zhCN?: { name: string; slug: string; description?: string; seo_title?: string; meta_description?: string };
  };
  therapeutic_indications?: Array<string>;
  is_active: boolean;
  deleted_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export const GenericSchema = new Schema<IGeneric>(
  {
    logo_data_url: { type: String, maxlength: MAX_MANUFACTURER_LOGO_LENGTH, select: false },
    logo_object_key: { type: String, maxlength: 500, select: false, match: /^products\/(?:local|s3)\/generics\/[a-zA-Z0-9_-]+\.(?:png|webp)$/ },
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    translations: {
      type: new Schema(
        {
          en: {
            type: new Schema(
              {
                name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: true,
          },
          zhCN: {
            type: new Schema(
              {
                name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: false,
          },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    therapeutic_indications: {
      type: [{ type: String, required: true, trim: true, maxlength: 5000 }],
      required: false,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 0 && v.length <= 100,
        message: 'Array length outside contract bounds',
      },
    },
    deleted_at: { type: Date },
    is_active: { type: Boolean, required: true, default: true },
  },
  {
    collection: 'generics',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
GenericSchema.index(
  { 'translations.en.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.en.slug': { $type: 'string' } } },
);
GenericSchema.index(
  { 'translations.zhCN.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.zhCN.slug': { $type: 'string' } } },
);
GenericSchema.index({ is_active: 1 }, {});
installPersistenceGuards(GenericSchema, 'generics');
export const GenericModel = model<IGeneric>('Generic', GenericSchema, 'generics');

export interface ICategory {
  _id: string;
  logo_data_url?: string;
  logo_object_key?: string;
  translations: {
    en: { name: string; slug: string; description?: string; seo_title?: string; meta_description?: string };
    zhCN?: { name: string; slug: string; description?: string; seo_title?: string; meta_description?: string };
  };
  sort_order: number;
  is_active: boolean;
  deleted_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export const CategorySchema = new Schema<ICategory>(
  {
    logo_data_url: { type: String, maxlength: MAX_MANUFACTURER_LOGO_LENGTH, select: false },
    logo_object_key: { type: String, maxlength: 500, select: false, match: /^products\/(?:local|s3)\/categories\/[a-zA-Z0-9_-]+\.(?:png|webp)$/ },
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    translations: {
      type: new Schema(
        {
          en: {
            type: new Schema(
              {
                name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: true,
          },
          zhCN: {
            type: new Schema(
              {
                name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: false,
          },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    sort_order: { type: Number, required: true, validate: Number.isSafeInteger, min: 0, default: 0 },
    deleted_at: { type: Date },
    is_active: { type: Boolean, required: true, default: true },
  },
  {
    collection: 'categories',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
CategorySchema.index(
  { 'translations.en.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.en.slug': { $type: 'string' } } },
);
CategorySchema.index(
  { 'translations.zhCN.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.zhCN.slug': { $type: 'string' } } },
);
CategorySchema.index({ is_active: 1 }, {});
installPersistenceGuards(CategorySchema, 'categories');
export const CategoryModel = model<ICategory>('Category', CategorySchema, 'categories');

export interface IProduct {
  review_metadata?: { kind: 'TECHNICAL' | 'MEDICAL'; reviewed_at: Date; reviewer_name: string };
  _id: string;
  sku: string;
  manufacturer_id: string;
  generic_id: string;
  category_ids: Array<string>;
  translations: {
    en: {
      brand_name: string;
      slug: string;
      description?: string;
      seo_title?: string;
      meta_description?: string;
      indication_summary?: string;
      usage_notes?: string;
      storage_condition?: string;
      image_alt_text?: string;
    };
    zhCN?: {
      brand_name: string;
      slug: string;
      description?: string;
      seo_title?: string;
      meta_description?: string;
      indication_summary?: string;
      usage_notes?: string;
      storage_condition?: string;
      image_alt_text?: string;
    };
  };
  strength: string;
  dosage_form: string;
  pack_size: string;
  packaging_unit: string;
  cold_chain_required: boolean;
  storage_condition?: string;
  image_keys?: Array<string>;
  video_key?: string;
  seo_image_key?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  brand_name?: string;
  generic_name?: string;
  manufacturer?: string;
  deleted_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export const ProductSchema = new Schema<IProduct>(
  {
    review_metadata: {
      type: new Schema(
        {
          kind: { type: String, required: true, enum: ['TECHNICAL', 'MEDICAL'] },
          reviewed_at: { type: Date, required: true },
          reviewer_name: { type: String, required: true, maxlength: 200 },
        },
        { _id: false, strict: 'throw' },
      ),
      required: false,
    },
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    sku: { type: String, required: true, trim: true, maxlength: 200, uppercase: true },
    manufacturer_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    generic_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    category_ids: {
      type: [
        {
          type: String,
          required: true,
          trim: true,
          maxlength: 200,
          match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
        },
      ],
      required: true,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 1 && v.length <= 100,
        message: 'Array length outside contract bounds',
      },
    },
    translations: {
      type: new Schema(
        {
          en: {
            type: new Schema(
              {
                brand_name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
                indication_summary: { type: String, required: false, trim: true, maxlength: 2000 },
                usage_notes: { type: String, required: false, trim: true, maxlength: 2000 },
                storage_condition: { type: String, required: false, trim: true, maxlength: 500 },
                image_alt_text: { type: String, required: false, trim: true, maxlength: 200 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: true,
          },
          zhCN: {
            type: new Schema(
              {
                brand_name: { type: String, required: true, trim: true, maxlength: 200 },
                slug: { type: String, required: true, trim: true, maxlength: 200, lowercase: true },
                description: { type: String, required: false, trim: true, maxlength: 5000 },
                seo_title: { type: String, required: false, trim: true, maxlength: 200 },
                meta_description: { type: String, required: false, trim: true, maxlength: 500 },
                indication_summary: { type: String, required: false, trim: true, maxlength: 2000 },
                usage_notes: { type: String, required: false, trim: true, maxlength: 2000 },
                storage_condition: { type: String, required: false, trim: true, maxlength: 500 },
                image_alt_text: { type: String, required: false, trim: true, maxlength: 200 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: false,
          },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    strength: { type: String, required: true, trim: true, maxlength: 100 },
    dosage_form: { type: String, required: true, trim: true, maxlength: 100 },
    pack_size: { type: String, required: true, trim: true, maxlength: 100 },
    packaging_unit: { type: String, required: true, trim: true, maxlength: 40 },
    cold_chain_required: { type: Boolean, required: true, default: false },
    storage_condition: { type: String, required: false, trim: true, maxlength: 200 },
    video_key: { type: String, maxlength: 500, match: /^products\/(?:local|s3)\/videos\/[a-zA-Z0-9_-]+\.(?:mp4|webm)$/ },
    seo_image_key: { type: String, maxlength: 500 },
    image_keys: {
      type: [{ type: String, required: true, trim: true, maxlength: 500 }],
      required: false,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 0 && v.length <= 20,
        message: 'Array length outside contract bounds',
      },
    },
    deleted_at: { type: Date },
    status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
      default: 'DRAFT',
    },
    brand_name: { type: String, required: false, trim: true, maxlength: 200 },
    generic_name: { type: String, required: false, trim: true, maxlength: 200 },
    manufacturer: { type: String, required: false, trim: true, maxlength: 200 },
  },
  {
    collection: 'products',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
ProductSchema.index({ sku: 1 }, { unique: true });
ProductSchema.index(
  { 'translations.en.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.en.slug': { $type: 'string' } } },
);
ProductSchema.index(
  { 'translations.zhCN.slug': 1 },
  { unique: true, partialFilterExpression: { 'translations.zhCN.slug': { $type: 'string' } } },
);
ProductSchema.index({ status: 1, manufacturer_id: 1 }, {});
ProductSchema.index({ status: 1, generic_id: 1 }, {});
ProductSchema.index({ status: 1, category_ids: 1 }, {});
installPersistenceGuards(ProductSchema, 'products');
export const ProductModel = model<IProduct>('Product', ProductSchema, 'products');
