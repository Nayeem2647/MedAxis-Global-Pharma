import { requireAdminSession } from '../../../../../lib/admin-server';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
import { AuthenticatorRotation } from '../../../../../components/admin/AuthenticatorRotation';
export default async function SecurityPage() {
  const auth = await requireAdminSession();
  return auth.ok ? <AuthenticatorRotation /> : <AdminUnavailable problem={auth.problem} />;
}
