'use client';

import { ApiError } from '../../lib/api-client';
export interface AdminFeedbackValue { status: number; requestId?: string; retryAfterSeconds?: number }
export function feedbackValue(error: unknown): AdminFeedbackValue {
  return error instanceof ApiError ? { status: error.status, requestId: /^[\w-]{1,100}$/.test(error.requestId ?? '') ? error.requestId : undefined, retryAfterSeconds: error.retryAfterSeconds } : { status: 503 };
}
export function AdminFeedback({ problem }: { problem: AdminFeedbackValue }) {
  return <div className="admin-feedback" role="alert" aria-label="Admin request feedback"><p>{problem.status === 401 ? 'Authentication was not confirmed. Check your credentials or sign in again.' : problem.status === 403 || problem.status === 429 ? 'This request is restricted. Wait before trying again.' : problem.status === 422 || problem.status === 400 ? 'Check the form fields and try again.' : 'The request could not be confirmed. Please try again or check your current session.'}</p>
    {problem.retryAfterSeconds !== undefined && <p>Retry after {problem.retryAfterSeconds} seconds.</p>}{problem.requestId && <p className="small">Request ID: {problem.requestId}</p>}</div>;
}
export function AdminUnavailable({ problem }: { problem: AdminFeedbackValue }) {
  return <section className="admin-panel"><h1>Admin service unavailable</h1><AdminFeedback problem={problem}/><button className="button secondary" onClick={() => window.location.reload()}>Reload this page</button></section>;
}
