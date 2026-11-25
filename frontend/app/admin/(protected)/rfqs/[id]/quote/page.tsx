import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { guardedAdminRead } from '../../../../../../lib/admin-server';
import { adminFxSchema } from '../../../../../../lib/admin-contract';
import { rfqDetailSchema, settingsSchema } from '../../../../../../lib/admin-workflow';
import { FastQuoteCreate } from '../../../../../../components/admin/FastQuoteEditor';
import { AdminUnavailable } from '../../../../../../components/admin/AdminFeedback';
import { AdminLink } from '../../../../../../components/admin/AdminShell';
export default async function FastQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuidv4().safeParse((await params).id); if (!id.success) notFound();
  const [rfq, settings, fx] = await Promise.all([guardedAdminRead(`/v1/admin/rfqs/${id.data}`, rfqDetailSchema), guardedAdminRead('/v1/admin/settings', settingsSchema), guardedAdminRead('/v1/admin/fx-rates', adminFxSchema)]);
  if (!rfq.ok) return <AdminUnavailable problem={rfq.problem}/>; if (!settings.ok) return <AdminUnavailable problem={settings.problem}/>; if (!fx.ok) return <AdminUnavailable problem={fx.problem}/>;
  if (rfq.result.data.workflow?.enabled) redirect(`/admin/rfqs/${id.data}?action=1`);
  if (rfq.result.data.quotations.some((quote) => quote.overall_status === 'ACTIVE') || ['CLOSED', 'CANCELLED', 'CONVERTED'].includes(rfq.result.data.status)) return <section className="admin-panel"><h1>This RFQ cannot create another active draft</h1><AdminLink href={`/admin/rfqs/${id.data}`}>Review the current RFQ and quotations</AdminLink></section>;
  return <FastQuoteCreate rfq={rfq.result.data} settings={settings.result.data} fx={fx.result.data}/>;
}
