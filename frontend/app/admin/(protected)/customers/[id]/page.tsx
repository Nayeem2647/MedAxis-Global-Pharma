import { z } from 'zod';
import { notFound } from 'next/navigation';
import { guardedAdminRead } from '../../../../../lib/admin-server';
import { customerDetail, paramsFor, pageFields, requirePagination } from '../../../../../lib/admin-management';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
import { AdminLink } from '../../../../../components/admin/AdminShell';
import { ManagementPagination, ManagementTable } from '../../../../../components/admin/ManagementTable';
export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = z.uuidv4().safeParse((await params).id);
  if (!id.success) notFound();
  let query: URLSearchParams;
  try {
    query = paramsFor(await searchParams, ['page', 'limit']);
    z.strictObject(pageFields).parse(Object.fromEntries(query));
  } catch {
    return <AdminUnavailable problem={{ status: 422 }} />;
  }
  const result = await guardedAdminRead(`/v1/admin/customers/${id.data}?${query}`, customerDetail);
  if (!result.ok) return <AdminUnavailable problem={result.problem} />;
  let pagination;
  try {
    pagination = requirePagination(result.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }
  const { customer, history } = result.result.data;
  return (
    <>
      <AdminLink href="/admin/customers">← Customers</AdminLink>
      <h1>{customer.full_name}</h1>
      <section className="admin-panel">
        <h2>Current customer profile</h2>
        <dl className="admin-facts">
          {Object.entries(customer)
            .filter(([key]) => !['id', 'created_at', 'updated_at'].includes(key))
            .map(([key, value]) => (
              <div key={key}>
                <dt>{key.replaceAll('_', ' ')}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
        <p className="small muted">
          This profile does not rewrite historical RFQ requirements or contact snapshots. No lifetime commercial total
          is inferred from this page.
        </p>
      </section>
      <section className="admin-panel">
        <h2>RFQ history</h2>
        <ManagementTable label="Customer RFQ history" columns={['RFQ', 'Status', 'Received (UTC)', 'Quotations']}>
          {history.map((row) => (
            <tr key={row.id}>
              <td>
                <AdminLink href={`/admin/rfqs/${row.id}`}>{row.rfq_number}</AdminLink>
                <span>{row.inquiry_type}</span>
              </td>
              <td>{row.status}</td>
              <td>{row.created_at}</td>
              <td>
                {row.quotations.map((quote) => (
                  <p key={quote._id}>
                    <AdminLink href={`/admin/quotations/${quote._id}`}>
                      {quote.quotation_number} · v{quote.current_version}
                    </AdminLink>
                  </p>
                ))}
              </td>
            </tr>
          ))}
        </ManagementTable>
        {!history.length && <p>No RFQs on this history page.</p>}
        <ManagementPagination
          path={`/admin/customers/${id.data}`}
          query={Object.fromEntries(query)}
          pagination={pagination}
        />
      </section>
    </>
  );
}
