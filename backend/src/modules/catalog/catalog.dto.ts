import type { Model } from 'mongoose';
import { cleanHtml } from '../../shared/utils/content.js';
import { productImageUrl } from '../storage/storage.service.js';
import {
  ManufacturerModel,
  GenericModel,
  CategoryModel,
  type IGeneric,
  type IManufacturer,
  type IProduct,
} from './catalog.schema.js';
import { localeKey, type Locale, type MasterKind } from './catalog.validator.js';

export type MasterRecord = IGeneric & { country?: string; certifications?: string[]; sort_order?: number };
// All three schemas share these profile fields; kind-specific fields remain optional in this adapter.
export const masterModel = (kind: MasterKind) =>
  ({ manufacturers: ManufacturerModel, generics: GenericModel, categories: CategoryModel })[
    kind
  ] as unknown as Model<MasterRecord>;

const translationKeys = [
  'brand_name',
  'slug',
  'description',
  'seo_title',
  'meta_description',
  'indication_summary',
  'usage_notes',
  'storage_condition',
  'image_alt_text',
] as const;
const masterKeys = ['name', 'slug', 'description', 'seo_title', 'meta_description'] as const;
const localeProjection = (keys: readonly string[]) =>
  Object.fromEntries(['en', 'zhCN'].flatMap((locale) => keys.map((key) => [`translations.${locale}.${key}`, 1])));
export const PUBLIC_MASTER_PROJECTION = {
  _id: 1,
  ...localeProjection(masterKeys),
  country: 1,
  certifications: 1,
  therapeutic_indications: 1,
  sort_order: 1,
};
export const PUBLIC_PRODUCT_PROJECTION = {
  _id: 1,
  sku: 1,
  manufacturer_id: 1,
  generic_id: 1,
  category_ids: 1,
  ...localeProjection(translationKeys),
  strength: 1,
  dosage_form: 1,
  pack_size: 1,
  packaging_unit: 1,
  cold_chain_required: 1,
  storage_condition: 1,
  image_keys: 1,
  updated_at: 1,
};
export interface PublicProductTranslation {
  brand_name: string;
  slug: string;
  description?: string;
  seo_title?: string;
  meta_description?: string;
  indication_summary?: string;
  usage_notes?: string;
  storage_condition?: string;
  image_alt_text?: string;
}
export interface PublicMaster {
  id: string;
  name: string;
  slug: string;
  description?: string;
  seo_title?: string;
  meta_description?: string;
  alternate_slugs: { en: string; zhCN: string | null };
  country?: string;
  certifications?: string[];
  therapeutic_indications?: string[];
}
export interface JoinedProduct extends IProduct {
  manufacturer_profile: MasterRecord;
  generic_profile: MasterRecord;
  category_profiles: MasterRecord[];
}
export interface PublicProduct extends PublicProductTranslation {
  id: string;
  sku: string;
  locale: Locale;
  alternate_slugs: { en: string; zhCN: string | null };
  translations: { en: PublicProductTranslation; zhCN?: PublicProductTranslation };
  generic: PublicMaster;
  manufacturer: PublicMaster;
  categories: PublicMaster[];
  strength: string;
  dosage_form: string;
  pack_size: string;
  packaging_unit: string;
  cold_chain_required: boolean;
  primary_image_url: string | null;
  image_urls: string[];
}
export const alternateSlugs = (record: { translations: { en: { slug: string }; zhCN?: { slug: string } } }) => ({
  en: record.translations.en.slug,
  zhCN: record.translations.zhCN?.slug ?? null,
});

export function publicMaster(record: MasterRecord, locale: Locale): PublicMaster {
  const translation = record.translations[localeKey(locale)] ?? record.translations.en;
  return {
    id: record._id,
    name: translation.name,
    slug: translation.slug,
    description: translation.description === undefined ? undefined : cleanHtml(translation.description),
    seo_title: translation.seo_title,
    meta_description: translation.meta_description,
    alternate_slugs: alternateSlugs(record),
    country: record.country,
    certifications: record.certifications?.map(String),
    therapeutic_indications: record.therapeutic_indications?.map(String),
  };
}
function publicTranslation(value: IProduct['translations']['en']): PublicProductTranslation {
  return {
    brand_name: value.brand_name,
    slug: value.slug,
    description: value.description === undefined ? undefined : cleanHtml(value.description),
    seo_title: value.seo_title,
    meta_description: value.meta_description,
    indication_summary: value.indication_summary === undefined ? undefined : cleanHtml(value.indication_summary),
    usage_notes: value.usage_notes === undefined ? undefined : cleanHtml(value.usage_notes),
    storage_condition: value.storage_condition,
    image_alt_text: value.image_alt_text,
  };
}
export function publicProduct(record: JoinedProduct, locale: Locale, imageBase?: string): PublicProduct {
  const translation = publicTranslation(record.translations[localeKey(locale)] ?? record.translations.en);
  const images = (record.image_keys ?? [])
    .map((key) => productImageUrl(imageBase, key))
    .filter((url): url is string => url !== null);
  return {
    id: record._id,
    sku: record.sku,
    ...translation,
    locale: locale === 'zh-CN' && record.translations.zhCN ? 'zh-CN' : 'en',
    alternate_slugs: alternateSlugs(record),
    translations: {
      en: publicTranslation(record.translations.en),
      ...(record.translations.zhCN ? { zhCN: publicTranslation(record.translations.zhCN) } : {}),
    },
    generic: publicMaster(record.generic_profile, locale),
    manufacturer: publicMaster(record.manufacturer_profile, locale),
    categories: record.category_profiles.map((category) => publicMaster(category, locale)),
    strength: record.strength,
    dosage_form: record.dosage_form,
    pack_size: record.pack_size,
    packaging_unit: record.packaging_unit,
    cold_chain_required: record.cold_chain_required,
    storage_condition: translation.storage_condition ?? record.storage_condition,
    primary_image_url: images[0] ?? null,
    image_urls: images,
  };
}

export type ManufacturerProfile = Pick<IManufacturer, '_id' | 'translations' | 'country' | 'certifications'>;
