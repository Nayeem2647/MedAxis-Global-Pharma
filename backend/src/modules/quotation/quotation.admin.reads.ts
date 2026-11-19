import { z } from 'zod';
import type { PipelineStage } from 'mongoose';
import { QuotationModel } from './quotation.schema.js';
import { uuid } from '../catalog/catalog.validator.js';
import { adminPage } from '../catalog/catalog.admin.reads.js';
export const quotationListQuery = z
  .object({
    ...adminPage,
    q: z.string().trim().min(1).max(100).optional(),
    rfq_id: uuid.optional(),
    overall_status: z.enum(['ACTIVE', 'COMPLETED', 'DECLINED', 'EXPIRED']).optional(),
    status: z
      .enum([
        'DRAFT',
        'SENT',
        'ACCEPTED',
        'PAYMENT_RECEIVED',
        'DISPATCHED',
        'DELIVERED',
        'DECLINED',
        'VALIDITY_EXPIRED',
        'SUPERSEDED',
        'PAYMENT_EXPIRED',
      ])
      .optional(),
    reservation_before: z.iso.datetime({ offset: true }).optional(),
    worklist: z.enum(['AWAITING_PAYMENT', 'READY_TO_DISPATCH', 'EXPIRING']).optional(),
  })
  .strict();
export const quotationSummaryQuery = z
  .object({ window_hours: z.coerce.number().int().min(1).max(168).default(24) })
  .strict();
const currentVersion: PipelineStage[] = [
  { $lookup: { from: 'quotation_versions', localField: 'current_version_id', foreignField: '_id', as: 'version' } },
  { $unwind: '$version' },
];
// Shared by the summary and directory so each card opens the same set of records.
export function quotationWorklists(now: Date, windowHours = 24) {
  const reserved = {
    $and: [
      { $eq: ['$version.status', 'ACCEPTED'] },
      { $eq: ['$version.reservation_status', 'ACTIVE'] },
      { $gt: ['$version.reservation_expires_at', now] },
    ],
  };
  return {
    AWAITING_PAYMENT: reserved,
    READY_TO_DISPATCH: {
      $and: [
        { $eq: ['$version.status', 'PAYMENT_RECEIVED'] },
        { $eq: ['$version.reservation_status', 'CONSUMED'] },
        { $ne: [{ $ifNull: ['$version.payment', null] }, null] },
      ],
    },
    EXPIRING: {
      $and: [reserved, { $lte: ['$version.reservation_expires_at', new Date(now.getTime() + windowHours * 3600000)] }],
    },
  };
}
export async function listQuotations(query: z.infer<typeof quotationListQuery>) {
  const parent: Record<string, unknown> = {};
  if (query.rfq_id) parent.rfq_id = query.rfq_id;
  if (query.overall_status) parent.overall_status = query.overall_status;
  if (query.worklist) parent.$and = [{ overall_status: 'ACTIVE' }];
  const filter: Record<string, unknown> = {};
  if (query.status) filter['version.status'] = query.status;
  if (query.reservation_before) filter['version.reservation_expires_at'] = { $lte: new Date(query.reservation_before) };
  if (query.worklist) filter.$expr = quotationWorklists(new Date())[query.worklist];
  if (query.q) {
    const term = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      'quotation_number',
      'rfq.rfq_number',
      'version.contact_snapshot.full_name',
      'version.contact_snapshot.company_name',
      'version.contact_snapshot.email',
    ].map((field) => ({ [field]: term }));
  }
  const rows = await QuotationModel.aggregate([
    { $match: parent },
    ...currentVersion,
    {
      $lookup: {
        from: 'rfqs',
        localField: 'rfq_id',
        foreignField: '_id',
        pipeline: [{ $project: { rfq_number: 1 } }],
        as: 'rfq',
      },
    },
    { $match: filter },
    {
      $facet: {
        items: [
          { $sort: { updated_at: -1, _id: -1 } },
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
          {
            $project: {
              _id: 1,
              quotation_number: 1,
              rfq_id: 1,
              rfq_number: { $arrayElemAt: ['$rfq.rfq_number', 0] },
              customer: {
                full_name: '$version.contact_snapshot.full_name',
                company_name: '$version.contact_snapshot.company_name',
                email: '$version.contact_snapshot.email',
              },
              current_version: 1,
              current_version_id: 1,
              overall_status: 1,
              created_at: 1,
              updated_at: 1,
              version: {
                status: '$version.status',
                billing_currency: '$version.billing_currency',
                total_amount: { $toString: '$version.total_amount' },
                valid_until: '$version.valid_until',
                reservation_status: '$version.reservation_status',
                reservation_expires_at: '$version.reservation_expires_at',
              },
            },
          },
        ],
        total: [{ $count: 'value' }],
      },
    },
  ]).option({ maxTimeMS: 10000 });
  const result = z
    .array(
      z.object({
        items: z.array(z.record(z.string(), z.unknown())),
        total: z.array(z.object({ value: z.number().int().nonnegative() })),
      }),
    )
    .parse(rows)[0];
  return { items: result?.items ?? [], total: result?.total[0]?.value ?? 0 };
}
export async function quotationSummary(windowHours: number) {
  const now = new Date();
  const worklists = quotationWorklists(now, windowHours);
  const rows = await QuotationModel.aggregate([
    { $match: { overall_status: 'ACTIVE' } },
    ...currentVersion,
    {
      $group: {
        _id: null,
        active_quotations: { $sum: 1 },
        drafts: { $sum: { $cond: [{ $eq: ['$version.status', 'DRAFT'] }, 1, 0] } },
        sent: { $sum: { $cond: [{ $eq: ['$version.status', 'SENT'] }, 1, 0] } },
        accepted_payment_pending: { $sum: { $cond: [worklists.AWAITING_PAYMENT, 1, 0] } },
        ready_to_dispatch: {
          $sum: {
            $cond: [worklists.READY_TO_DISPATCH, 1, 0],
          },
        },
        expiring_allocations: {
          $sum: { $cond: [worklists.EXPIRING, 1, 0] },
        },
      },
    },
  ]).option({ maxTimeMS: 10000 });
  const count = z.number().int().nonnegative();
  const schema = z.object({
    active_quotations: count,
    drafts: count,
    sent: count,
    accepted_payment_pending: count,
    ready_to_dispatch: count,
    expiring_allocations: count,
  });
  return {
    as_of: now,
    window_hours: windowHours,
    ...schema.parse(
      rows[0] ?? {
        active_quotations: 0,
        drafts: 0,
        sent: 0,
        accepted_payment_pending: 0,
        ready_to_dispatch: 0,
        expiring_allocations: 0,
      },
    ),
  };
}
