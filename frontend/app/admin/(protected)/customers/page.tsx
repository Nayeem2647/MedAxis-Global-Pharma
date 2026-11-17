import { z } from 'zod';
import { guardedAdminRead } from '../../../../lib/admin-server';
import { customerQuery, customerRecord, paramsFor, requirePagination } from '../../../../lib/admin-management';
import { AdminUnavailable } from '../../../../components/admin/AdminFeedback';
import { AdminLink } from '../../../../components/admin/AdminShell';
import { ManagementPagination, ManagementTable } from '../../../../components/admin/ManagementTable';
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let query: URLSearchParams;
  try {
    query = paramsFor(await searchParams, ['page', 'limit', 'q', 'buyer_type', 'country']);
    customerQuery.parse(Object.fromEntries(query));
  } catch {
    return <AdminUnavailable problem={{ status: 422 }} />;
  }
  const result = await guardedAdminRead(`/v1/admin/customers?${query}`, z.array(customerRecord).max(100));
  if (!result.ok) return <AdminUnavailable problem={result.problem} />;
  let pagination;
  try {
    pagination = requirePagination(result.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }
  return (
    <>
      <h1>Customers</h1>
      <section className="admin-panel">
        <form className="admin-filters" action="/admin/customers">
          <label>
            Search
            <input name="q" maxLength={100} defaultValue={query.get('q') ?? ''} />
          </label>
          <label>
            Buyer type
            <select name="buyer_type" defaultValue={query.get('buyer_type') ?? ''}>
              <option value="">All buyers</option>
              <option>B2B_WHOLESALE</option>
              <option>B2C_PATIENT</option>
            </select>
          </label>
          <label>
            Country (ISO code)
            <input name="country" pattern="[A-Z]{2}" maxLength={2} defaultValue={query.get('country') ?? ''} />
          </label>
          <button className="button primary">Apply filters</button>
          <AdminLink href="/admin/customers">Clear</AdminLink>
        </form>
        <ManagementTable label="Customer directory" columns={['Customer', 'Contact', 'Destination', 'Profile']}>
          {result.result.data.map((row) => (
            <tr key={row.id}>
              <td>
                {row.full_name}
                <span>{row.company_name ?? row.customer_type}</span>
              </td>
              <td>
                {row.email ?? row.whatsapp_number ?? row.wechat_id}
                <span>{row.preferred_locale}</span>
              </td>
              <td>
                {row.country}
                {row.city ? ` · ${row.city}` : ''}
              </td>
              <td>
                <AdminLink href={`/admin/customers/${row.id}`}>View history</AdminLink>
              </td>
            </tr>
          ))}
        </ManagementTable>
        {!result.result.data.length && <p>No matching customers.</p>}
        <ManagementPagination path="/admin/customers" query={Object.fromEntries(query)} pagination={pagination} />
      </section>
      <p className="small muted">
        Customer profiles are read-only. Each RFQ retains its immutable original contact snapshot.
      </p>
    </>
  );
}
