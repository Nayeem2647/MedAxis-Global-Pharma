'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { customerRequest } from '../../lib/customer-api';
import { customerProfileSchema, type CustomerProfile } from '../../lib/customer-contract';
import { useCustomerAccount } from './CustomerAccountProvider';

export function CustomerProfileForm({ profile }: { profile: CustomerProfile }) {
  const t = useTranslations('Customer'); const account = useCustomerAccount(); const router = useRouter();
  const [buyer, setBuyer] = useState(profile.customer_type); const [busy, setBusy] = useState(false); const [problem, setProblem] = useState(''); const [notice, setNotice] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget); const read = (key: string) => String(data.get(key) ?? '').trim();
    setBusy(true); setProblem(''); setNotice('');
    try {
      await customerRequest('profile', customerProfileSchema, { method: 'PATCH', body: { full_name: read('full_name'), customer_type: buyer, company_name: read('company_name'), country: read('country').toUpperCase(), city: read('city'), whatsapp_number: read('whatsapp_number'), wechat_id: read('wechat_id'), preferred_locale: read('preferred_locale') } });
      setNotice(t('profileSaved')); await account.refresh();
    } catch { setProblem(t('saveFailed')); } finally { setBusy(false); }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget); const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirmation') ?? '')) { setProblem(t('passwordMismatch')); return; }
    setBusy(true); setProblem(''); setNotice('');
    try {
      await customerRequest('auth/change-password', z.object({ changed: z.boolean() }), { method: 'POST', body: { current_password: String(data.get('current_password') ?? ''), password } });
      await account.refresh(); router.replace(`/${profile.preferred_locale}/login`);
    } catch { setProblem(t('passwordChangeFailed')); } finally { setBusy(false); }
  }
  return <>
    <section className="customer-panel"><h2>{t('profile')}</h2><form className="stack-form" onSubmit={save}><fieldset disabled={busy} className="customer-form-fields">
      <label>{t('fullName')}<input name="full_name" required maxLength={200} defaultValue={profile.full_name} autoComplete="name"/></label>
      <label>{t('email')}<input type="email" value={profile.email} readOnly autoComplete="email"/></label>
      <div className="form-pair"><label>{t('buyerType')}<select value={buyer} onChange={(event) => setBuyer(event.target.value as typeof buyer)}><option value="B2C_PATIENT">{t('individual')}</option><option value="B2B_WHOLESALE">{t('business')}</option></select></label><label>{t('company')}<input name="company_name" required={buyer === 'B2B_WHOLESALE'} maxLength={200} defaultValue={profile.company_name} autoComplete="organization"/></label></div>
      <div className="form-pair"><label>{t('country')}<input name="country" required maxLength={2} minLength={2} pattern="[A-Za-z]{2}" defaultValue={profile.country} autoComplete="country"/></label><label>{t('city')}<input name="city" maxLength={100} defaultValue={profile.city} autoComplete="address-level2"/></label></div>
      <div className="form-pair"><label>{t('whatsapp')}<input name="whatsapp_number" maxLength={50} defaultValue={profile.whatsapp_number} autoComplete="tel"/></label><label>{t('wechat')}<input name="wechat_id" maxLength={100} defaultValue={profile.wechat_id}/></label></div>
      <label>{t('language')}<select name="preferred_locale" defaultValue={profile.preferred_locale}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
      <button className="button primary" type="submit">{t(busy ? 'working' : 'saveProfile')}</button>
    </fieldset></form></section>
    <section className="customer-panel"><h2>{t('changePassword')}</h2><form className="stack-form" onSubmit={changePassword}><fieldset disabled={busy} className="customer-form-fields">
      <label>{t('currentPassword')}<input name="current_password" type="password" required maxLength={1024} autoComplete="current-password"/></label>
      <label>{t('newPassword')}<input name="password" type="password" required minLength={12} maxLength={1024} autoComplete="new-password"/></label>
      <p className="customer-field-help">{t('passwordHelp')}</p><label>{t('confirmPassword')}<input name="confirmation" type="password" required minLength={12} maxLength={1024} autoComplete="new-password"/></label>
      <button className="button secondary" type="submit">{t(busy ? 'working' : 'savePassword')}</button>
    </fieldset></form></section>
    {problem && <p className="customer-feedback is-error" role="alert">{problem}</p>}{notice && <p className="customer-feedback" role="status">{notice}</p>}
  </>;
}
