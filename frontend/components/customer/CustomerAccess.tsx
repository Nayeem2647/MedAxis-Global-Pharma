'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, FileText, LockKeyhole, Eye, EyeOff, History, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { ApiError } from '../../lib/api-client';
import { customerRequest } from '../../lib/customer-api';
import { customerRegistrationSchema, customerSessionSchema } from '../../lib/customer-contract';
import { buildCountryOptions, CountrySelect } from '../rfq/CountrySelect';
import { useCustomerAccount } from './CustomerAccountProvider';

export type CustomerAccessMode = 'login' | 'register' | 'forgot' | 'reset' | 'verify';
export function CustomerAccess({ mode }: { mode: CustomerAccessMode }) {
  const t = useTranslations('Customer'); const locale = useLocale(); const router = useRouter(); const account = useCustomerAccount();
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [showPassword, setShowPassword] = useState(false); const [buyerType, setBuyerType] = useState('B2C_PATIENT');
  const [country, setCountry] = useState('');
  const countryOptions = useMemo(() => buildCountryOptions(locale), [locale]);
  const [problem, setProblem] = useState(''); const [notice, setNotice] = useState(''); const [token, setToken] = useState(''); const [completed, setCompleted] = useState(false);
  const capturedMode = useRef<string | null>(null);
  useEffect(() => { setReady(true); }, []);
  useEffect(() => {
    if (mode !== 'verify' && mode !== 'reset') return;
    if (capturedMode.current === mode) return;
    capturedMode.current = mode;
    const value = window.location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(value)) setToken(value);
    else setProblem(t('invalidLink'));
    window.history.replaceState({}, '', window.location.pathname);
  }, [mode, t]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget); const read = (name: string) => String(data.get(name) ?? '').trim();
    const password = String(data.get('password') ?? '');
    if (mode === 'register' || mode === 'reset') {
      if (password.length < 4) { setProblem(t('passwordHelp')); return; }
      if (password !== String(data.get('confirm_password') ?? '')) { setProblem(t('passwordMismatch')); return; }
    }
    setBusy(true); setProblem(''); setNotice('');
    try {
      if (mode === 'register') {
        const resolvedCountry = (country || read('country')).toUpperCase();
        if (!/^[A-Z]{2}$/.test(resolvedCountry)) { setProblem(t('checkFields')); setBusy(false); return; }
        const result = await customerRequest('auth/register', customerRegistrationSchema, { method: 'POST', body: { email: read('email'), password, full_name: read('full_name'), customer_type: buyerType, ...(buyerType === 'B2B_WHOLESALE' ? { company_name: read('company_name') } : {}), country: resolvedCountry, preferred_locale: locale } });
        await account.refresh(); router.replace(`/${locale}/account?welcome=${result.data.verification_sent ? 'sent' : 'pending'}`);
      } else if (mode === 'login') {
        await customerRequest('auth/login', customerSessionSchema, { method: 'POST', body: { email: read('email'), password } });
        await account.refresh(); router.replace(`/${locale}/account`);
      } else if (mode === 'forgot') {
        const result = await customerRequest('auth/forgot-password', z.object({ requested: z.literal(true), email_delivery_available: z.boolean() }), { method: 'POST', body: { email: read('email') } });
        setNotice(t(result.data.email_delivery_available ? 'resetSent' : 'emailUnavailable'));
      } else if (mode === 'verify') {
        await customerRequest('auth/verify-email', z.object({ verified: z.literal(true) }), { method: 'POST', body: { token } });
        await account.refresh(); setCompleted(true); setNotice(t('verified'));
      } else {
        await customerRequest('auth/reset-password', z.object({ reset: z.literal(true) }), { method: 'POST', body: { token, password } });
        await account.refresh(); setCompleted(true); setNotice(t('resetComplete'));
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 503;
      setProblem(t(status === 401 ? 'invalidCredentials' : status === 409 ? 'accountExists' : status === 429 ? 'tooManyAttempts' : (mode === 'reset' || mode === 'verify') && status === 400 ? 'invalidLink' : status === 422 ? 'checkFields' : 'unavailable'));
    } finally { setBusy(false); }
  }
  const title = t(mode === 'login' ? 'loginTitle' : mode === 'register' ? 'registerTitle' : mode === 'verify' ? 'verifyTitle' : mode === 'reset' ? 'resetTitle' : 'forgotTitle');
  return <main id="main-content" className="customer-access site-container">
    <div className="customer-access-intro"><p className="eyebrow">MEDAXIS GLOBAL PHARMA</p><h1>{title}</h1><p>{t('accountIntro')}</p><ul><li><FileText size={20}/>{t('trackRequests')}</li><li><History size={20}/>{t('quoteHistory')}</li><li><ShieldCheck size={20}/>{t('privateAccount')}</li></ul><Link href={`/${locale}/products`}>{t('continueBrowsing')}</Link></div>
    <section className="customer-access-form" aria-label={title}>
      <div className="customer-access-heading"><LockKeyhole size={22}/><h2>{title}</h2></div>
      {completed ? <div className="customer-access-complete"><CheckCircle2 size={32}/><p role="status">{notice}</p><Link className="button primary" href={`/${locale}/${account.profile && mode === 'verify' ? 'account' : 'login'}`}>{t(account.profile && mode === 'verify' ? 'openDashboard' : 'signIn')}</Link></div> : <form method="post" onSubmit={submit} className="stack-form">
        <fieldset disabled={busy || !ready} className="customer-form-fields">
          {mode === 'register' && <><label>{t('fullName')}<input name="full_name" autoComplete="name" required maxLength={200}/></label>
            <div className="form-pair"><label>{t('buyerType')}<select value={buyerType} onChange={(event) => setBuyerType(event.target.value)}><option value="B2C_PATIENT">{t('individual')}</option><option value="B2B_WHOLESALE">{t('business')}</option></select></label><div className="customer-field"><label htmlFor="register-country">{t('country')}</label><CountrySelect id="register-country" name="country" value={country} options={countryOptions} placeholder={t('selectCountry')} emptyLabel={t('noCountryMatch')} required disabled={busy || !ready} onChange={setCountry} /></div></div>
            {buyerType === 'B2B_WHOLESALE' && <label>{t('company')}<input name="company_name" autoComplete="organization" required maxLength={200}/></label>}
          </>}
          {(mode === 'register' || mode === 'login' || mode === 'forgot') && <label>{t('email')}<input name="email" type="email" autoComplete="email" required maxLength={200}/></label>}
          {(mode === 'register' || mode === 'login' || mode === 'reset') && <>
            <label>{t(mode === 'reset' ? 'newPassword' : 'password')}<span className="customer-password-field"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 4} maxLength={1024}/><button type="button" aria-label={t(showPassword ? 'hidePassword' : 'showPassword')} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></span></label>
            {mode !== 'login' && <><p className="customer-field-help">{t('passwordHelp')}</p><label>{t('confirmPassword')}<input name="confirm_password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={4} maxLength={1024}/></label></>}
          </>}
          {mode === 'verify' && <p>{t('verifyIntro')}</p>}
          {problem && <p className="customer-feedback is-error" role="alert">{problem}</p>}
          {notice && <p className="customer-feedback" role="status">{notice}</p>}
          <button type="submit" className="button primary" disabled={busy || (mode === 'verify' || mode === 'reset') && !token}>{busy ? t('working') : t(mode === 'login' ? 'signIn' : mode === 'register' ? 'createAccount' : mode === 'verify' ? 'verifyEmail' : mode === 'reset' ? 'savePassword' : 'sendReset')}</button>
        </fieldset>
      </form>}
      <div className="customer-access-links">{mode === 'login' ? <><Link href={`/${locale}/account/forgot`}>{t('forgotPassword')}</Link><span>{t('noAccount')} <Link href={`/${locale}/register`}>{t('createAccount')}</Link></span></> : <Link href={`/${locale}/login`}>{t('backToLogin')}</Link>}</div>
    </section>
  </main>;
}
