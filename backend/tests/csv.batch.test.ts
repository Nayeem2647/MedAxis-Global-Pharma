import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCsvImportService } from '../src/modules/catalog/catalog.csv.service.js';
import type { AdminCatalogService } from '../src/modules/catalog/catalog.admin.service.js';
import { CategoryModel, GenericModel, ManufacturerModel, ProductModel } from '../src/modules/catalog/catalog.schema.js';

// Exercise real CSV parsing/mapping at batch size; database integrity is covered
// by catalog.integration.ts's actual commit/upsert and whole-batch rollback tests.
vi.mock('../src/modules/catalog/catalog.admin.service.js', async (original) => ({
  ...(await original<typeof import('../src/modules/catalog/catalog.admin.service.js')>()),
  validateProductReferences: vi.fn(async () => undefined),
  validateProductSlugs: vi.fn(async () => undefined),
}));
afterEach(() => vi.restoreAllMocks());
const headers =
  'sku,manufacturer_slug,generic_slug,category_slugs,brand_name_en,slug_en,strength,dosage_form,pack_size,packaging_unit,cold_chain_required,status';
const batch = (size: number) =>
  Buffer.from(
    [
      headers,
      ...Array.from(
        { length: size },
        (_, i) =>
          `CSV-${i},maker,ingredient,oncology,"Medicine ${i}, international",medicine-${i},10 mg,Tablet,10 tablets,BOX,false,DRAFT`,
      ),
    ].join('\n'),
  );
function query<T>(value: T) {
  return {
    select() {
      return this;
    },
    session() {
      return this;
    },
    lean: async () => value,
  };
}

describe('Release 1 CSV batch-size and packaging contracts', () => {
  it('validates 101 quoted CSV rows without writes, then maps every row into one commit transaction', async () => {
    const manufacturerId = randomUUID();
    const genericId = randomUUID();
    const categoryId = randomUUID();
    vi.spyOn(ManufacturerModel, 'findOne').mockImplementation(() => query({ _id: manufacturerId }) as never);
    vi.spyOn(GenericModel, 'findOne').mockImplementation(() => query({ _id: genericId }) as never);
    vi.spyOn(CategoryModel, 'find').mockImplementation(
      () => query([{ _id: categoryId, translations: { en: { slug: 'oncology' } } }]) as never,
    );
    vi.spyOn(ProductModel, 'findOne').mockImplementation(() => query(null) as never);
    const session = {} as ClientSession;
    const transaction = vi
      .spyOn(mongoose.connection, 'transaction')
      .mockImplementation(async <T>(work: (session: ClientSession) => Promise<T>) => work(session));
    const persistProduct = vi.fn(async () => undefined);
    const revalidate = vi.fn();
    const importCsv = createCsvImportService({ persistProduct } as unknown as AdminCatalogService, revalidate);
    const req = { requestId: randomUUID() } as Request;
    const dry = await importCsv(req, batch(101), true);
    expect(dry).toMatchObject({ valid: true, total_rows: 101, valid_rows: 101, committed: 0 });
    expect(dry.rows[100]).toMatchObject({ row: 102, sku: 'CSV-100', valid: true });
    expect(transaction).not.toHaveBeenCalled();
    expect(persistProduct).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();

    const committed = await importCsv(req, batch(101), false);
    expect(committed).toMatchObject({ valid: true, committed: 101 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(persistProduct).toHaveBeenCalledTimes(101);
    expect(persistProduct).toHaveBeenLastCalledWith(
      req,
      expect.objectContaining({
        sku: 'CSV-100',
        manufacturer_id: manufacturerId,
        generic_id: genericId,
        category_ids: [categoryId],
        translations: {
          en: expect.objectContaining({ brand_name: 'Medicine 100, international', slug: 'medicine-100' }),
        },
        packaging_unit: 'BOX',
      }),
      undefined,
      session,
    );
    expect(revalidate).toHaveBeenCalledExactlyOnceWith(req.requestId);
  });

  it('rejects more than 1000 data rows before master lookup or writes', async () => {
    const lookup = vi.spyOn(ManufacturerModel, 'findOne');
    const importCsv = createCsvImportService({} as AdminCatalogService, vi.fn());
    await expect(importCsv({ requestId: randomUUID() } as Request, batch(1001), true)).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});
