import { z } from 'zod';
import { CatalogDelete } from './CatalogDelete';
import { ArrowUpRight, Award, Building2, Layers, Pencil, Pill, Plus, Search } from 'lucide-react';
import { guardedAdminRead } from '../../lib/admin-server';
import { masterLabels, masterRecord, requirePagination } from '../../lib/admin-management';
import { publicAssetUrl } from '../../lib/public-catalog';
import { CatalogImage } from '../catalog/CatalogImage';
import { AdminUnavailable } from './AdminFeedback';
import { AdminLink } from './AdminShell';
import { ManagementPagination, ManagementTable } from './ManagementTable';
import {
  MasterListExport,
  MasterPreview,
  MasterStatusFilter,
  MasterStatusSwitch,
  type MasterDirectoryKind,
} from './MasterListControls';

export async function AdminMasterList({ query, kind }: { query: Record<string, string>; kind: MasterDirectoryKind }) {
  const manufacturer = kind === 'manufacturers';
  const label = masterLabels[kind];
  const title = kind === 'categories' ? 'Categories' : `${label}s`;
  const path = `/admin/catalog/${kind}`;
  const Icon = manufacturer ? Building2 : kind === 'categories' ? Layers : Pill;
  const result = await guardedAdminRead(
    `/v1/admin/catalog/${kind}?${new URLSearchParams(query)}`,
    z.array(masterRecord).max(100),
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
  const filtered = Boolean(query.q || query.is_active);

  return (
    <div className={`admin-products-page admin-${kind}-page`}>
      <div className="admin-page-heading admin-products-heading">
        <div>
          <div className="admin-products-title">
            <span className="admin-products-title-icon">
              {manufacturer ? <Award size={25} aria-hidden="true" /> : <Icon size={25} aria-hidden="true" />}
            </span>
            <h1>{title}</h1>
            <span className="admin-products-total" aria-label={`${pagination.total_items} matching ${kind}`}>
              {pagination.total_items}
            </span>
          </div>
        </div>
      </div>

      <section className="admin-products-list" aria-label={`${label} list`}>
        <div className="admin-products-toolbar">
          <form
            id={`admin-${kind}-filters`}
            method="get"
            action={path}
            className="admin-products-search"
            role="search"
            aria-label={`Search ${kind}`}
            key={JSON.stringify(query)}
          >
            {query.limit && <input type="hidden" name="limit" value={query.limit} />}
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              name="q"
              maxLength={100}
              defaultValue={query.q ?? ''}
              placeholder={`Search by ${label.toLowerCase()} name`}
              aria-label={`Search by ${label.toLowerCase()} name`}
            />
            <button type="submit">Search</button>
          </form>

          <div className="admin-products-toolbar-actions">
            {filtered && (
              <AdminLink href={path} className="admin-product-reset">
                Clear filters
              </AdminLink>
            )}
            <MasterStatusFilter value={query.is_active ?? ''} kind={kind} />
            <MasterListExport rows={rows} kind={kind} />
            <AdminLink href={`${path}/new`} className="button primary">
              <Plus size={18} aria-hidden="true" />
              Add new {label.toLowerCase()}
            </AdminLink>
          </div>
        </div>

        <ManagementTable
          label={`${kind} records`}
          columns={manufacturer ? ['SL', 'Manufacturer Logo', 'Name', 'Total Product', 'Total RFQ', 'Status', 'Action'] : kind === 'categories' ? ['SL', 'Picture', 'Name', 'Sort order', 'Home Category Status', 'Action'] : ['SL', 'Name', 'Therapeutic indications', 'Status', 'Action']}
        >
          {rows.map((row, index) => {
            const logo = publicAssetUrl(row.logo_url ?? row.logo_data_url);
            const name = row.translations.en.name;
            return (
              <tr key={row.id}>
                <td className="admin-products-serial">{first + index}</td>
                {kind !== 'generics' && <td>
                  <div className="admin-manufacturer-logo">
                    {logo ? (
                      <CatalogImage
                        src={logo}
                        alt={`${name} ${manufacturer ? 'logo' : 'picture'}`}
                        width={60}
                        height={44}
                        sizes="60px"
                        fallbackLabel={manufacturer ? 'No logo' : 'No picture'}
                      />
                    ) : (
                      <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </div>
                </td>}
                <td>
                  <AdminLink className="admin-product-name" href={`${path}/${row.id}`} title={name}>
                    {name}
                  </AdminLink>
                  {manufacturer ? row.country && <p className="admin-product-sku">{row.country}</p> : <p className="admin-product-sku">{row.translations.en.slug}</p>}
                </td>
                {manufacturer ? <><td className="admin-manufacturer-metric">
                  <AdminLink href={`/admin/catalog/products?manufacturer_id=${row.id}`}>
                    {row.product_count ?? 0}
                  </AdminLink>
                </td>
                <td className="admin-manufacturer-metric">
                  <span>{row.rfq_count ?? 0}</span>
                </td></> : <td className="admin-generic-indications">{kind === 'categories' ? row.sort_order ?? 0 : row.therapeutic_indications?.length ? row.therapeutic_indications.join(', ') : 'Not specified'}</td>}
                <td>
                  <MasterStatusSwitch record={row} kind={kind} />
                </td>
                <td>
                  <div className="admin-product-actions">
                    <MasterPreview record={row} logo={logo} kind={kind} />
                    <CatalogDelete kind={kind} id={row.id} name={name} updatedAt={row.updated_at} lastOnPage={rows.length === 1} />
                    <AdminLink href={`${path}/${row.id}`} className="admin-product-action">
                      <Pencil size={16} aria-hidden="true" />
                      <span className="sr-only">Edit {name}</span>
                    </AdminLink>
                    {row.is_active && (
                      <a
                        href={`/en/${kind}/${encodeURIComponent(row.translations.en.slug)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="admin-product-action"
                      >
                        <ArrowUpRight size={17} aria-hidden="true" />
                        <span className="sr-only">View {name} on website (opens in new tab)</span>
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </ManagementTable>

        {!rows.length && (
          <div className="admin-products-empty">
            <Icon size={38} strokeWidth={1.3} aria-hidden="true" />
            <h3>No matching {kind}</h3>
            <p>Try another search or reset your filters to see all {kind}.</p>
            <AdminLink href={path} className="button secondary">
              Reset filters
            </AdminLink>
          </div>
        )}

        <div className="admin-products-footer">
          <p aria-live="polite">
            Showing {first}–{last} of {pagination.total_items} {kind}
          </p>
          <ManagementPagination
            path={path}
            query={query}
            pagination={{ ...pagination, total_pages: Math.max(1, pagination.total_pages) }}
            numbered
          />
        </div>
      </section>
    </div>
  );
}
