import { requireAdminSession } from '../../../../lib/admin-server';
import { AdminSessions } from '../../../../components/admin/AdminSessions';
import { AdminUnavailable } from '../../../../components/admin/AdminFeedback';
export default async function AdminSessionsPage() { const auth = await requireAdminSession(); return auth.ok ? <AdminSessions initial={auth.sessions}/> : <AdminUnavailable problem={auth.problem}/>; }
