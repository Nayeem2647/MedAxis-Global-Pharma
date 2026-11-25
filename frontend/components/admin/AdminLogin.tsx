'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LockKeyhole, Plus } from 'lucide-react';
import { apiRequest } from '../../lib/api-client';
import { backupBody, forgotPasswordBody, forgotPasswordResult, loginBody, loginResult, mfaResult, resetPasswordBody, resetPasswordResult, totpBody } from '../../lib/admin-contract';
import { AdminFeedback, feedbackValue, type AdminFeedbackValue } from './AdminFeedback';

export function AdminLogin() {
  const require2fa = process.env.NEXT_PUBLIC_ADMIN_REQUIRE_2FA !== 'false';
  const [stage, setStage] = useState<'password' | 'totp' | 'backup' | 'forgot' | 'reset'>('password');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState(''); const [newPassword, setNewPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [expires, setExpires] = useState<string>(); const [problem, setProblem] = useState<AdminFeedbackValue>(); const [busy, setBusy] = useState(false);
  const lock = useRef(false); const blockedUntil = useRef(0);
  const [localSignIn, setLocalSignIn] = useState(false);

  useEffect(() => {
    setLocalSignIn(['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname));
    const token = new URLSearchParams(window.location.search).get('reset')?.trim();
    if (token) {
      setResetToken(token);
      setStage('reset');
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || Date.now() < blockedUntil.current) return;
    const parsed = stage === 'password'
      ? loginBody.safeParse({ email, password })
      : stage === 'totp'
        ? totpBody.safeParse({ code })
        : stage === 'backup'
          ? backupBody.safeParse({ backup_code: code })
          : stage === 'forgot'
            ? forgotPasswordBody.safeParse({ email })
            : resetPasswordBody.safeParse({ token: resetToken, new_password: newPassword, confirm_password: confirmPassword });
    if (!parsed.success) { setProblem({ status: 422 }); return; }
    lock.current = true; setBusy(true); setProblem(undefined); setNotice('');
    try {
      if (stage === 'password') {
        const result = await apiRequest('/v1/admin/auth/login', loginResult, { method: 'POST', json: { email: email.trim(), password }, timeoutMs: 15_000 });
        setPassword(''); setCode('');
        if (result.data.requires_2fa) {
          setExpires(result.data.expires_at);
          setStage('totp');
        } else {
          window.location.replace('/admin');
        }
      } else if (stage === 'forgot') {
        await apiRequest('/v1/admin/auth/forgot-password', forgotPasswordResult, { method: 'POST', json: { email: email.trim() }, timeoutMs: 15_000 });
        setNotice('If the address matches the active admin account, look for “MedAxis Admin Password Reset” in that inbox or spam folder. The link expires after 15 minutes.');
      } else if (stage === 'reset') {
        await apiRequest('/v1/admin/auth/reset-password', resetPasswordResult, { method: 'POST', json: { token: resetToken, new_password: newPassword, confirm_password: confirmPassword }, timeoutMs: 15_000 });
        setNewPassword(''); setConfirmPassword(''); setResetToken('');
        window.history.replaceState({}, '', '/admin/login');
        setStage('password');
        setNotice('Password reset complete. Sign in with your new password.');
      } else {
        await apiRequest(`/v1/admin/auth/${stage === 'totp' ? 'verify-totp' : 'verify-backup-code'}`, mfaResult, { method: 'POST', json: stage === 'totp' ? { code } : { backup_code: code.trim() }, timeoutMs: 15_000 });
        setCode(''); window.location.replace('/admin');
      }
    } catch (error: unknown) { const value = feedbackValue(error); blockedUntil.current = Date.now() + (value.retryAfterSeconds ?? 0) * 1000; setProblem(value); }
    finally { lock.current = false; setBusy(false); }
  }

  const heading = stage === 'password'
    ? 'Sign in'
    : stage === 'forgot'
      ? 'Reset password'
      : stage === 'reset'
        ? 'Set a new password'
        : 'Complete two-factor verification';

  const subtitle = stage === 'password'
    ? (require2fa ? 'Use your admin account and enrolled authenticator.' : 'Use your admin email and password to sign in.')
    : stage === 'forgot'
      ? 'Enter the email registered to the admin account. Customer accounts use the reset form on the customer sign-in page.'
      : stage === 'reset'
        ? 'Choose a new password with at least 12 characters. All active sessions will be signed out.'
        : 'Enter a code from your enrolled authenticator, or use an unused backup code.';

  return <main className="admin-login"><div className="admin-login-brand"><span className="brand-mark"><Plus size={28}/></span><span>MedAxis Global Pharma</span></div><section className="admin-panel"><p className="admin-kicker"><LockKeyhole size={15}/> Private administration</p><h1>{heading}</h1>
    <p className="muted">{subtitle}</p>
    {stage === 'forgot' && localSignIn && <p className="small muted">Open the reset link on the computer running this local site. A localhost link on your phone opens the phone itself.</p>}
    <form className="stack-form" onSubmit={submit}><fieldset disabled={busy}>
      {stage === 'password' ? <><label>Email<input type="email" value={email} autoComplete="username" maxLength={200} required onChange={(event) => setEmail(event.currentTarget.value)}/></label><label>Password<input type="password" value={password} autoComplete="current-password" maxLength={1024} required onChange={(event) => setPassword(event.currentTarget.value)}/></label></>
        : stage === 'forgot' ? <label>Email<input type="email" value={email} autoComplete="username" maxLength={200} required onChange={(event) => setEmail(event.currentTarget.value)}/></label>
        : stage === 'reset' ? <><label>New Password<input type="password" value={newPassword} autoComplete="new-password" minLength={12} maxLength={1024} required onChange={(event) => setNewPassword(event.currentTarget.value)}/></label><label>Confirm Password<input type="password" value={confirmPassword} autoComplete="new-password" minLength={12} maxLength={1024} required onChange={(event) => setConfirmPassword(event.currentTarget.value)}/></label></>
        : <><label>{stage === 'totp' ? 'Authenticator code' : 'Backup code'}<input value={code} type="text" inputMode={stage === 'totp' ? 'numeric' : 'text'} autoComplete="one-time-code" minLength={stage === 'totp' ? 6 : 1} maxLength={stage === 'totp' ? 6 : 72} pattern={stage === 'totp' ? '[0-9]{6}' : undefined} required onChange={(event) => setCode(event.currentTarget.value)}/></label>
          {expires && <p className="small muted">Password verification expires at <time dateTime={expires}>{new Date(expires).toISOString().replace('T', ' ').slice(0, 19)} UTC</time>.</p>}</>}
      <button type="submit" className="button primary">{busy ? 'Verifying…' : stage === 'password' ? (require2fa ? 'Continue to authenticator' : 'Sign in') : stage === 'forgot' ? 'Send reset link' : stage === 'reset' ? 'Reset password' : 'Verify and sign in'}</button>
    </fieldset></form>
    {notice && <p role="status" className="admin-profile-success">{notice}</p>}
    {problem && (stage === 'reset' && problem.status === 401
      ? <div className="admin-feedback" role="alert"><p>This reset link is invalid, expired, or already used. Request a new link.</p><button type="button" className="text-button" onClick={() => { window.history.replaceState({}, '', '/admin/login'); setResetToken(''); setNewPassword(''); setConfirmPassword(''); setProblem(undefined); setStage('forgot'); }}>Request a new reset link</button></div>
      : <AdminFeedback problem={problem}/>)}
    {stage === 'password' && <div className="admin-login-alternatives"><button type="button" className="text-button" disabled={busy} onClick={() => { setPassword(''); setProblem(undefined); setNotice(''); setStage('forgot'); }}>Forgot password?</button></div>}
    {(stage === 'forgot' || stage === 'reset') && <div className="admin-login-alternatives"><button type="button" className="text-button" disabled={busy} onClick={() => { setProblem(undefined); setNotice(''); setStage('password'); }}>Back to sign in</button></div>}
    {(stage === 'totp' || stage === 'backup') && <div className="admin-login-alternatives"><button type="button" className="text-button" disabled={busy} onClick={() => { setCode(''); setProblem(undefined); setStage(stage === 'totp' ? 'backup' : 'totp'); }}>{stage === 'totp' ? 'Use a backup code' : 'Use the authenticator'}</button><button type="button" className="text-button" disabled={busy} onClick={() => { setCode(''); setProblem(undefined); setStage('password'); }}>Start again</button></div>}
  </section></main>;
}
