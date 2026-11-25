import { adminRfqsSchema } from '../../lib/admin-contract';
import { quotationRequestFilters, rfqPage, rfqQuery, type AdminRfqPage } from '../../lib/admin-data';
import { guardedAdminRead } from '../../lib/admin-server';
import { QuotationRequestQueue } from './QuotationRequestQueue';

export async function QuotationRequests() {
  const inbox = await guardedAdminRead(`/v1/admin/rfqs?${rfqQuery(quotationRequestFilters)}`, adminRfqsSchema);
  let initial: AdminRfqPage | null = null;
  let problem = inbox.ok ? undefined : inbox.problem;
  if (inbox.ok) {
    try { initial = rfqPage(inbox.result.data, inbox.result.meta); }
    catch { problem = { status: 502, fields: [] }; }
  }
  return <QuotationRequestQueue initial={initial} initialProblem={problem}/>;
}
