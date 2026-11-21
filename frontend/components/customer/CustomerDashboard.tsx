'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { LayoutDashboard, UserRound, ClipboardList, Send, Files, MessageSquare, History, Plus, ArrowRight, MailCheck } from 'lucide-react';
import { z } from 'zod';
import { ApiError, paginationSchema } from '../../lib/api-client';
import { customerRequest } from '../../lib/customer-api';
import { customerDraftSchema, customerOverviewSchema, customerRfqSchema, customerQuoteSummarySchema, customerRevisionSchema, customerHistorySchema, accountQuotationSchema, type CustomerDraft } from '../../lib/customer-contract';
import { useCustomerAccount } from './CustomerAccountProvider';
import { CustomerDraftEditor } from './CustomerDraftEditor';
import { CustomerProfileForm } from './CustomerProfileForm';
import { CustomerQuotationDetails } from './CustomerQuotationDetails';
import type customerMessages from '../../messages/customer-en.json';

type Tab = 'overview' | 'profile' | 'drafts' | 'rfqs' | 'quotations' | 'revisions' | 'history';
const tabs = [{ key: 'overview', Icon: LayoutDashboard }, { key: 'profile', Icon: UserRound }, { key: 'drafts', Icon: ClipboardList }, { key: 'rfqs', Icon: Send }, { key: 'quotations', Icon: Files }, { key: 'revisions', Icon: MessageSquare }, { key: 'history', Icon: History }] as const;
type Rfq = z.infer<typeof customerRfqSchema>;
type Quotation = z.infer<typeof accountQuotationSchema>;
export function CustomerDashboard() {
  const t = useTranslations('Customer'); const locale = useLocale(); const router = useRouter(); const account = useCustomerAccount();
  const translatedStatus = useTranslations('Customer.statuses'); const translatedEvent = useTranslations('Customer.events');
  const [tab, setTab] = useState<Tab>('overview'); const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false); const [actionBusy, setActionBusy] = useState(false); const [problem, setProblem] = useState(''); const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState<z.infer<typeof customerOverviewSchema>>({ drafts: 0, rfqs: 0, quotations: 0, packaging_units: [] });
  const [drafts, setDrafts] = useState<CustomerDraft[]>([]); const [rfqs, setRfqs] = useState<Rfq[]>([]); const [quotes, setQuotes] = useState<z.infer<typeof customerQuoteSummarySchema>[]>([]);
  const [revisions, setRevisions] = useState<z.infer<typeof customerRevisionSchema>[]>([]); const [history, setHistory] = useState<z.infer<typeof customerHistorySchema>[]>([]);
  const [editor, setEditor] = useState<CustomerDraft | 'new' | null>(null); const [rfq, setRfq] = useState<Rfq | null>(null); const [quotation, setQuotation] = useState<Quotation | null>(null);
  const profile = account.profile;
  useEffect(() => { if (!account.loading && !profile) router.replace(`/${locale}/login`); }, [account.loading, profile, locale, router]);
  useEffect(() => {
    if (!profile || profile.email_verified) return;
    const url = new URL(window.location.href); const welcome = url.searchParams.get('welcome');
    if (welcome !== 'sent' && welcome !== 'pending') return;
    setNotice(t(welcome === 'sent' ? 'verificationSent' : 'emailUnavailable'));
    url.searchParams.delete('welcome');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  }, [profile, t]);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    if (!profile) return;
    const controller = new AbortController(); const options = { signal: controller.signal };
    const verified = profile.email_verified;
    async function load() {
      setBusy(true); setProblem('');
      try {
        setOverview((await customerRequest('overview', customerOverviewSchema, options)).data);
        let meta: unknown;
        const suffix = `?page=${page}&limit=20`;
        if (tab === 'drafts') { const result = await customerRequest(`drafts${suffix}`, z.array(customerDraftSchema), options); setDrafts(result.data); meta = result.meta.pagination; }
        else if (tab === 'rfqs' && verified) { const result = await customerRequest(`rfqs${suffix}`, z.array(customerRfqSchema), options); setRfqs(result.data); meta = result.meta.pagination; }
        else if (tab === 'quotations' && verified) { const result = await customerRequest(`quotations${suffix}`, z.array(customerQuoteSummarySchema), options); setQuotes(result.data); meta = result.meta.pagination; }
        else if (tab === 'revisions' && verified) { const result = await customerRequest(`revisions${suffix}`, z.array(customerRevisionSchema), options); setRevisions(result.data); meta = result.meta.pagination; }
        else if (tab === 'history' || tab === 'overview') { const result = await customerRequest(`history?page=${tab === 'overview' ? 1 : page}&limit=${tab === 'overview' ? 5 : 20}`, z.array(customerHistorySchema), options); setHistory(result.data); meta = result.meta.pagination; }
        const pagination = paginationSchema.safeParse(meta); setPages(pagination.success ? Math.max(1, pagination.data.total_pages) : 1);
      } catch (error) {
        if (!controller.signal.aborted) {
          if (error instanceof ApiError && error.status === 401) { await account.refresh(); router.replace(`/${locale}/login`); }
          else setProblem(t('loadFailed'));
        }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  // Account identity and verification govern access; profile form refreshes do not reset unsaved drafts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.email_verified, tab, page, reload]);
  function selectTab(value: Tab) { setTab(value); setPage(1); setPages(1); setEditor(null); setRfq(null); setQuotation(null); setProblem(''); setNotice(''); }
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
  const status = (value: string) => { const key = value as keyof typeof customerMessages.statuses; return translatedStatus.has(key) ? translatedStatus(key) : value.replaceAll('_', ' '); };
  const eventLabel = (value: string) => { const key = value as keyof typeof customerMessages.events; return translatedEvent.has(key) ? translatedEvent(key) : value.replaceAll('_', ' '); };
  async function resend() {
    if (actionBusy) return; setActionBusy(true); setProblem('');
    try { const result = await customerRequest('auth/resend-verification', z.object({ verification_sent: z.boolean(), already_verified: z.boolean() }), { method: 'POST', body: {} }); setNotice(t(result.data.verification_sent ? 'verificationSent' : result.data.already_verified ? 'verified' : 'emailUnavailable')); await account.refresh(); }
    catch { setProblem(t('unavailable')); } finally { setActionBusy(false); }
  }
  async function submitDraft(draft: CustomerDraft) {
    if (actionBusy || !profile?.email_verified) return; setActionBusy(true); setProblem(''); setNotice('');
    try { const result = await customerRequest(`drafts/${draft.id}/submit`, z.object({ rfq_id: z.uuid(), rfq_number: z.string(), replayed: z.boolean() }), { method: 'POST', body: {} }); setNotice(t('rfqSubmitted', { number: result.data.rfq_number })); refresh(); }
    catch { setProblem(t('submissionFailed')); refresh(); } finally { setActionBusy(false); }
  }
  async function deleteDraft(draft: CustomerDraft) {
    if (actionBusy || !window.confirm(t('deleteDraftConfirm'))) return; setActionBusy(true); setProblem('');
    try { await customerRequest(`drafts/${draft.id}`, z.object({ deleted: z.boolean() }), { method: 'DELETE', body: {} }); refresh(); }
    catch { setProblem(t('saveFailed')); } finally { setActionBusy(false); }
  }
  async function openRfq(id: string) { if (actionBusy) return; setActionBusy(true); setProblem(''); try { setRfq((await customerRequest(`rfqs/${id}`, customerRfqSchema)).data); } catch { setProblem(t('loadFailed')); } finally { setActionBusy(false); } }
  async function openQuote(id: string) { if (actionBusy) return; setActionBusy(true); setProblem(''); try { setQuotation((await customerRequest(`quotations/${id}`, accountQuotationSchema)).data); } catch { setProblem(t('loadFailed')); } finally { setActionBusy(false); } }
  if (account.loading || !profile) return <main id="main-content" className="section site-container"><p role="status">{t('loadingAccount')}</p></main>;
  const restricted = !profile.email_verified && ['rfqs', 'quotations', 'revisions'].includes(tab);
  function historyList() {
    return history.length ? <ol className="customer-history">{history.map((item) => <li key={`${item.kind}-${item.id}`}><span className="customer-history-dot"/><div><strong>{eventLabel(item.kind)}</strong>{item.label && <span>{item.label}{item.status ? ` · ${status(item.status)}` : ''}</span>}<time dateTime={item.created_at}>{date(item.created_at)}</time></div></li>)}</ol> : <p className="customer-empty">{t('emptyHistory')}</p>;
  }
  return <main id="main-content" className="customer-dashboard site-container">
    <header className="customer-dashboard-heading"><div><p className="eyebrow">{t('myAccount')}</p><h1>{t('welcome', { name: profile.full_name })}</h1><p>{t('dashboardIntro')}</p></div><Link className="button secondary" href={`/${locale}/products`}>{t('browseProducts')}<ArrowRight size={17}/></Link></header>
    <div className="customer-dashboard-layout"><aside className="customer-sidebar"><p className="customer-sidebar-email">{profile.email}</p><nav aria-label={t('accountNavigation')}>{tabs.map(({ key, Icon }) => <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => selectTab(key)}><Icon size={18} aria-hidden="true"/>{t(key)}</button>)}</nav></aside>
      <div className="customer-content">
        {!profile.email_verified && <div className="customer-verification-notice"><MailCheck size={23}/><div><strong>{t('verifyTitle')}</strong><p>{t('verificationRequired')}</p><button type="button" className="text-button" disabled={actionBusy} onClick={resend}>{t('resendVerification')}</button></div></div>}
        {problem && <div role="alert" className="customer-feedback is-error"><p>{problem}</p><button type="button" className="text-button" onClick={refresh}>{t('refresh')}</button></div>}{notice && <p role="status" className="customer-feedback">{notice}</p>}
        <div aria-busy={busy}>
          {busy && <p role="status" className="customer-loading">{t('working')}</p>}
          {tab === 'overview' && <><div className="customer-statistics">{(['drafts', 'rfqs', 'quotations'] as const).map((key) => <button type="button" key={key} onClick={() => selectTab(key)}><span>{t(key)}</span><strong>{overview[key]}</strong><ArrowRight size={17} aria-hidden="true"/></button>)}</div><section className="customer-panel"><div className="customer-section-heading"><h2>{t('recentHistory')}</h2><button type="button" className="text-button" onClick={() => selectTab('history')}>{t('viewAll')}</button></div>{historyList()}</section><button type="button" className="button primary" onClick={() => { selectTab('drafts'); setEditor('new'); }}><Plus size={18}/>{t('newDraft')}</button></>}
          {tab === 'profile' && <CustomerProfileForm key={profile.id} profile={profile}/>}
          {tab === 'drafts' && (editor ? <CustomerDraftEditor key={editor === 'new' ? 'new' : editor.id} draft={editor === 'new' ? undefined : editor} profile={profile} units={overview.packaging_units} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); setNotice(t('draftSaved')); refresh(); }}/>
            : <section className="customer-panel"><div className="customer-section-heading"><h2>{t('drafts')}</h2><button type="button" className="button primary" onClick={() => setEditor('new')}><Plus size={17}/>{t('newDraft')}</button></div>{drafts.length ? <ul className="customer-record-list">{drafts.map((draft) => <li key={draft.id}><div><h3>{draft.title}</h3><p>{t('itemCount', { count: draft.items.length })} · {draft.destination_country} · {date(draft.updated_at)}</p>{draft.rfq_number && <strong>{draft.rfq_number}</strong>}<span className="customer-status">{status(draft.status)}</span></div><div className="customer-record-actions">{draft.status === 'DRAFT' && <><button type="button" className="button secondary" disabled={actionBusy} onClick={() => setEditor(draft)}>{t('edit')}</button><button type="button" className="text-button customer-delete" disabled={actionBusy} onClick={() => deleteDraft(draft)}>{t('delete')}</button></>}{draft.status !== 'SUBMITTED' && <button type="button" className="button primary" disabled={actionBusy || !profile.email_verified} onClick={() => submitDraft(draft)}>{t(draft.status === 'SUBMITTING' ? 'retrySubmission' : 'submitRfq')}</button>}</div></li>)}</ul> : !busy && <p className="customer-empty">{t('emptyDrafts')}</p>}</section>)}
          {restricted && <section className="customer-panel"><p>{t('verificationRequired')}</p></section>}
          {tab === 'rfqs' && !restricted && (rfq ? <section className="customer-panel"><button type="button" className="text-button" onClick={() => setRfq(null)}>{t('backToRfqs')}</button><div className="customer-section-heading"><h2>{rfq.rfq_number}</h2><span className="customer-status">{status(rfq.status)}</span></div><p>{rfq.destination_country} · {rfq.preferred_currency} · {date(rfq.created_at)}</p><div className="customer-table-wrap"><table className="customer-table"><thead><tr><th>{t('medicine')}</th><th>{t('quantity')}</th><th>{t('status')}</th></tr></thead><tbody>{rfq.items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong>{item.strength && <span className="customer-muted-block">{item.strength}</span>}{item.notes && <span className="customer-muted-block">{item.notes}</span>}{item.customer_facing_note && <span className="customer-muted-block">{item.customer_facing_note}</span>}</td><td>{item.quantity} {item.packaging_unit}</td><td>{status(item.availability_status)}</td></tr>)}</tbody></table></div></section>
            : <section className="customer-panel"><h2>{t('rfqs')}</h2>{rfqs.length ? <ul className="customer-record-list">{rfqs.map((item) => <li key={item.id}><div><h3>{item.rfq_number}</h3><p>{t('itemCount', { count: item.items.length })} · {date(item.created_at)}</p><span className="customer-status">{status(item.status)}</span></div><button type="button" className="button secondary" disabled={actionBusy} onClick={() => openRfq(item.id)}>{t('viewDetails')}</button></li>)}</ul> : !busy && <p className="customer-empty">{t('emptyRfqs')}</p>}</section>)}
          {tab === 'quotations' && !restricted && (quotation ? <CustomerQuotationDetails quotation={quotation} onBack={() => setQuotation(null)} onRevision={refresh}/>
            : <section className="customer-panel"><h2>{t('quotations')}</h2>{quotes.length ? <ul className="customer-record-list">{quotes.map((item) => <li key={item.id}><div><h3>{item.quotation_number} <span className="customer-version">v{item.version_number}</span></h3><p>{item.billing_currency} {item.total_amount} · {t('validUntil')}: {date(item.valid_until)}</p><span className={`customer-status quotation-status is-${item.status.toLowerCase()}`}>{status(item.status)}</span></div><button type="button" className="button secondary" disabled={actionBusy} onClick={() => openQuote(item.id)}>{t('viewQuotation')}</button></li>)}</ul> : !busy && <p className="customer-empty">{t('emptyQuotations')}</p>}</section>)}
          {tab === 'revisions' && !restricted && <section className="customer-panel"><h2>{t('revisions')}</h2><p className="customer-field-help">{t('revisionsHelp')}</p>{revisions.length ? <ul className="customer-record-list">{revisions.map((item) => <li key={item.id}><div><h3>{item.quotation_number}</h3><p className="customer-request-notes">{item.body}</p><time dateTime={item.created_at}>{date(item.created_at)}</time></div><span className="customer-status">{t('requestRecorded')}</span></li>)}</ul> : !busy && <p className="customer-empty">{t('emptyRevisions')}</p>}</section>}
          {tab === 'history' && <section className="customer-panel"><h2>{t('history')}</h2>{historyList()}</section>}
          {tab !== 'overview' && tab !== 'profile' && !editor && !rfq && !quotation && !restricted && pages > 1 && <nav className="customer-pagination" aria-label={t('pagination')}><button type="button" className="button secondary" disabled={page <= 1 || busy} onClick={() => setPage((value) => value - 1)}>{t('previous')}</button><span>{t('pageOf', { page, pages })}</span><button type="button" className="button secondary" disabled={page >= pages || busy} onClick={() => setPage((value) => value + 1)}>{t('next')}</button></nav>}
        </div>
      </div>
    </div>
  </main>;
}
