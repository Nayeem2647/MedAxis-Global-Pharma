import { guardedAdminRead } from '../../../../../lib/admin-server';
import { adminProfileSchema } from '../../../../../lib/admin-contract';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
import { AdminProfileSettings } from '../../../../../components/admin/AdminProfileSettings';

export default async function ProfileSettingsPage() {
  const profile = await guardedAdminRead('/v1/admin/auth/profile', adminProfileSchema);
  return profile.ok ? <AdminProfileSettings initial={profile.result.data} /> : <AdminUnavailable problem={profile.problem} />;
}
