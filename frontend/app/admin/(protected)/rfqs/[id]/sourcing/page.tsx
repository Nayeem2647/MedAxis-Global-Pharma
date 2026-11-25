import { notFound } from 'next/navigation';
import { z } from 'zod';
import { guardedAdminRead } from '../../../../../../lib/admin-server';
import { rfqDetailSchema } from '../../../../../../lib/admin-workflow';
import { AdminUnavailable } from '../../../../../../components/admin/AdminFeedback';
import { AdminLink } from '../../../../../../components/admin/AdminShell';
import { RfqWorkspace } from '../../../../../../components/admin/RfqWorkspace';

export default async function SourcingPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuidv4().safeParse((await params).id); if (!id.success) notFound();
  const result = await guardedAdminRead(`/v1/admin/rfqs/${id.data}`, rfqDetailSchema);
  if (!result.ok) return <AdminUnavailable problem={result.problem}/>;
  return <><AdminLink href={`/admin/rfqs/${id.data}`}>Return to quotation workflow</AdminLink><RfqWorkspace initial={result.result.data}/></>;
}
