import { requireAdminSession } from '../../../../../lib/admin-server';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
import { CatalogImport } from '../../../../../components/admin/CatalogImport';
export default async function ImportPage() {
  const auth = await requireAdminSession();
  return auth.ok ? <CatalogImport /> : <AdminUnavailable problem={auth.problem} />;
}
