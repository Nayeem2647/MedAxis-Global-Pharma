import type { PipelineStage } from 'mongoose';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { escapeRegex } from '../../shared/utils/content.js';
import { UrlRedirectModel } from '../cms/cms.schema.js';
import { publicImageBaseUrl } from '../storage/storage.service.js';
import { ProductModel } from './catalog.schema.js';
import {
  PUBLIC_MASTER_PROJECTION,
  PUBLIC_PRODUCT_PROJECTION,
  alternateSlugs,
  masterModel,
  publicMaster,
  publicProduct,
  type JoinedProduct,
  type MasterRecord,
} from './catalog.dto.js';
import { localeKey, type CatalogQuery, type Locale, type MasterKind } from './catalog.validator.js';

export const catalogPath = (locale: Locale, kind: 'products' | MasterKind, slug: string) =>
  `/${locale}/${kind}/${encodeURIComponent(slug)}`;
const localizedSlug = (locale: Locale, slug: string) =>
  locale === 'en'
    ? { 'translations.en.slug': slug }
    : {
        $or: [
          { 'translations.zhCN.slug': slug },
          { 'translations.zhCN': { $exists: false }, 'translations.en.slug': slug },
        ],
      };

function joins(): PipelineStage[] {
  return [
    ...(['manufacturer', 'generic'] as const).flatMap((kind): PipelineStage[] => [
      {
        $lookup: {
          from: kind === 'manufacturer' ? 'manufacturers' : 'generics',
          localField: `${kind}_id`,
          foreignField: '_id',
          pipeline: [{ $match: { is_active: true, deleted_at: { $exists: false } } }, { $project: PUBLIC_MASTER_PROJECTION }],
          as: `${kind}_profile`,
        },
      },
      { $unwind: `$${kind}_profile` },
    ]),
    {
      $lookup: {
        from: 'categories',
        localField: 'category_ids',
        foreignField: '_id',
        pipeline: [
          { $match: { is_active: true, deleted_at: { $exists: false } } },
          { $project: PUBLIC_MASTER_PROJECTION },
          { $sort: { sort_order: 1, _id: 1 } },
        ],
        as: 'category_profiles',
      },
    },
    { $match: { 'category_profiles.0': { $exists: true } } },
  ];
}
function ratingJoins(): PipelineStage.Lookup[] {
  return [{ $lookup: {
    from: 'product_ratings', localField: '_id', foreignField: 'product_id',
    pipeline: [{ $group: { _id: null, average: { $avg: '$score' }, count: { $sum: 1 } } },
      { $project: { _id: 0, average: { $round: ['$average', 1] }, count: 1 } }],
    as: 'customer_ratings',
  } }];
}
export function createPublicCatalogService(env: AppEnv) {
  async function filters(query: CatalogQuery) {
    const match: Record<string, unknown> = { status: 'PUBLISHED', deleted_at: { $exists: false } };
    for (const [parameter, kind, field] of [
      ['manufacturer', 'manufacturers', 'manufacturer_id'],
      ['generic', 'generics', 'generic_id'],
      ['category', 'categories', 'category_ids'],
    ] as const) {
      if (!query[parameter]) continue;
      const record = await masterModel(kind)
        .findOne({ is_active: true, deleted_at: { $exists: false }, ...localizedSlug(query.locale, query[parameter]) })
        .select({ _id: 1 })
        .lean();
      match[field] = record?._id ?? '__no_match__';
    }
    if (query.cold_chain !== undefined) match.cold_chain_required = query.cold_chain;
    if (query.dosage_form) match.dosage_form = query.dosage_form;
    return match;
  }

  async function list(query: CatalogQuery, extra: Record<string, unknown> = {}) {
    const match: Record<string, unknown> = { ...(await filters(query)), ...extra, status: 'PUBLISHED', deleted_at: { $exists: false } };
    const prefix: PipelineStage[] = [];
    if (query.q) {
      if (env.isProduction)
        prefix.push({
          $search: {
            index: 'products_public_catalog',
            compound: {
              filter: [{ equals: { path: 'status', value: 'PUBLISHED' } }],
              must: [
                {
                  text: {
                    query: query.q,
                    path: [
                      'sku',
                      'brand_name',
                      'generic_name',
                      'manufacturer',
                      `translations.${localeKey(query.locale)}.brand_name`,
                      `translations.${localeKey(query.locale)}.indication_summary`,
                      `translations.${localeKey(query.locale)}.description`,
                    ],
                  },
                },
              ],
            },
          },
        });
      else
        match.$or = [
          'sku',
          'brand_name',
          'generic_name',
          'manufacturer',
          `translations.${localeKey(query.locale)}.brand_name`,
          `translations.${localeKey(query.locale)}.description`,
          `translations.${localeKey(query.locale)}.indication_summary`,
        ].map((field) => ({ [field]: { $regex: escapeRegex(query.q!), $options: 'i' } }));
    }
    interface Faceted {
      products: JoinedProduct[];
      total: Array<{ count: number }>;
      dosage: Array<{ _id: string; count: number }>;
      cold: Array<{ _id: boolean; count: number }>;
    }
    const results = await ProductModel.aggregate<Faceted>([
      ...prefix,
      { $match: match },
      { $project: PUBLIC_PRODUCT_PROJECTION },
      ...joins(),
      {
        $facet: {
          products: [{ $sort: { sku: 1, _id: 1 } }, { $skip: (query.page - 1) * query.limit }, { $limit: query.limit }, ...ratingJoins()],
          total: [{ $count: 'count' }],
          dosage: [{ $group: { _id: '$dosage_form', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
          cold: [{ $group: { _id: '$cold_chain_required', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
        },
      },
    ]).option({ maxTimeMS: 10_000 });
    const result = results[0];
    return {
      products: (result?.products ?? []).map((record) =>
        publicProduct(record, query.locale, publicImageBaseUrl(env), env.R2_PUBLIC_BASE_URL)),
      total: result?.total[0]?.count ?? 0,
      facets: {
        dosage_forms: (result?.dosage ?? []).map((facet) => ({ name: facet._id, count: facet.count })),
        cold_chain: (result?.cold ?? []).map((facet) => ({ required: facet._id, count: facet.count })),
      },
    };
  }

  async function redirect(kind: 'products' | MasterKind, slug: string, locale: Locale) {
    const source = catalogPath(locale, kind, slug);
    const record = await UrlRedirectModel.findOne({ source_path: source }).select({ _id: 0, target_path: 1 }).lean();
    if (!record) throw AppError.notFound();
    // Only redirects to a live canonical catalog entity are returned; corrupt chains stay private.
    const parsed = /^\/(en|zh-CN)\/(products|generics|manufacturers|categories)\/([^/]+)$/.exec(record.target_path);
    if (!parsed || parsed[2] !== kind || record.target_path === source) throw AppError.notFound();
    const targetLocale = parsed[1] as Locale;
    let targetSlug: string;
    try {
      targetSlug = decodeURIComponent(parsed[3]!);
    } catch {
      throw AppError.notFound();
    }
    const active =
      kind === 'products'
        ? (
            await ProductModel.aggregate<{ _id: string }>([
              { $match: { status: 'PUBLISHED', deleted_at: { $exists: false }, ...localizedSlug(targetLocale, targetSlug) } },
              { $project: { _id: 1, manufacturer_id: 1, generic_id: 1, category_ids: 1 } },
              ...joins(),
              { $limit: 1 },
              { $project: { _id: 1 } },
            ]).option({ maxTimeMS: 10_000 })
          )[0]
        : await masterModel(kind)
            .findOne({ is_active: true, deleted_at: { $exists: false }, ...localizedSlug(targetLocale, targetSlug) })
            .select({ _id: 1 })
            .lean();
    if (!active) throw AppError.notFound();
    return { redirect: { status: 301 as const, location: record.target_path } };
  }

  async function product(slug: string, locale: Locale) {
    const rows = await ProductModel.aggregate<JoinedProduct>([
      { $match: { status: 'PUBLISHED', deleted_at: { $exists: false }, ...localizedSlug(locale, slug) } },
      { $project: PUBLIC_PRODUCT_PROJECTION },
      ...joins(),
      { $limit: 1 },
      ...ratingJoins(),
    ]);
    return rows[0] ? publicProduct(rows[0], locale, publicImageBaseUrl(env), env.R2_PUBLIC_BASE_URL) : redirect('products', slug, locale);
  }

  async function productById(id: string) {
    const rows = await ProductModel.aggregate<JoinedProduct>([
      { $match: { _id: id, status: 'PUBLISHED', deleted_at: { $exists: false } } },
      { $project: PUBLIC_PRODUCT_PROJECTION }, ...joins(), { $limit: 1 }, ...ratingJoins(),
    ]).option({ maxTimeMS: 10_000 });
    if (!rows[0]) throw AppError.notFound();
    return publicProduct(rows[0], 'en', publicImageBaseUrl(env), env.R2_PUBLIC_BASE_URL);
  }

  async function categories(locale: Locale) {
    const [records, counts] = await Promise.all([
      masterModel('categories')
        .find({ is_active: true, deleted_at: { $exists: false } })
        .select(PUBLIC_MASTER_PROJECTION)
        .sort({ sort_order: 1, _id: 1 })
        .limit(50)
        .lean<MasterRecord[]>(),
      ProductModel.aggregate<{ _id: string; count: number }>([
        { $match: { status: 'PUBLISHED', deleted_at: { $exists: false } } },
        { $unwind: '$category_ids' },
        { $group: { _id: '$category_ids', count: { $sum: 1 } } },
      ]).option({ maxTimeMS: 10_000 }),
    ]);
    const countMap = new Map(counts.map((entry) => [entry._id, entry.count]));
    return {
      categories: records.map((record) => ({
        ...publicMaster(record, locale, publicImageBaseUrl(env), env.R2_PUBLIC_BASE_URL),
        product_count: countMap.get(record._id) ?? 0,
      })),
    };
  }

  async function master(kind: MasterKind, slug: string, query: CatalogQuery) {
    const record = await masterModel(kind)
      .findOne({ is_active: true, deleted_at: { $exists: false }, ...localizedSlug(query.locale, slug) })
      .select(PUBLIC_MASTER_PROJECTION)
      .lean<MasterRecord>();
    if (!record) return redirect(kind, slug, query.locale);
    const field = { manufacturers: 'manufacturer_id', generics: 'generic_id', categories: 'category_ids' }[kind];
    const products = await list(query, { [field]: record._id });
    return {
      ...publicMaster(record, query.locale, publicImageBaseUrl(env), env.R2_PUBLIC_BASE_URL),
      products: products.products,
      facets: products.facets,
      total: products.total,
    };
  }

  async function sitemap() {
    const projection = { _id: 0, 'translations.en.slug': 1, 'translations.zhCN.slug': 1, updated_at: 1 };
    const [products, generics, manufacturers, categories] = await Promise.all([
      ProductModel.aggregate<Pick<JoinedProduct, 'translations' | 'updated_at'>>([
        { $match: { status: 'PUBLISHED', deleted_at: { $exists: false } } },
        { $project: { ...projection, _id: 1, manufacturer_id: 1, generic_id: 1, category_ids: 1 } },
        ...joins(),
        { $sort: { _id: 1 } },
        { $project: projection },
      ]).option({ maxTimeMS: 10_000 }),
      ...(['generics', 'manufacturers', 'categories'] as const).map((kind) =>
        masterModel(kind).find({ is_active: true, deleted_at: { $exists: false } }).select(projection).sort({ _id: 1 }).lean(),
      ),
    ]);
    const pair = (record: { translations: { en: { slug: string }; zhCN?: { slug: string } }; updated_at: Date }) => ({
      ...alternateSlugs(record),
      updated_at: record.updated_at,
    });
    return {
      products: products!.map(pair),
      generics: generics!.map(pair),
      manufacturers: manufacturers!.map(pair),
      categories: categories!.map(pair),
    };
  }
  return { list, product, productById, master, categories, sitemap };
}
