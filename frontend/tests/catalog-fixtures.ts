import { meta } from './fixtures';

export const master = { id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', name: 'Manufacturer', slug: 'manufacturer', alternate_slugs: { en: 'manufacturer', zhCN: 'manufacturer-cn' } };
export const product = {
  id: '82f591d0-346b-4cc4-8d67-e25358fa0272', sku: 'TEST-PRODUCT', locale: 'en', brand_name: 'Medicine', slug: 'medicine',
  alternate_slugs: { en: 'medicine', zhCN: 'medicine-cn' }, translations: { en: { brand_name: 'Medicine', slug: 'medicine' }, zhCN: { brand_name: '药品', slug: 'medicine-cn' } },
  manufacturer: master, generic: master, categories: [master], strength: '80 mg', dosage_form: 'Tablet', pack_size: '30 tablets', packaging_unit: 'BOX',
  cold_chain_required: false, primary_image_url: null, image_urls: [],
};
export const list = { products: [product], facets: { dosage_forms: [{ name: 'Tablet', count: 1 }], cold_chain: [{ required: false, count: 1 }] } };
export const catalogMeta = { ...meta, pagination: { page: 1, limit: 20, total_items: 1, total_pages: 1, has_next: false, has_prev: false } };
