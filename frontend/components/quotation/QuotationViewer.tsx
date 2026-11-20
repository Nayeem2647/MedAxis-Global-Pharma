'use client';

import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { LockKeyhole, MessageCircle, RefreshCw } from 'lucide-react';
import { QuotationSession, declineBody, refreshBody, revisionBody, type Decision, type QuotationInitial, type QuotationProblem } from '../../lib/quotation';
import type { ContactConfig } from '../../lib/public-config';
import { ContactDialog } from '../layout/ContactDialog';
import { QuotationDocument } from './QuotationDocument';
import { QuotationLanguage } from './QuotationLocale';
import { QuotationPdf } from './QuotationPdf';

function DecisionForm({ kind, disabled, problem, send }: { kind: Decision['kind']; disabled: boolean; problem: QuotationProblem | null; send(input: Decision): Promise<void> }) {
  const t = useTranslations('Quotation');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState<'PRICE' | 'LEAD_TIME' | 'SPECIFICATION' | 'OTHER'>('PRICE');
  const [invalid, setInvalid] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return;
    const optional = notes.trim() ? { notes: notes.trim() } : {};
    if (kind === 'request-revision') {
      const result = revisionBody.safeParse({ notes }); if (!result.success) { setInvalid(true); return; }
      setInvalid(false); await send({ kind, body: result.data });
    } else if (kind === 'request-refresh') {
      const result = refreshBody.safeParse(optional); if (!result.success) { setInvalid(true); return; }
      setInvalid(false); await send({ kind, body: result.data });
    } else {
      const result = declineBody.safeParse({ reason, ...optional }); if (!result.success) { setInvalid(true); return; }
      setInvalid(false); await send({ kind, body: result.data });
    }
  }
  const notesInvalid = invalid || problem?.fields.includes('notes');
  const label = kind === 'decline' ? 'decline' : kind === 'request-revision' ? 'revision' : 'refresh';
  return <details className="quotation-decision"><summary>{t(label)}</summary><form className="stack-form" onSubmit={submit}>
    <fieldset disabled={disabled}><legend className="sr-only">{t(label)}</legend>
      {kind === 'decline' && <label>{t('declineReason')}<select value={reason} onChange={(event) => { const parsed = declineBody.shape.reason.safeParse(event.currentTarget.value); if (parsed.success) setReason(parsed.data); }} aria-invalid={problem?.fields.includes('reason') || undefined}>
        {(['PRICE', 'LEAD_TIME', 'SPECIFICATION', 'OTHER'] as const).map((value) => <option key={value} value={value}>{t(`reason.${value}`)}</option>)}</select></label>}
      <label>{t(kind === 'request-revision' ? 'requiredNotes' : 'optionalNotes')}<textarea rows={3} value={notes} maxLength={kind === 'decline' ? 2000 : 5000} required={kind === 'request-revision'} onChange={(event) => setNotes(event.currentTarget.value)} aria-invalid={notesInvalid || undefined} aria-describedby={notesInvalid ? `${kind}-error` : undefined}/></label>
      {notesInvalid && <p className="form-error" id={`${kind}-error`} role="alert">{t('fieldInvalid')}</p>}
      <button type="submit" className="button secondary">{t(label)}</button>
    </fieldset>
  </form></details>;
}

export function QuotationViewer({ token, initial, contact }: { token?: string; initial: QuotationInitial; contact: ContactConfig }) {
  const t = useTranslations('Quotation');
  const [session] = useState(() => new QuotationSession(token ?? '', initial));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [interactive, setInteractive] = useState(false);
  const [terms, setTerms] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [pdfProblem, setPdfProblem] = useState<QuotationProblem | null>(null);
  useEffect(() => { setInteractive(true); }, []);
  useEffect(() => {
    if (!state.pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [state.pending]);
  const q = state.quotation;
  const locked = !interactive || state.busy || !!state.pending;
  const problem = state.problem ?? pdfProblem;
  const send = async (input: Decision) => { setPdfProblem(null); await session.decide(input); };
  return <>
    <header className="quotation-header"><div className="quotation-header-inner"><div className="quotation-brand"><Image src="/images/medaxis-logo.png" alt="MedAxis Global Pharma" width={818} height={196} unoptimized priority className="quotation-logo"/></div>
      <QuotationLanguage/><button type="button" className="button secondary" onClick={() => setContactOpen(true)}><MessageCircle size={17}/>{t('contact')}</button>
    </div></header>
    <main className="quotation-main"><div className="quotation-privacy"><LockKeyhole size={15}/><span>{t('privacy')}</span></div>
      <article className="quotation-paper" aria-busy={state.busy}>
        {q ? <QuotationDocument quotation={q}/> : <section className="quotation-error-state"><p className="eyebrow">{t('privateDocument')}</p><h1>{t(`errorTitle.${state.problem?.kind ?? 'unknown'}`)}</h1><p>{t(`errorHelp.${state.problem?.kind ?? 'unknown'}`)}</p></section>}
        {state.notice && <div role="status" className="quotation-notice"><p>{t(`notice.${state.notice}`)}</p></div>}
        {problem && <div className="quotation-recovery" role="alert">{q && <p>{t(`errorHelp.${problem.kind}`)}</p>}{problem.requestId && <p className="small">{t('requestId')}: {problem.requestId}</p>}</div>}
        {state.busy && <p className="small muted" role="status">{t('busy')}</p>}
        {q?.status === 'SENT' && token && <section className="quotation-actions"><h2>{t('decisionTitle')}</h2>
          <form onSubmit={(event) => { event.preventDefault(); if (interactive) { setPdfProblem(null); void session.accept(terms); } }}>
            <label className="quotation-terms"><input type="checkbox" checked={terms} disabled={!interactive || state.busy || !!state.pending && state.pending !== 'accept'} onChange={(event) => setTerms(event.currentTarget.checked)}/><span>{t('acceptTerms')}</span></label>
            <button type="submit" className="button primary" disabled={!interactive || !terms || state.busy || !!state.pending && state.pending !== 'accept'}>{t(state.pending === 'accept' ? 'retryAccept' : 'accept')}</button>
          </form>
          <div className="quotation-secondary-decisions"><DecisionForm kind="request-revision" disabled={locked || state.notice === 'revisionSent'} problem={state.problem} send={send}/><DecisionForm kind="decline" disabled={locked} problem={state.problem} send={send}/></div>
        </section>}
        {!q && state.problem?.kind === 'expired' && token && <DecisionForm kind="request-refresh" disabled={locked || state.notice === 'refreshSent'} problem={state.problem} send={send}/>}
        <div className="quotation-tools">{q && token && <QuotationPdf token={token} version={q.version_number} onProblem={(value) => { setPdfProblem(value); if (['expired', 'superseded', 'missing'].includes(value.kind)) void session.reload(); }}/>} 
          {token && <button type="button" className="button secondary" disabled={!interactive || state.busy} onClick={() => { setPdfProblem(null); void session.reload(); }}><RefreshCw size={17}/>{t('checkStatus')}</button>}
          <button type="button" className="button secondary" onClick={() => setContactOpen(true)}><MessageCircle size={17}/>{t('contact')}</button>
        </div>
        <p className="quotation-document-note small muted">{t('documentHelp')}</p>
      </article>
    </main>
    {contactOpen && <ContactDialog contact={contact} onClose={() => setContactOpen(false)}/>}
  </>;
}
