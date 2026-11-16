import type { ReactNode } from 'react';
import { requireAdminSession } from '../../../lib/admin-server';
import { AdminShell } from '../../../components/admin/AdminShell';
import { AdminUnavailable } from '../../../components/admin/AdminFeedback';
export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) { const auth = await requireAdminSession(); return auth.ok ? <AdminShell session={auth.current}>{children}</AdminShell> : <AdminUnavailable problem={auth.problem}/>; }
