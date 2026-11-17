import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ApiPagination } from '../../lib/api-client';
import { AdminLink } from './AdminShell';

export function ManagementTable({
  label,
  columns,
  children,
}: {
  label: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <div className="admin-table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className="admin-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function ManagementPagination({
  path,
  query,
  pagination,
  numbered = false,
}: {
  path: string;
  query: Record<string, string>;
  pagination: ApiPagination;
  numbered?: boolean;
}) {
  const href = (page: number) => {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    return `${path}?${params}`;
  };
  if (numbered) {
    const last = Math.max(1, pagination.total_pages);
    const start = Math.max(2, Math.min(pagination.page - 1, last - 3));
    const end = Math.min(last - 1, Math.max(pagination.page + 1, 4));
    const pages = [...new Set([1, ...Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index), last])];
    return <nav className="admin-numbered-pagination" aria-label="Results pagination">
      {pagination.has_prev ? <AdminLink href={href(pagination.page - 1)} className="admin-page-number"><ChevronLeft size={17} aria-hidden="true" /><span className="sr-only">Previous page</span></AdminLink> : <button type="button" disabled className="admin-page-number" aria-label="Previous page"><ChevronLeft size={17} aria-hidden="true" /></button>}
      {pages.map((page, index) => <span className="admin-page-number-group" key={page}>{index > 0 && page > pages[index - 1] + 1 && <span className="admin-page-ellipsis" aria-hidden="true">…</span>}<AdminLink href={href(page)} className="admin-page-number" current={page === pagination.page}><span className="sr-only">Page </span>{page}</AdminLink></span>)}
      {pagination.has_next ? <AdminLink href={href(pagination.page + 1)} className="admin-page-number"><ChevronRight size={17} aria-hidden="true" /><span className="sr-only">Next page</span></AdminLink> : <button type="button" disabled className="admin-page-number" aria-label="Next page"><ChevronRight size={17} aria-hidden="true" /></button>}
    </nav>;
  }
  return (
    <nav className="admin-pagination" aria-label="Results pagination">
      {pagination.has_prev && (
        <AdminLink className="button secondary" href={href(pagination.page - 1)}>
          Previous
        </AdminLink>
      )}
      <span>
        {pagination.total_items} results · Page {pagination.page} of {pagination.total_pages}
      </span>
      {pagination.has_next && (
        <AdminLink className="button secondary" href={href(pagination.page + 1)}>
          Next
        </AdminLink>
      )}
    </nav>
  );
}
