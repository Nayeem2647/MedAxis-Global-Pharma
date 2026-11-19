import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductRichDescription } from '../../components/catalog/ProductRichDescription';
import { productBody, videoReceipt } from '../../lib/admin-management';
import { entityMetadata, productStructuredData } from '../../lib/catalog-seo';
import { productMediaUrl, productSeoDescription, productSeoTitle, productSlug } from '../../lib/product-form';
import { homeProductSchema, publicVideoUrl } from '../../lib/public-catalog';
import { adminProxyRule } from '../../lib/admin-contract';
import { product } from '../catalog-fixtures';

afterEach(() => vi.unstubAllEnvs());
describe('medicine product form and public metadata', () => {
  it('keeps multilingual slugs and removes URL syntax', () => {
    expect(productSlug('  Medicine / 80 mg ?  ')).toBe('medicine-80-mg');
    expect(productSlug('奥希替尼 80mg')).toBe('奥希替尼-80mg');
    expect(productSlug('X'.repeat(250))).toHaveLength(200);
    expect(productSeoTitle('Medicine 80 mg', '80 mg')).toBe('Medicine 80 mg | MedAxis Global Pharma');
    expect(productSeoDescription('<p>Medicine <strong>details</strong></p>', 'Medicine')).toBe('Medicine details');
  });
  it('renders formatting without executing tags, event handlers or decoded markup', () => {
    const html = renderToStaticMarkup(createElement(ProductRichDescription, { html: '<h3>Details</h3><p><strong>Medicine</strong> &amp; information</p><ul><li>Pack details</li></ul><script>bad()</script><img src=x onerror=bad()><a href="javascript:bad()">Link</a>&lt;script&gt;literal&lt;/script&gt;'}));
    expect(html).toContain('<strong>Medicine</strong>');
    expect(html).toContain('<ul><li>Pack details</li></ul>');
    expect(html).toContain('&lt;script&gt;literal&lt;/script&gt;');
    expect(html).not.toMatch(/<script|onerror|javascript:|<img|bad\(\)/);
  });
  it('writes actual localized SEO and social image metadata with the main-image fallback', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://medaxisglobalpharma.com');
    const item = homeProductSchema.parse({ ...product, seo_title: 'Medicine sourcing', meta_description: 'Request verified product information.', primary_image_url: 'https://cdn.medaxisglobalpharma.com/products/s3/main.png', seo_image_url: 'https://cdn.medaxisglobalpharma.com/products/s3/social.png' });
    const metadata = entityMetadata('en', 'products', 'medicine', item);
    expect(metadata.title).toBe('Medicine sourcing | MedAxis Global Pharma');
    expect(metadata.description).toBe('Request verified product information.');
    expect(metadata.openGraph).toMatchObject({ title: metadata.title, description: metadata.description, images: [{ url: item.seo_image_url }] });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [item.seo_image_url] });
    expect(metadata.alternates?.canonical).toBe('https://medaxisglobalpharma.com/en/products/medicine');
    const fallback = entityMetadata('en', 'products', 'medicine', { ...item, seo_image_url: undefined, seo_title: undefined });
    expect(fallback.openGraph).toMatchObject({ images: [{ url: item.primary_image_url }] });
    expect(fallback.title).toBe('Medicine 80 mg | MedAxis Global Pharma');
    expect(productStructuredData(item, 'en', [])).not.toHaveProperty('offers');
  });
  it('allows optional video only from the configured public media origins and safe storage paths', () => {
    const url = 'https://cdn.medaxisglobalpharma.com/products/s3/videos/movie.webm';
    expect(publicVideoUrl(url)).toBe(url);
    expect(publicVideoUrl('https://evil.example/products/s3/videos/movie.webm')).toBeNull();
    expect(publicVideoUrl('https://cdn.medaxisglobalpharma.com/prescriptions/s3/private.mp4')).toBeNull();
    expect(publicVideoUrl(url + '?token=secret')).toBeNull();
    expect(videoReceipt.safeParse({ object_key: 'products/s3/videos/movie.webm', url, mime_type: 'video/webm', file_size_bytes: 500 }).success).toBe(true);
    expect(videoReceipt.safeParse({ object_key: 'products/s3/videos/movie.webm', url, mime_type: 'video/webm', file_size_bytes: 50 * 1024 * 1024 + 1 }).success).toBe(false);
    expect(adminProxyRule('catalog/videos', 'POST')).toEqual({ kind: 'multipart', query: [] });
    expect(adminProxyRule('catalog/videos', 'GET')).toBeNull();
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://127.0.0.1:4000');
    expect(productMediaUrl('products/local/videos/movie.mp4')).toBe('http://127.0.0.1:4000/v1/public/media/products/local/videos/movie.mp4');
    expect(productMediaUrl('products/local/../private.png')).toBeNull();
  });
  it('limits the gallery to one main and five additional pictures while video remains optional', () => {
    const body = { sku: 'MED', manufacturer_id: product.manufacturer.id, generic_id: product.generic.id, category_ids: [product.categories[0]!.id], translations: { en: { brand_name: 'Medicine', slug: 'medicine' } }, strength: '80 mg', dosage_form: 'Tablet', pack_size: '30 tablets', packaging_unit: 'BOX', cold_chain_required: false, status: 'DRAFT', image_keys: Array.from({ length: 6 }, (_, i) => `products/s3/image-${i}.png`) };
    expect(productBody.safeParse(body).success).toBe(true);
    expect(productBody.safeParse({ ...body, image_keys: [...body.image_keys, 'products/s3/extra.png'] }).success).toBe(false);
    expect(productBody.safeParse({ ...body, video_key: null, seo_image_key: null }).success).toBe(true);
  });
});
