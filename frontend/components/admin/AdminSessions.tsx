'use client';

import { useState, useRef } from 'react';
import { ApiError, apiRequest } from '../../lib/api-client';
import { revokeResult, sessionsSchema, type AdminSession } from '../../lib/admin-contract';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';
import { useAdminLive } from './AdminShell';

export function AdminSessions({ initial }: { initial: AdminSession[] }) {
  const { expire } = useAdminLive(); const [sessions, setSessions] = useState(initial); const [confirm, setConfirm] = useState(false); const [problem, setProblem] = useState<AdminFeedbackValue>(); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  async function run(revoke: boolean) {
    if (lock.current || revoke && !confirm) return; lock.current = true; setBusy(true); setProblem(undefined);
    try {
      if (revoke) { const result = await apiRequest('/v1/admin/auth/revoke-sessions', revokeResult, { method: 'POST', json: {}, timeoutMs: 15_000 }); setNotice(`${result.data.revoked_count} other session(s) revoked.`); setConfirm(false); }
      setSessions((await apiRequest('/v1/admin/auth/sessions', sessionsSchema, { timeoutMs: 10_000 })).data);
    } catch (error: unknown) { if (error instanceof ApiError && [401, 403].includes(error.status)) expire(); else setProblem(feedbackValue(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <><div className="admin-page-heading"><h1>Active sessions</h1><button className="button secondary" disabled={busy} onClick={() => void run(false)}>Check sessions</button></div>{problem && <AdminFeedback problem={problem}/>}<section className="admin-panel"><p className="muted">These full sessions were verified by the backend. Password verification alone does not grant console access.</p><div className="admin-session-list">{sessions.map((session) => <article key={session.id}><h2>{session.current ? 'Current session' : 'Other active session'}</h2><p>{session.ip_address}{session.geo.country ? ` · ${session.geo.country}` : ''}{session.geo.city ? ` · ${session.geo.city}` : ''}</p><p className="small muted">{session.user_agent ?? 'Device details unavailable'}</p><dl><dt>Last active</dt><dd><time dateTime={session.last_active_at}>{session.last_active_at.replace('T', ' ').slice(0, 19)} UTC</time></dd><dt>Verified expiry</dt><dd><time dateTime={session.expires_at}>{session.expires_at.replace('T', ' ').slice(0, 19)} UTC</time></dd></dl></article>)}</div>
      <div className="admin-revoke"><label><input type="checkbox" checked={confirm} disabled={busy} onChange={(event) => setConfirm(event.currentTarget.checked)}/>Revoke every other full session and pending password challenge.</label><button className="button primary" disabled={busy || !confirm} onClick={() => void run(true)}>Revoke other sessions</button></div>{notice && <p role="status">{notice}</p>}
      <p className="small muted">Use the authenticator enrolled during secure account setup. Authenticator rotation requires an authenticated admin session.</p>
    </section></>;
}
