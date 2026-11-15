import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import mongoose from 'mongoose';
import type { Request } from 'express';
import { AppError } from '../../shared/errors/AppError.js';
import type { Revalidate } from '../../shared/utils/revalidate.js';
import { CategoryModel, GenericModel, ManufacturerModel, ProductModel } from './catalog.schema.js';
import { productCreate, slug, type ProductInput } from './catalog.validator.js';
import { validateProductReferences, validateProductSlugs, type AdminCatalogService } from './catalog.admin.service.js';

const optional = z.string().optional();
const csvRow = z
  .object({
    sku: z.string(),
    manufacturer_slug: slug,
    generic_slug: slug,
    category_slugs: z.string().min(1),
    brand_name_en: z.string(),
    slug_en: slug,
    brand_name_zhCN: optional,
    slug_zhCN: optional,
    description_en: optional,
    description_zhCN: optional,
    indication_summary_en: optional,
    indication_summary_zhCN: optional,
    usage_notes_en: optional,
    usage_notes_zhCN: optional,
    seo_title_en: optional,
    seo_title_zhCN: optional,
    meta_description_en: optional,
    meta_description_zhCN: optional,
    strength: z.string(),
    dosage_form: z.string(),
    pack_size: z.string(),
    packaging_unit: z.string(),
    cold_chain_required: z.enum(['true', 'false', '']).optional(),
    storage_condition: optional,
    status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED', '']).optional(),
  })
  .strict();
interface RowReport {
  row: number;
  sku?: string;
  valid: boolean;
  errors: Array<{ field: string; issue: string }>;
}

export function createCsvImportService(admin: AdminCatalogService, revalidate: Revalidate) {
  return async (req: Request, buffer: Buffer, dryRun: boolean) => {
    if (!buffer.length || buffer.length > 5_242_880)
      throw AppError.badRequest('CSV must be nonempty and no larger than 5 MiB.');
    let records: Array<{ record: Record<string, string>; info: { lines: number } }>;
    try {
      records = parse(buffer, {
        bom: true,
        columns: (headers: string[]) => {
          const normalized = headers.map((header) => header.trim());
          if (new Set(normalized).size !== normalized.length) throw new Error();
          return normalized;
        },
        trim: true,
        skip_empty_lines: true,
        info: true,
        max_record_size: 65_536,
        to: 1001,
      }) as typeof records;
    } catch {
      throw AppError.validation([
        { field: 'file', issue: 'Malformed CSV, duplicate headers, or inconsistent columns.' },
      ]);
    }
    if (!records.length || records.length > 1000)
      throw AppError.validation([{ field: 'file', issue: 'CSV must contain 1–1000 data rows.' }]);
    const report: RowReport[] = [];
    const candidates: Array<{ data: ProductInput; id?: string }> = [];
    const skus = new Set<string>();
    const slugs = new Set<string>();
    for (const { record, info } of records) {
      try {
        const row = csvRow.parse(record);
        const [manufacturer, generic, categories] = await Promise.all([
          ManufacturerModel.findOne({ 'translations.en.slug': row.manufacturer_slug, is_active: true })
            .select({ _id: 1 })
            .lean(),
          GenericModel.findOne({ 'translations.en.slug': row.generic_slug, is_active: true }).select({ _id: 1 }).lean(),
          CategoryModel.find({
            'translations.en.slug': { $in: row.category_slugs.split('|').map((s) => s.trim()) },
            is_active: true,
          })
            .select({ _id: 1, 'translations.en.slug': 1 })
            .lean(),
        ]);
        const categorySlugs = row.category_slugs.split('|').map((s) => slug.parse(s));
        if (!manufacturer)
          throw AppError.validation([{ field: 'manufacturer_slug', issue: 'Active manufacturer not found.' }]);
        if (!generic) throw AppError.validation([{ field: 'generic_slug', issue: 'Active generic not found.' }]);
        if (new Set(categorySlugs).size !== categorySlugs.length || categories.length !== categorySlugs.length)
          throw AppError.validation([{ field: 'category_slugs', issue: 'Categories must be unique and active.' }]);
        const translated = (key: 'en' | 'zhCN') => ({
          brand_name: row[`brand_name_${key}`],
          slug: row[`slug_${key}`],
          description: row[`description_${key}`] || undefined,
          indication_summary: row[`indication_summary_${key}`] || undefined,
          usage_notes: row[`usage_notes_${key}`] || undefined,
          seo_title: row[`seo_title_${key}`] || undefined,
          meta_description: row[`meta_description_${key}`] || undefined,
        });
        const data = productCreate.parse({
          sku: row.sku,
          manufacturer_id: manufacturer._id,
          generic_id: generic._id,
          category_ids: categorySlugs.map(
            (category) => categories.find((entry) => entry.translations.en.slug === category)!._id,
          ),
          translations: {
            en: translated('en'),
            ...(row.brand_name_zhCN || row.slug_zhCN ? { zhCN: translated('zhCN') } : {}),
          },
          strength: row.strength,
          dosage_form: row.dosage_form,
          pack_size: row.pack_size,
          packaging_unit: row.packaging_unit,
          cold_chain_required: row.cold_chain_required === 'true',
          storage_condition: row.storage_condition || undefined,
          status: row.status || 'DRAFT',
        });
        if (skus.has(data.sku)) throw AppError.validation([{ field: 'sku', issue: 'Duplicate SKU in CSV.' }]);
        const duplicate = (['en', 'zhCN'] as const).find(
          (locale) => data.translations[locale] && slugs.has(`${locale}:${data.translations[locale]!.slug}`),
        );
        if (duplicate)
          throw AppError.validation([{ field: `slug_${duplicate}`, issue: 'Duplicate localized slug in CSV.' }]);
        const previous = await ProductModel.findOne({ sku: data.sku }).select({ _id: 1 }).lean();
        await validateProductReferences(data);
        await validateProductSlugs(data, previous?._id);
        skus.add(data.sku);
        for (const locale of ['en', 'zhCN'] as const)
          if (data.translations[locale]) slugs.add(`${locale}:${data.translations[locale]!.slug}`);
        candidates.push({ data, id: previous?._id });
        report.push({ row: info.lines, sku: data.sku, valid: true, errors: [] });
      } catch (error) {
        if (!(error instanceof z.ZodError) && !(error instanceof AppError && error.status === 422)) throw error;
        const errors =
          error instanceof z.ZodError
            ? error.issues.map((issue) => ({ field: issue.path.join('.'), issue: issue.message }))
            : (error.details ?? []);
        report.push({ row: info.lines, sku: record.sku, valid: false, errors });
      }
    }
    const valid = report.every((row) => row.valid);
    if (!dryRun && !valid)
      throw AppError.validation(
        report.flatMap((row) =>
          row.errors.map((error) => ({ field: `rows[${row.row}].${error.field}`, issue: error.issue })),
        ),
      );
    if (!dryRun) {
      await mongoose.connection.transaction(async (session) => {
        for (const candidate of candidates) {
          // Re-resolve SKU inside the transaction; a concurrent import cannot create duplicates.
          const current = await ProductModel.findOne({ sku: candidate.data.sku })
            .select({ _id: 1 })
            .session(session)
            .lean();
          await admin.persistProduct(req, candidate.data, current?._id, session);
        }
      });
      revalidate(req.requestId);
    }
    return {
      dry_run: dryRun,
      valid,
      total_rows: report.length,
      valid_rows: candidates.length,
      committed: dryRun ? 0 : candidates.length,
      rows: report,
    };
  };
}
