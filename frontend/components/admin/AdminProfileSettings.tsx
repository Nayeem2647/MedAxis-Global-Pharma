'use client';

import { useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { Camera, Eye, EyeOff, LockKeyhole, UserRound, UserRoundCog } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api-client';
import { adminProfileSchema, MAX_ADMIN_AVATAR_LENGTH, type AdminProfile } from '../../lib/admin-contract';
import { validateCatalogImage } from '../../lib/admin-management';
import { AdminLink } from './AdminShell';

function message(error: unknown) { return error instanceof ApiError ? error.message : 'Could not save changes. Please try again.'; }

async function preparePicture(file: File) {
  await validateCatalogImage(file);
  const bitmap = await createImageBitmap(file);
  try {
    const crop = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(crop, 384);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, size, size);
    const picture = canvas.toDataURL('image/jpeg', 0.85);
    if (!picture.startsWith('data:image/jpeg;base64,') || picture.length > MAX_ADMIN_AVATAR_LENGTH) throw new Error('Image conversion failed');
    return picture;
  } finally {
    bitmap.close();
  }
}

export function AdminProfileSettings({ initial }: { initial: AdminProfile }) {
  const [profile, setProfile] = useState(initial);
  const [avatar, setAvatar] = useState<string | null>(initial.avatar_url);
  const [busy, setBusy] = useState(false);
  const [preparingPicture, setPreparingPicture] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function choosePicture(file: File) {
    setPreparingPicture(true); setError(''); setNotice('');
    try {
      setAvatar(await preparePicture(file));
      setNotice('Picture ready. Select Save Changes to apply it.');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not read this picture. Choose another JPEG, PNG or WebP file.');
    } finally {
      setPreparingPicture(false);
      if (input.current) input.current.value = '';
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preparingPicture) return;
    setBusy(true); setError(''); setNotice('');
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const result = await apiRequest('/v1/admin/auth/profile', adminProfileSchema, { method: 'PATCH', json: {
        display_name: String(form.get('display_name') ?? '').trim(),
        phone_number: String(form.get('phone_number') ?? '').trim(),
        email: String(form.get('email') ?? '').trim().toLowerCase(),
        ...(avatar === profile.avatar_url ? {} : { avatar_url: avatar }),
        ...(String(form.get('current_password') ?? '') ? { current_password: String(form.get('current_password')) } : {}),
      } });
      setProfile(result.data); setAvatar(result.data.avatar_url); setNotice('Profile changes saved.');
      const password = element.elements.namedItem('current_password') as HTMLInputElement | null;
      if (password) password.value = '';
      window.dispatchEvent(new Event('admin-profile-updated'));
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordBusy(true); setPasswordError(''); setPasswordNotice('');
    const element = event.currentTarget;
    const form = new FormData(element);
    const current = String(form.get('current_password') ?? '');
    const next = String(form.get('new_password') ?? '');
    const confirm = String(form.get('confirm_password') ?? '');
    if (next !== confirm) { setPasswordError('New passwords do not match.'); setPasswordBusy(false); return; }
    try {
      await apiRequest('/v1/admin/auth/change-password', { parse: (value: unknown) => value as { changed: true } }, {
        method: 'POST', json: { current_password: current, new_password: next, confirm_password: confirm },
      });
      element.reset(); setPasswordNotice('Password changed. Other sessions have been signed out.');
    } catch (cause) { setPasswordError(message(cause)); }
    finally { setPasswordBusy(false); }
  }

  return <div className="admin-profile-page">
    <header className="admin-profile-heading"><h1><UserRoundCog size={24} />Profile Information</h1><AdminLink className="button primary" href="/admin">Dashboard</AdminLink></header>
    <div className="admin-profile-layout"><nav className="admin-profile-tabs" aria-label="Profile sections"><a href="#basic-information"><UserRoundCog size={20} />Basic Information</a><a href="#change-password"><LockKeyhole size={20} />Password</a><AdminLink href="/admin/settings">Platform settings</AdminLink></nav>
      <div className="admin-profile-panels">
        <section id="basic-information" className="admin-profile-card">
          <div className="admin-profile-cover" aria-hidden="true" />
          <div className="admin-profile-picture"><Image src={avatar || '/images/medaxis-logo.png'} alt="Current profile picture" width={118} height={118} unoptimized /><button type="button" aria-label="Change profile picture" disabled={preparingPicture || busy} onClick={() => input.current?.click()}><Camera size={20} /></button><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload profile picture" disabled={preparingPicture || busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void choosePicture(file); }} /></div>
          <h2><UserRound size={20} />Basic Information</h2>
          <form onSubmit={(event) => void saveProfile(event)}>
            <div className="admin-profile-fields"><label>Full Name <span aria-hidden="true">*</span><input name="display_name" required maxLength={120} defaultValue={profile.display_name || 'Admin'} autoComplete="name" /></label><label>Phone Number <small>(Optional)</small><input name="phone_number" type="tel" maxLength={25} defaultValue={profile.phone_number} autoComplete="tel" placeholder="+880..." /></label><label>Login Email (User ID) <span aria-hidden="true">*</span><input name="email" type="email" required maxLength={200} defaultValue={profile.email} autoComplete="email" /></label></div>
            <label className="admin-profile-current">Current password <small>(Required when changing login email)</small><input name="current_password" type="password" autoComplete="current-password" /></label>
            <div className="admin-profile-form-footer">{avatar && <button type="button" className="button secondary" disabled={busy || preparingPicture} onClick={() => { setAvatar(null); setNotice('Picture removed. Save profile changes to apply.'); }}>Remove picture</button>}<button className="button primary" disabled={busy || preparingPicture}>{busy ? 'Saving…' : 'Save Changes'}</button></div>
            {notice && <p role="status" className="admin-profile-success">{notice}</p>}{error && <p role="alert" className="form-error">{error}</p>}
          </form>
        </section>
        <section id="change-password" className="admin-profile-card admin-profile-password"><h2><LockKeyhole size={20} />Change Password</h2><form onSubmit={(event) => void savePassword(event)}><div className="admin-profile-fields"><label>Current Password <span aria-hidden="true">*</span><input type={showPassword ? 'text' : 'password'} name="current_password" required autoComplete="current-password" /></label><label>New Password <span aria-hidden="true">*</span><input type={showPassword ? 'text' : 'password'} name="new_password" required minLength={12} autoComplete="new-password" /></label><label>Confirm Password <span aria-hidden="true">*</span><input type={showPassword ? 'text' : 'password'} name="confirm_password" required minLength={12} autoComplete="new-password" /></label></div><div className="admin-profile-form-footer"><button type="button" className="button secondary" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}{showPassword ? 'Hide' : 'Show'}</button><button className="button primary" disabled={passwordBusy}>{passwordBusy ? 'Saving…' : 'Save Changes'}</button></div>{passwordNotice && <p role="status" className="admin-profile-success">{passwordNotice}</p>}{passwordError && <p role="alert" className="form-error">{passwordError}</p>}</form></section>
      </div>
    </div>
  </div>;
}
