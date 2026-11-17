'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { summarySchema } from '../../lib/admin-management';
import { QuotationMetrics } from './QuotationMetrics';
import { ApiError, apiRequest } from '../../lib/api-client';
import { rfqStatuses, type AdminFx } from '../../lib/admin-contract';
import { refreshAdminFx, refreshAdminRfqs, type AdminFilters, type AdminRfqPage } from '../../lib/admin-data';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { AdminLink, useAdminLive } from './AdminShell';

export function AdminDashboard({ filters, initialRfqs, initialFx, initialProblem, initialSummary }: { filters: AdminFilters; initialRfqs: AdminRfqPage | null; initialFx: AdminFx | null; initialProblem?: AdminFeedbackValue; initialSummary: z.infer<typeof summarySchema>|null }) {
  const { revision, active, expire } = useAdminLive(); const [rfqs, setRfqs] = useState(initialRfqs); const [fx, setFx] = useState(initialFx);
  const [summary,setSummary]=useState(initialSummary);
  const [problem, setProblem] = useState(initialProblem); const [busy, setBusy] = useState(false); const request = useRef<AbortController | null>(null);
  const queryKey = JSON.stringify(filters);
  async function refresh() {
    if (!active) return; request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setProblem(undefined);
    const results = await Promise.allSettled([refreshAdminRfqs(filters, controller.signal), refreshAdminFx(controller.signal), apiRequest('/v1/admin/quotations/summary?window_hours=24',summarySchema,{signal:controller.signal})]);
    if (controller.signal.aborted) return;
    const [inbox, rates, metrics] = results;
    if (inbox.status === 'fulfilled') setRfqs(inbox.value);
    if (rates.status === 'fulfilled') setFx(rates.value); if(metrics.status==='fulfilled')setSummary(metrics.value.data);else setSummary(null);
    for (const result of results) if (result.status === 'rejected') { const error: unknown = result.reason; if (error instanceof ApiError && [401, 403].includes(error.status)) expire(); else setProblem(feedbackValue(error)); }
    setBusy(false);
  }
  useEffect(() => { if (revision > 0) void refresh(); return () => request.current?.abort();
    // Refetch only after validated events/reconnects or an explicit user refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, queryKey, active]);
  function href(page: number) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key, String(value)); query.set('page', String(page)); return `/admin/rfqs?${query}`; }
  return <><div className="admin-page-heading"><div><p className="admin-kicker">Enquiries & exchange rates</p><h1>RFQ operations</h1></div><button className="button secondary" disabled={busy || !active} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh data'}</button></div>
    {problem && <AdminFeedback problem={problem}/>}<QuotationMetrics value={summary}/>
    <section className="admin-panel"><div className="admin-section-heading"><h2>RFQ inbox</h2><span className="admin-count">{rfqs ? `${rfqs.pagination.total_items} matching RFQs` : 'Total unavailable'}</span></div>
      <form action="/admin/rfqs" method="get" className="admin-filters"><label>Search<input name="q" defaultValue={filters.q} maxLength={100} placeholder="RFQ, buyer or email"/></label><label>Status<select aria-label="Status" name="status" defaultValue={filters.status ?? ''}><option value="">All statuses</option>{rfqStatuses.map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Buyer type<select aria-label="Buyer type" name="buyer_type" defaultValue={filters.buyer_type ?? ''}><option value="">All buyers</option><option value="B2B_WHOLESALE">Wholesale</option><option value="B2C_PATIENT">Patient / individual</option></select></label>
        <label>From date (UTC)<input type="date" name="date_from" defaultValue={filters.date_from}/></label><label>To date (UTC)<input type="date" name="date_to" defaultValue={filters.date_to}/></label><div className="admin-filter-actions"><button className="button primary">Apply filters</button><AdminLink className="button secondary" href="/admin/rfqs">Clear</AdminLink></div></form>
      {rfqs ? <><div className="admin-table-scroll" tabIndex={0} role="region" aria-label="RFQ inbox"><table className="admin-table"><thead><tr><th>RFQ</th><th>Buyer</th><th>Destination</th><th>Status</th><th>Received (UTC)</th></tr></thead><tbody>{rfqs.items.map((row) => <tr key={row.id}><td><AdminLink href={`/admin/rfqs/${row.id}`}><strong>{row.rfq_number}</strong></AdminLink><span>{row.inquiry_type === 'QUICK_QUOTE' ? 'Quick quote' : 'Cart RFQ'}</span></td><td>{row.contact_snapshot.full_name}<span>{row.contact_snapshot.company_name ?? (row.contact_snapshot.customer_type === 'B2B_WHOLESALE' ? 'Wholesale buyer' : 'Patient / individual')}</span></td><td>{row.destination_country}</td><td><span className="admin-status">{row.status.replaceAll('_', ' ')}</span>{row.has_prescription && <span>Optional attachment included</span>}</td><td><time dateTime={row.created_at}>{row.created_at.replace('T', ' ').slice(0, 16)}</time></td></tr>)}</tbody></table></div>
        {!rfqs.items.length && <p className="admin-empty">No RFQs match these filters.</p>}
        <nav className="admin-pagination" aria-label="RFQ pagination">{rfqs.pagination.has_prev && <AdminLink className="button secondary" href={href(rfqs.pagination.page - 1)}>Previous</AdminLink>}<span>Page {rfqs.pagination.page} of {rfqs.pagination.total_pages}</span>{rfqs.pagination.has_next && <AdminLink className="button secondary" href={href(rfqs.pagination.page + 1)}>Next</AdminLink>}</nav></> : <p className="muted">The inbox could not be loaded. Refresh to try again.</p>}
    </section>
    <section className="admin-panel" id="rates"><h2>Exchange rates to BDT</h2><p className="small muted">Rates are supplied by the server. Commercial quotations retain their own locked rates.</p><div className="admin-rate-grid">{fx?.rates.map((rate) => <article className="admin-rate" key={rate.currency}><h3>{rate.currency}</h3>{rate.available ? <><strong>{rate.active_rate_to_bdt}</strong><p>{rate.mode === 'MANUAL_FIXED' ? 'Manual fixed' : 'Live'}{rate.stale ? ' · Stale live data' : ''}</p><p className="small muted">Fetched {rate.live_fetched_at.replace('T', ' ').slice(0, 16)} UTC</p></> : <p>Rate unavailable</p>}</article>)}</div>{!fx && <p>Exchange rates are temporarily unavailable.</p>}{fx?.last_error_code && <p className="small muted">The last rate refresh did not succeed; available server rates are shown.</p>}</section>
  </>;
}
