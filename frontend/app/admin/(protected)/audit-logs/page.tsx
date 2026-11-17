import { z } from 'zod';
import { guardedAdminRead } from '../../../../lib/admin-server';
import { auditQuery, auditRecord, paramsFor, requirePagination } from '../../../../lib/admin-management';
import { AdminUnavailable } from '../../../../components/admin/AdminFeedback';
import { AdminLink } from '../../../../components/admin/AdminShell';
import { ManagementPagination, ManagementTable } from '../../../../components/admin/ManagementTable';
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const fields = ['actor_id', 'action', 'entity_type', 'entity_id', 'date_from', 'date_to'];
  let query: URLSearchParams;
  try {
    query = paramsFor(await searchParams, ['page', 'limit', 'actor_type', ...fields]);
    auditQuery.parse(Object.fromEntries(query));
  } catch {
    return <AdminUnavailable problem={{ status: 422 }} />;
  }
  const result = await guardedAdminRead(`/v1/admin/audit-logs?${query}`, z.array(auditRecord).max(100));
  if (!result.ok) return <AdminUnavailable problem={result.problem} />;
  let pagination;
  try {
    pagination = requirePagination(result.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }
  return (
    <>
      <h1>Audit logs</h1>
      <section className="admin-panel">
        <p>
          Read-only operational history. Sensitive medical and authentication content is excluded from displayed
          metadata.
        </p>
        <form className="admin-filters" action="/admin/audit-logs">
          <label>
            Actor type
            <select name="actor_type" defaultValue={query.get('actor_type') ?? ''}>
              <option value="">All actors</option>
              {['SUPER_ADMIN', 'BUYER', 'SYSTEM'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {fields.map((field) => (
            <label key={field}>
              {field.replaceAll('_', ' ')}
              {field.startsWith('date_') ? ' (ISO timestamp, UTC)' : ''}
              <input
                name={field}
                defaultValue={query.get(field) ?? ''}
                maxLength={200}
                placeholder={field.startsWith('date_') ? '2026-11-01T00:00:00Z' : undefined}
              />
            </label>
          ))}
          <button className="button primary">Apply filters</button>
          <AdminLink href="/admin/audit-logs">Clear</AdminLink>
        </form>
        <ManagementTable
          label="Audit history"
          columns={['Timestamp (UTC)', 'Actor / action', 'Entity', 'Request ID', 'Redacted metadata']}
        >
          {result.result.data.map((row) => (
            <tr key={row.id}>
              <td>{row.created_at}</td>
              <td>
                {row.actor_type}
                <span>{row.actor_id ?? 'System / buyer'}</span>
                <strong>{row.action}</strong>
              </td>
              <td>
                {row.entity_type}
                <span>{row.entity_id}</span>
                {row.old_status && (
                  <span>
                    {row.old_status} → {row.new_status ?? '—'}
                  </span>
                )}
              </td>
              <td>{row.request_id}</td>
              <td>
                <pre className="admin-prewrap">{JSON.stringify(row.metadata, null, 2)}</pre>
              </td>
            </tr>
          ))}
        </ManagementTable>
        {!result.result.data.length && <p>No matching audit entries.</p>}
        <ManagementPagination path="/admin/audit-logs" query={Object.fromEntries(query)} pagination={pagination} />
      </section>
    </>
  );
}
