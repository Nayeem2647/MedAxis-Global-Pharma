import { z } from 'zod';
import { guardedAdminRead } from '../../../../../lib/admin-server';
import {
  bannerPlacements,
  bannerRecord,
  bannerScheduleState,
  paramsFor,
  resourceKinds,
  resourceName,
  resourcePath,
  resourceQuery,
  resourceSchema,
  requirePagination,
} from '../../../../../lib/admin-management';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
import { AdminLink } from '../../../../../components/admin/AdminShell';
import { ManagementTable, ManagementPagination } from '../../../../../components/admin/ManagementTable';
import { AdminMasterList } from '../../../../../components/admin/AdminMasterList';
import { AdminProductList } from '../../../../../components/admin/AdminProductList';
import { AdminBannerSetup } from '../../../../../components/admin/AdminBannerSetup';
import { notFound } from 'next/navigation';
export default async function ResourceListPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const kind = z.enum(resourceKinds).safeParse((await params).kind);
  if (!kind.success) notFound();
  const path = `/admin/catalog/${kind.data}`;
  let query: URLSearchParams;
  try {
    query = paramsFor(
      await searchParams,
      kind.data === 'products'
        ? ['page', 'limit', 'q', 'status', 'manufacturer_id', 'generic_id', 'category_id']
        : kind.data === 'banners'
          ? ['page', 'limit', 'q', 'is_active', 'placement']
          : ['page', 'limit', 'q', 'is_active'],
    );
    resourceQuery.parse(Object.fromEntries(query));
  } catch {
    return <AdminUnavailable problem={{ status: 422 }} />;
  }
  if (kind.data === 'products') return <AdminProductList query={Object.fromEntries(query)} />;
  if (kind.data === 'manufacturers' || kind.data === 'generics' || kind.data === 'categories') return <AdminMasterList kind={kind.data} query={Object.fromEntries(query)} />;
  if (kind.data === 'banners') {
    const bannersResult = await guardedAdminRead(
      `${resourcePath('banners')}?${query}`,
      z.array(bannerRecord).max(100),
    );
    if (!bannersResult.ok) return <AdminUnavailable problem={bannersResult.problem} />;
    let bannersPagination;
    try {
      bannersPagination = requirePagination(bannersResult.result.meta);
    } catch {
      return <AdminUnavailable problem={{ status: 502 }} />;
    }
    const placementParam = z.enum(bannerPlacements).safeParse(query.get('placement'));
    return (
      <AdminBannerSetup
        initialItems={bannersResult.result.data}
        initialPagination={bannersPagination}
        initialFilterPlacement={placementParam.success ? placementParam.data : ''}
      />
    );
  }
  const result = await guardedAdminRead(
    `${resourcePath(kind.data)}?${query}`,
    z.array(resourceSchema(kind.data)).max(100),
  );
  if (!result.ok) return <AdminUnavailable problem={result.problem} />;
  let pagination;
  try {
    pagination = requirePagination(result.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-kicker">Catalog management</p>
          <h1>{kind.data}</h1>
        </div>
        <AdminLink className="button primary" href={`${path}/new`}>
          {kind.data === 'banners' ? 'Create banner' : 'Create record'}
        </AdminLink>
      </div>
      <section className="admin-panel">
        <form method="get" action={path} className="admin-filters">
          <label>
            Search
            <input name="q" maxLength={100} defaultValue={query.get('q') ?? ''} />
          </label>
          <label>
            Active setting
            <select name="is_active" defaultValue={query.get('is_active') ?? ''}>
              <option value="">Active & inactive</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <button className="button primary">Search</button>
          <AdminLink href={path}>Clear filters</AdminLink>
        </form>
        <ManagementTable label={`${kind.data} records`} columns={['Name', 'State', 'Updated (UTC)', 'Manage']}>
          {result.result.data.map((row) => (
            <tr key={row.id}>
              <td>
                {resourceName(row)}
                <span>
                  {'sku' in row ? row.sku : 'slug' in row.translations.en ? row.translations.en.slug : 'Announcement'}
                </span>
              </td>
              <td>
                {'status' in row
                  ? row.status
                  : 'is_active' in row
                    ? 'title' in row.translations.en
                      ? bannerScheduleState(row)
                      : row.is_active
                        ? 'Active'
                        : 'Inactive'
                    : ''}
                {'starts_at' in row && row.starts_at && <span>Starts {row.starts_at}</span>}
                {'ends_at' in row && row.ends_at && <span>Ends {row.ends_at}</span>}
              </td>
              <td>{row.updated_at.replace('T', ' ').slice(0, 19)}</td>
              <td>
                <AdminLink href={`${path}/${row.id}`}>Edit {resourceName(row)}</AdminLink>
              </td>
            </tr>
          ))}
        </ManagementTable>
        {!result.result.data.length && <p>No matching records.</p>}
        <ManagementPagination path={path} query={Object.fromEntries(query)} pagination={pagination} />
      </section>
      <p className="small muted">
        Historical slugs remain reserved. Saving a new slug creates a redirect; a reserved old slug cannot be reused.
        Catalog saves trigger server-side cache invalidation.
      </p>
    </>
  );
}
