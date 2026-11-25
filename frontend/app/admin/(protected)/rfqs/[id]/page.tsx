import { notFound } from 'next/navigation';
import { z } from 'zod';
import { guardedAdminRead } from '../../../../../lib/admin-server';
import { settingsSchema, rfqDetailSchema } from '../../../../../lib/admin-workflow';
import { workflowDetail } from '../../../../../lib/rfq-workflow';
import { RfqWorkflowWorkspace } from '../../../../../components/admin/RfqWorkflowWorkspace';
import { RfqWorkspace } from '../../../../../components/admin/RfqWorkspace';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
export default async function RfqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const id = z.uuidv4().safeParse((await params).id); if (!id.success) notFound();
  const [data, settings, query] = await Promise.all([guardedAdminRead(`/v1/admin/rfq-workflow/${id.data}`, workflowDetail), guardedAdminRead('/v1/admin/settings', settingsSchema), searchParams]);
  if (!data.ok) {
    if (data.problem.status !== 404) return <AdminUnavailable problem={data.problem}/>;
    const legacy = await guardedAdminRead(`/v1/admin/rfqs/${id.data}`, rfqDetailSchema);
    if (!legacy.ok) { if (legacy.problem.status === 404) notFound(); return <AdminUnavailable problem={legacy.problem}/>; }
    return <RfqWorkspace initial={legacy.result.data}/>;
  }
  if (!data.result.data.rfq.workflow?.enabled && query.workflow !== '1') return <RfqWorkspace initial={data.result.data.rfq}/>;
  return <RfqWorkflowWorkspace initial={data.result.data} settings={settings.ok ? settings.result.data : null} initialAction={query.action === '1'}/>;
}
