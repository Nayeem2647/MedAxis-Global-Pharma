'use client';

import { useRef, useState, type FormEvent } from 'react';
import { LockKeyhole, Plus } from 'lucide-react';
import { apiRequest } from '../../lib/api-client';
import { backupBody, loginBody, loginResult, mfaResult, totpBody } from '../../lib/admin-contract';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';

export function AdminLogin() {
  const [stage, setStage] = useState<'password' | 'totp' | 'backup'>('password');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [expires, setExpires] = useState<string>(); const [problem, setProblem] = useState<AdminFeedbackValue>(); const [busy, setBusy] = useState(false);
  const lock = useRef(false); const blockedUntil = useRef(0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || Date.now() < blockedUntil.current) return;
    const parsed = stage === 'password' ? loginBody.safeParse({ email, password }) : stage === 'totp' ? totpBody.safeParse({ code }) : backupBody.safeParse({ backup_code: code });
    if (!parsed.success) { setProblem({ status: 422 }); return; }
    lock.current = true; setBusy(true); setProblem(undefined);
    try {
      if (stage === 'password') {
        const result = await apiRequest('/v1/admin/auth/login', loginResult, { method: 'POST', json: { email: email.trim(), password }, timeoutMs: 15_000 });
        setPassword(''); setCode(''); setExpires(result.data.expires_at); setStage('totp');
      } else {
        await apiRequest(`/v1/admin/auth/${stage === 'totp' ? 'verify-totp' : 'verify-backup-code'}`, mfaResult, { method: 'POST', json: stage === 'totp' ? { code } : { backup_code: code.trim() }, timeoutMs: 15_000 });
        setCode(''); window.location.replace('/admin');
      }
    } catch (error: unknown) { const value = feedbackValue(error); blockedUntil.current = Date.now() + (value.retryAfterSeconds ?? 0) * 1000; setProblem(value); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main className="admin-login"><div className="admin-login-brand"><span className="brand-mark"><Plus size={28}/></span><span>MedAxis Global Pharma</span></div><section className="admin-panel"><p className="admin-kicker"><LockKeyhole size={15}/> Private administration</p><h1>{stage === 'password' ? 'Sign in' : 'Complete two-factor verification'}</h1>
    <p className="muted">{stage === 'password' ? 'Use your admin account and enrolled authenticator.' : 'Enter a code from your enrolled authenticator, or use an unused backup code.'}</p>
    <form className="stack-form" onSubmit={submit}><fieldset disabled={busy}>
      {stage === 'password' ? <><label>Email<input type="email" value={email} autoComplete="username" maxLength={200} required onChange={(event) => setEmail(event.currentTarget.value)}/></label><label>Password<input type="password" value={password} autoComplete="current-password" maxLength={1024} required onChange={(event) => setPassword(event.currentTarget.value)}/></label></>
        : <><label>{stage === 'totp' ? 'Authenticator code' : 'Backup code'}<input value={code} type="text" inputMode={stage === 'totp' ? 'numeric' : 'text'} autoComplete="one-time-code" minLength={stage === 'totp' ? 6 : 1} maxLength={stage === 'totp' ? 6 : 72} pattern={stage === 'totp' ? '[0-9]{6}' : undefined} required onChange={(event) => setCode(event.currentTarget.value)}/></label>
          {expires && <p className="small muted">Password verification expires at <time dateTime={expires}>{new Date(expires).toISOString().replace('T', ' ').slice(0, 19)} UTC</time>.</p>}</>}
      <button type="submit" className="button primary">{busy ? 'Verifying…' : stage === 'password' ? 'Continue to authenticator' : 'Verify and sign in'}</button>
    </fieldset></form>
    {problem && <AdminFeedback problem={problem}/>}
    {stage !== 'password' && <div className="admin-login-alternatives"><button type="button" className="text-button" disabled={busy} onClick={() => { setCode(''); setProblem(undefined); setStage(stage === 'totp' ? 'backup' : 'totp'); }}>{stage === 'totp' ? 'Use a backup code' : 'Use the authenticator'}</button><button type="button" className="text-button" disabled={busy} onClick={() => { setCode(''); setProblem(undefined); setStage('password'); }}>Start again</button></div>}
  </section></main>;
}
