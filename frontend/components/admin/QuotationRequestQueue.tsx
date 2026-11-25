'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import { ApiError } from '../../lib/api-client';
import { quotationRequestFilters, refreshAdminRfqs, type AdminRfqPage } from '../../lib/admin-data';
import { quotationDate } from '../../lib/admin-quotations';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { AdminLink, useAdminLive } from './AdminShell';

export function QuotationRequestQueue({ initial, initialProblem }: {
  initial: AdminRfqPage | null; initialProblem?: AdminFeedbackValue;
}) {
  const { active, revision, expire } = useAdminLive();
  const [inbox, setInbox] = useState(initial);
  const [problem, setProblem] = useState(initialProblem);
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const expireRef = useRef(expire);
  useEffect(() => { expireRef.current = expire; }, [expire]);

  const refresh = useCallback(async () => {
    if (!active) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setProblem(undefined);
    try {
      const next = await refreshAdminRfqs(quotationRequestFilters, controller.signal);
      if (!controller.signal.aborted) setInbox(next);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) expireRef.current();
      else setProblem(feedbackValue(error));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [active]);

  useEffect(() => {
    // Reconcile the server-rendered list on mount and after live events/reconnects.
    void refresh();
    return () => request.current?.abort();
  }, [refresh, revision]);
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return <section className="admin-panel quotation-queue-card quotation-request-queue" aria-label="Website quotation requests" aria-busy={busy}>
    <div className="quotation-queue-header">
      <div><h2><Inbox size={19} aria-hidden="true"/>Website quotation requests</h2>
        <p className="small muted" role="status">{inbox ? `${inbox.pagination.total_items} awaiting review` : 'Request count unavailable'}</p></div>
      <div className="quotation-heading-actions">
        <button type="button" className="button secondary" disabled={busy || !active} onClick={() => void refresh()}>{busy ? 'Refreshing requests…' : 'Refresh requests'}</button>
        <AdminLink href="/admin/rfqs" className="button secondary">View all requests</AdminLink>
      </div>
    </div>
    <p className="small muted">New website submissions appear here. Open a request to review medicines and prepare a quotation.</p>
    {problem && <AdminFeedback problem={problem}/>}
    {inbox ? inbox.items.length ? <ul className="quotation-queue-list">{inbox.items.map((row) => <li key={row.id}>
      <div className="quotation-queue-main">
        <AdminLink href={`/admin/rfqs/${row.id}`} className="quotation-reference">{row.rfq_number}</AdminLink>
        <span>{row.contact_snapshot.full_name}{row.contact_snapshot.company_name ? ` · ${row.contact_snapshot.company_name}` : ''} · {row.destination_country}</span>
        <span><time dateTime={row.created_at}>{quotationDate(row.created_at)}</time> (Dhaka)</span>
      </div>
      <AdminLink href={`/admin/rfqs/${row.id}`} className="button primary">Review request</AdminLink>
    </li>)}</ul> : <p className="admin-empty">No new website requests are awaiting review. Previously reviewed requests are in the RFQ inbox.</p>
      : <p className="muted">Website requests could not be loaded. Refresh requests to try again.</p>}
  </section>;
}
