import { adminFiltersSchema, rfqPage, rfqQuery } from '../../lib/admin-data';
import { adminFxSchema, adminRfqsSchema } from '../../lib/admin-contract';
import { guardedAdminRead } from '../../lib/admin-server';
import { AdminDashboard } from './AdminDashboard';
import { summarySchema } from '../../lib/admin-management';
import { AdminUnavailable } from './AdminFeedback';

export async function AdminDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parsed = adminFiltersSchema.safeParse(await searchParams);
  if (!parsed.success) return <AdminUnavailable problem={{ status: 422 }}/>;
  const [inbox, rates, summary] = await Promise.all([guardedAdminRead(`/v1/admin/rfqs?${rfqQuery(parsed.data)}`, adminRfqsSchema), guardedAdminRead('/v1/admin/fx-rates', adminFxSchema), guardedAdminRead('/v1/admin/quotations/summary?window_hours=24', summarySchema)]);
  let page = null;
  if (inbox.ok) { try { page = rfqPage(inbox.result.data, inbox.result.meta); } catch { /* Missing pagination must never produce an invented total. */ } }
  return <AdminDashboard initialSummary={summary.ok ? summary.result.data : null} filters={parsed.data} initialRfqs={page} initialFx={rates.ok ? rates.result.data : null} initialProblem={!inbox.ok ? inbox.problem : !rates.ok ? rates.problem : page ? undefined : { status: 502 }}/>;
}
