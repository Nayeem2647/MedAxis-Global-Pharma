'use client';
import { AdminFeedback } from './AdminFeedback';
import type { OperationState } from '../../lib/admin-workflow';
const fieldLabel = (field: string) => field === 'translations.en.slug' ? 'English page slug' : field === 'translations.zhCN.slug' ? 'Chinese page slug' : field;
export function AdminOperationFeedback({ state }: { state: OperationState }) {
  const duplicateSlug = state.problem?.code === 'CATALOG_SLUG_CONFLICT';
  return <>
    {state.notice && <p className="admin-feedback" role="status">{state.notice}</p>}
    {state.problem && <>
      {!duplicateSlug && <AdminFeedback problem={state.problem}/>}
      {state.problem.fields.length > 0 && <p role="alert">Check: {state.problem.fields.map(fieldLabel).join(', ')}</p>}
      {duplicateSlug && state.problem.requestId && <p className="small">Request ID: {state.problem.requestId}</p>}
    </>}
  </>;
}

export function InlineStatusNotice({ state, onRetry }: { state: OperationState; onRetry?(): void }) {
  if (state.notice.startsWith('Saved.')) {
    return <p className="admin-inline-status is-success" role="status">Status updated</p>;
  }
  if (state.problem) {
    return (
      <p className="admin-inline-status is-error" role="alert">
        Update failed
        {state.blocked && onRetry && (
          <> · <button type="button" className="admin-product-refresh" disabled={state.busy} onClick={onRetry}>Retry</button></>
        )}
      </p>
    );
  }
  return null;
}
