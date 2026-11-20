import { randomUUID } from 'node:crypto';
import { Schema, model } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export type BannerPlacement = 'MAIN_HERO' | 'PRODUCTS_BANNER' | 'BLOG_BANNER' | 'ANNOUNCEMENT';
export type BannerMediaType = 'IMAGE' | 'VIDEO';
export type BannerResourceType = 'CUSTOM' | 'PRODUCT' | 'CATEGORY' | 'MANUFACTURER' | 'GENERIC';

export interface ICmsBanner {
  _id: string;
  placement: BannerPlacement;
  media_type?: BannerMediaType;
  media_key?: string;
  resource_type?: BannerResourceType;
  resource_id?: string;
  show_overlay?: boolean;
  translations: { en: { title: string; body: string }; zhCN?: { title: string; body: string } };
  is_active: boolean;
  sort_order: number;
  starts_at?: Date;
  ends_at?: Date;
  link_path?: string;
  created_at: Date;
  updated_at: Date;
}

export const CmsBannerSchema = new Schema<ICmsBanner>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    placement: {
      type: String,
      required: true,
      enum: ['MAIN_HERO', 'PRODUCTS_BANNER', 'BLOG_BANNER', 'ANNOUNCEMENT'],
      default: 'ANNOUNCEMENT',
    },
    media_type: { type: String, required: false, enum: ['IMAGE', 'VIDEO'] },
    media_key: { type: String, required: false, trim: true, maxlength: 500 },
    resource_type: {
      type: String,
      required: false,
      enum: ['CUSTOM', 'PRODUCT', 'CATEGORY', 'MANUFACTURER', 'GENERIC'],
    },
    resource_id: { type: String, required: false, trim: true, maxlength: 200 },
    show_overlay: { type: Boolean, required: false },
    translations: {
      type: new Schema(
        {
          en: {
            type: new Schema(
              {
                title: { type: String, required: true, trim: true, maxlength: 200 },
                body: { type: String, required: true, trim: true, maxlength: 5000 },
              },
              { _id: false, strict: 'throw' },
            ),
            required: true,
          },
          zhCN: {
            type: new Schema(
              {
                title: { type: String, required: true, trim: true, maxlength: 200 },
                body: { type: String, required: true, trim: true, maxlength: 5000 },
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
    is_active: { type: Boolean, required: true, default: true },
    sort_order: { type: Number, required: true, validate: Number.isSafeInteger, min: 0, default: 0 },
    starts_at: { type: Date, required: false },
    ends_at: { type: Date, required: false },
    link_path: { type: String, required: false, trim: true, maxlength: 500 },
  },
  {
    collection: 'cms_banners',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
CmsBannerSchema.index({ is_active: 1, sort_order: 1 }, {});
installPersistenceGuards(CmsBannerSchema, 'cms_banners');
export const CmsBannerModel = model<ICmsBanner>('CmsBanner', CmsBannerSchema, 'cms_banners');

export interface IUrlRedirect {
  _id: string;
  source_path: string;
  target_path: string;
  http_status_code: 301;
  created_at: Date;
  updated_at: Date;
}

export const UrlRedirectSchema = new Schema<IUrlRedirect>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    source_path: { type: String, required: true, trim: true, maxlength: 500 },
    target_path: { type: String, required: true, trim: true, maxlength: 500 },
    http_status_code: {
      type: Number,
      required: true,
      validate: Number.isSafeInteger,
      min: 301,
      enum: [301],
      default: 301,
    },
  },
  {
    collection: 'url_redirects',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
UrlRedirectSchema.index({ source_path: 1 }, { unique: true });
installPersistenceGuards(UrlRedirectSchema, 'url_redirects');
export const UrlRedirectModel = model<IUrlRedirect>('UrlRedirect', UrlRedirectSchema, 'url_redirects');
