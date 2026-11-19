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
