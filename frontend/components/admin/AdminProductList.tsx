import { z } from 'zod';
import { ArrowUpRight, Package, Pencil, Pill, Plus, Search, Snowflake, Upload } from 'lucide-react';
import { guardedAdminRead } from '../../lib/admin-server';
import { productRecord, requirePagination } from '../../lib/admin-management';
import { publicAssetUrl } from '../../lib/public-catalog';
import { CatalogImage } from '../catalog/CatalogImage';
import { AdminUnavailable } from './AdminFeedback';
import { AdminLink } from './AdminShell';
import { ManagementPagination, ManagementTable } from './ManagementTable';
import { ProductListFilters, ProductListSearchProvider, ProductSearchInput } from './ProductListFilters';
import { ProductListExport, ProductPreview, ProductPublication, ProductStatusFilter } from './ProductListControls';

const path = '/admin/catalog/products';

function productImageUrl(key: string | undefined) {
  const base = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL || 'https://cdn.medaxisglobalpharma.com').replace(/\/$/, '');
  return key ? publicAssetUrl(`${base}/${key}`) : null;
}

export async function AdminProductList({ query }: { query: Record<string, string> }) {
  const result = await guardedAdminRead(
    `/v1/admin/catalog/products?${new URLSearchParams(query)}`,
    z.array(productRecord).max(100),
  );
  if (!result.ok) return <AdminUnavailable problem={result.problem} />;
  let pagination;
  try {
    pagination = requirePagination(result.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }
  const rows = result.result.data;
  const first = rows.length ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const last = rows.length ? first + rows.length - 1 : 0;

  return <ProductListSearchProvider initialQuery={query.q ?? ''}><div className="admin-products-page">
    <div className="admin-page-heading admin-products-heading">
      <div>
        <div className="admin-products-title">
          <span className="admin-products-title-icon"><Package size={25} aria-hidden="true" /></span>
          <h1>Product List</h1>
          <span className="admin-products-total" aria-label={`${pagination.total_items} matching products`}>{pagination.total_items}</span>
        </div>
      </div>
    </div>

    <ProductListFilters query={query} />

    <div className="admin-products-quick-actions"><AdminLink href="/admin/catalog/import" className="button primary"><Upload size={17} aria-hidden="true" />Bulk import</AdminLink><p>Add multiple catalog products with a validated CSV file.</p></div>

    <section className="admin-products-list" aria-label="Product list">
      <div className="admin-products-toolbar">
        <div className="admin-products-search" role="search" aria-label="Search product list">
          <Search size={18} aria-hidden="true" /><ProductSearchInput toolbar /><button type="submit" form="admin-product-filters">Search</button>
        </div>
        <div className="admin-products-toolbar-actions">
          <ProductStatusFilter value={query.status ?? ''} />
          <ProductListExport products={rows} />
          <AdminLink href={`${path}/new`} className="button primary"><Plus size={18} aria-hidden="true" />Add New Product</AdminLink>
        </div>
      </div>

      <ManagementTable label="products records" columns={['SL', 'Product Name', 'Medicine Details', 'Packaging', 'Cold Chain', 'Status', 'Action']}>
        {rows.map((row, index) => {
          const image = productImageUrl(row.image_keys[0]);
          return <tr key={row.id}>
            <td className="admin-products-serial">{first + index}</td>
            <td>
              <div className="admin-product-identity">
                <div className="admin-product-thumbnail">
                  {image
                    ? <CatalogImage src={image} alt={row.translations.en.image_alt_text ?? row.translations.en.brand_name} width={58} height={64} sizes="58px" fallbackLabel="No image" />
                    : <Pill size={25} strokeWidth={1.5} aria-hidden="true" />}
                </div>
                <div>
                  <AdminLink className="admin-product-name" href={`${path}/${row.id}`}>{row.translations.en.brand_name}</AdminLink>
                  <p className="admin-product-sku">SKU: {row.sku}</p>
                </div>
              </div>
            </td>
            <td><strong className="admin-product-strength">{row.strength}</strong><span>{row.dosage_form}</span></td>
            <td>{row.pack_size}<span>{row.packaging_unit}</span></td>
            <td>{row.cold_chain_required
              ? <span className="admin-product-cold"><Snowflake size={14} aria-hidden="true" />Required</span>
              : <span className="admin-product-standard">Standard</span>}</td>
            <td><ProductPublication product={row} /></td>
            <td>
              <div className="admin-product-actions">
                <ProductPreview product={row} image={image} />
                <AdminLink href={`${path}/${row.id}`} className="admin-product-action"><Pencil size={16} aria-hidden="true" /><span className="sr-only">Edit {row.translations.en.brand_name}</span></AdminLink>
                {row.status === 'PUBLISHED' && <a href={`/en/products/${encodeURIComponent(row.translations.en.slug)}`} target="_blank" rel="noreferrer" className="admin-product-action"><ArrowUpRight size={17} aria-hidden="true" /><span className="sr-only">View {row.translations.en.brand_name} on website (opens in new tab)</span></a>}
              </div>
            </td>
          </tr>;
        })}
      </ManagementTable>
      {!rows.length && <div className="admin-products-empty"><Package size={38} strokeWidth={1.3} aria-hidden="true" /><h3>No matching products</h3><p>Try another search or reset your filters to see the full catalog.</p><AdminLink href={path} className="button secondary">Reset filters</AdminLink></div>}
      <div className="admin-products-footer"><p aria-live="polite">Showing {first}–{last} of {pagination.total_items} products</p><ManagementPagination path={path} query={query} pagination={{ ...pagination, total_pages: Math.max(1, pagination.total_pages) }} numbered /></div>
    </section>
  </div></ProductListSearchProvider>;
}
