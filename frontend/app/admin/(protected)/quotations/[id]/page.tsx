import { notFound } from 'next/navigation';
import { z } from 'zod';
import { guardedAdminRead } from '../../../../../lib/admin-server';
import { adminFxSchema } from '../../../../../lib/admin-contract';
import { quotationDetailSchema, rfqDetailSchema, settingsSchema } from '../../../../../lib/admin-workflow';
import { QuotationWorkspace } from '../../../../../components/admin/QuotationWorkspace';
import { AdminUnavailable } from '../../../../../components/admin/AdminFeedback';
export default async function QuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const id = z.uuidv4().safeParse((await params).id); if (!id.success) notFound(); const quotation = await guardedAdminRead(`/v1/admin/quotations/${id.data}`, quotationDetailSchema);
  if (!quotation.ok) { if (quotation.problem.status === 404) notFound(); return <AdminUnavailable problem={quotation.problem}/>; }
  const [rfq, settings, fx] = await Promise.all([guardedAdminRead(`/v1/admin/rfqs/${quotation.result.data.quotation.rfq_id}`, rfqDetailSchema), guardedAdminRead('/v1/admin/settings', settingsSchema), guardedAdminRead('/v1/admin/fx-rates', adminFxSchema)]);
  if (!rfq.ok) return <AdminUnavailable problem={rfq.problem}/>;
  return <QuotationWorkspace initial={quotation.result.data} initialRfq={rfq.result.data} initialSettings={settings.ok ? settings.result.data : null} initialFx={fx.ok ? fx.result.data : null}/>;
}
