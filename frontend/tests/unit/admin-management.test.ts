import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminProxyRule } from '../../lib/admin-contract';
import {
  adminMultipart,
  auditRecord,
  bannerBody,
  csvColumns,
  csvReport,
  fxBody,
  imageReceipt,
  productBody,
  productRecord,
  resourceQuery,
  reviewSchema,
  settingsBody,
  updateDraftBody,
  validatedInput,
  validateCatalogImage,
} from '../../lib/admin-management';
import { ApiError } from '../../lib/api-client';
import { workflowIds as ids, workflowSettings } from '../admin-fixtures';
import { meta } from '../fixtures';
const product = {
  sku: 'TEST',
  manufacturer_id: ids.manufacturer,
  generic_id: ids.rfq,
  category_ids: [ids.quote],
  translations: {
    en: { brand_name: 'Actual medicine', slug: 'actual-medicine' },
    zhCN: { brand_name: '药品', slug: '药品' },
  },
  strength: '80 mg',
  dosage_form: 'Tablet',
  pack_size: '30 tablets',
  packaging_unit: 'BOX',
  cold_chain_required: false,
  image_keys: [],
  status: 'DRAFT',
};
beforeEach(() => vi.restoreAllMocks());
describe('registered management boundaries', () => {
  it.each([
    'catalog/products',
    'catalog/manufacturers',
    'catalog/generics',
    'catalog/categories',
    'cms/banners',
    'quotations',
    'quotations/summary',
  ])('allows implemented authenticated read %s only', (path) => {
    expect(adminProxyRule(path, 'GET')).not.toBeNull();
    expect(adminProxyRule(path, 'DELETE')).toBeNull();
  });
  it('preserves zhCN wire keys and normalizes IDs only after validating the record', () => {
    expect(productBody.parse(product).translations.zhCN?.slug).toBe('药品');
    expect(
      productBody.safeParse({
        ...product,
        translations: {
          en: product.translations.en,
          'zh-CN': product.translations.zhCN,
        },
      }).success,
    ).toBe(false);
    const row = productRecord.parse({
      ...product,
      _id: ids.rfq,
      created_at: meta.timestamp,
      updated_at: meta.timestamp,
      procurement_cost: 'NEVER_RENDER',
    });
    expect(row.id).toBe(ids.rfq);
    expect(row).not.toHaveProperty('procurement_cost');
    expect(productBody.safeParse({ ...product, prescription_required: true }).success).toBe(false);
  });
  it('rejects arbitrary read keys, invalid limits and invented review dates', () => {
    expect(resourceQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(resourceQuery.safeParse({ price: '1' }).success).toBe(false);
    expect(
      reviewSchema.safeParse({
        kind: 'MEDICAL',
        reviewed_at: '2099-01-01T00:00:00Z',
        reviewer_name: 'Person',
      }).success,
    ).toBe(false);
    expect(productBody.parse({ ...product, review_metadata: null }).review_metadata).toBeNull();
  });
  it.each(['/admin', '/q/secret', 'https://evil.test', '//evil.test/en', '/en/../admin', '/en/products?token=secret'])(
    'rejects unsafe CMS target %s',
    (link_path) =>
      expect(
        bannerBody.safeParse({
          translations: {
            en: { title: 'Update', body: 'Sourcing enquiries welcome.' },
          },
          is_active: true,
          sort_order: 0,
          link_path,
        }).success,
      ).toBe(false),
  );
  it.each(['USD 99', '25% off', '¥ 100'])('rejects public retail copy %s', (body) =>
    expect(
      bannerBody.safeParse({
        translations: { en: { title: 'Update', body } },
        is_active: true,
        sort_order: 0,
      }).success,
    ).toBe(false),
  );
  it('accepts HTTP 200 valid:false and 202 committed receipts without inventing a job', async () => {
    const data = {
      dry_run: true,
      valid: false,
      total_rows: 1,
      valid_rows: 0,
      committed: 0,
      rows: [{ row: 2, valid: false, errors: [{ field: 'sku', issue: 'Missing' }] }],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data, meta }));
    vi.stubGlobal('fetch', fetcher);
    expect((await adminMultipart('/api/admin/catalog/import-csv?dry_run=true', new FormData(), csvReport)).valid).toBe(
      false,
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'include',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Content-Type')).toBe(false);
    expect(csvColumns).toContain('slug_zhCN');
    expect(csvColumns).not.toContain('price');
  });
  it('validates image receipts and signatures without allowing arbitrary asset origins', async () => {
    const receipt = {
      r2_object_key: 'products/actual.png',
      url: 'https://cdn.medaxisglobalpharma.com/products/actual.png',
      mime_type: 'image/png',
      file_size_bytes: 8,
    };
    expect(imageReceipt.safeParse(receipt).success).toBe(true);
    expect(imageReceipt.safeParse({ ...receipt, url: 'https://evil.test/file.png' }).success).toBe(false);
    await expect(validateCatalogImage(new File(['<html>'], 'spoof.png', { type: 'image/png' }))).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(
      validateCatalogImage(
        new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'valid.png', { type: 'image/png' }),
      ),
    ).resolves.toBeUndefined();
  });
  it('retains fixed policy bounds, exact FX decimals and optimistic draft edit requirements', () => {
    expect(
      settingsBody.safeParse({
        payment_presets: workflowSettings.payment_presets.value,
      }).success,
    ).toBe(true);
    expect(
      settingsBody.safeParse({
        payment_presets: {
          ...workflowSettings.payment_presets.value,
          reservation_days: 10,
        },
      }).success,
    ).toBe(false);
    expect(
      fxBody.parse({
        rates: [
          {
            currency: 'USD',
            active_mode: 'MANUAL_FIXED',
            manual_rate_to_bdt: '122.1234567891234567',
          },
        ],
      }).rates[0].manual_rate_to_bdt,
    ).toBe('122.1234567891234567');
    expect(
      fxBody.safeParse({
        rates: [
          {
            currency: 'USD',
            active_mode: 'MANUAL_FIXED',
            manual_rate_to_bdt: '0.09',
          },
        ],
      }).success,
    ).toBe(false);
    expect(updateDraftBody.safeParse({ expected_current_version_id: ids.quote }).success).toBe(false);
  });
  it('redacts unregistered audit metadata and returns field validation without an uncertain write', () => {
    const row = auditRecord.parse({
      id: ids.rfq,
      actor_type: 'SYSTEM',
      action: 'PRODUCT_SAVED',
      entity_type: 'products',
      entity_id: ids.rfq,
      request_id: meta.request_id,
      metadata: { status: 'DRAFT', medical_secret: 'hidden' },
      created_at: meta.timestamp,
    });
    expect(row.metadata).toEqual({ status: 'DRAFT' });
    try {
      validatedInput(productBody, {});
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApiError);
      if (error instanceof ApiError) expect(error.responseValidated).toBe(true);
    }
  });
});
