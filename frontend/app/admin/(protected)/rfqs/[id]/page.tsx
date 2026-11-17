import { notFound } from 'next/navigation';
import { z } from 'zod';
import { guardedAdminRead } from '../../../../../lib/admin-server';
import { rfqDetailSchema } from '../../../../../lib/admin-workflow';
import { RfqWorkspace } from '../../../../../components/admin/RfqWorkspace';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) { const id = z.uuidv4().safeParse((await params).id); if (!id.success) notFound(); const data = await guardedAdminRead(`/v1/admin/rfqs/${id.data}`, rfqDetailSchema); if (!data.ok) { if (data.problem.status === 404) notFound(); return <AdminUnavailable problem={data.problem}/>; } return <RfqWorkspace initial={data.result.data}/>; }
