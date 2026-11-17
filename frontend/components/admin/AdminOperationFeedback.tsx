'use client';
import { AdminFeedback } from './AdminFeedback';
import type { OperationState } from '../../lib/admin-workflow';
export function AdminOperationFeedback({ state }: { state: OperationState }) { return <>{state.notice && <p className="admin-feedback" role="status">{state.notice}</p>}{state.problem && <><AdminFeedback problem={state.problem}/>{state.problem.fields.length > 0 && <p role="alert">Check: {state.problem.fields.join(', ')}</p>}</>}</>; }
