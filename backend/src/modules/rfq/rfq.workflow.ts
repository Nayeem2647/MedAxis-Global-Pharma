import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession, type PipelineStage } from 'mongoose';
import type { Request } from 'express';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/errors/AppError.js';
import { hashToken } from '../../shared/utils/crypto.js';
import { Exact, amount } from '../../shared/utils/decimal.js';
import { escapeRegex } from '../../shared/utils/content.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { decimalInput, reviseQuoteSchema } from '../../shared/validators/quotation.validator.js';
import { RfqModel, type IRfq } from './rfq.schema.js';
import { newGuestAccess, resolveBuyerRfq, type BuyerRfqAccess } from './rfq.guest-access.js';
import { canonicalPayload } from './rfq.intake.service.js';
import { enqueueRfqEmail } from './rfq.outbox.js';
import { rfqEvents } from './rfq.events.js';
import { createRfqAdminService } from './rfq.admin.service.js';
import { QuotationModel, QuotationVersionModel, QuotationInternalCostModel } from '../quotation/quotation.schema.js';
import { commercialQuotation } from '../quotation/quotation.dto.js';
import { createQuotationService, type QuotationHooks } from '../quotation/quotation.service.js';
import { queueAdminEmail, queueLifecycleEmail, versionConflict } from '../quotation/quotation.lifecycle.js';
import type { FxService } from '../fx/fx.service.js';
import { ProductModel } from '../catalog/catalog.schema.js';
import { NotificationLogModel } from '../notification/notification.schema.js';

const uuid = z.uuidv4();
const text = z.string().trim().min(1).max(5000);
export const workflowStatuses = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'SENT',
  'CHANGE_REQUESTED',
  'REVISED',
  'COUNTEROFFER',
  'RETAINED',
  'APPROVED',
  'AWAITING_PAYMENT',
  'PAID',
  'DISPATCHED',
  'COMPLETED',
  'DECLINED',
  'CLOSED',
  'EXPIRED',
] as const;
export const ledgerQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  status: z.enum(workflowStatuses).optional(),
  queue: z.enum(['ALL', 'REVIEW', 'CUSTOMER', 'NEGOTIATION', 'PAYMENT', 'SHIPPING', 'HISTORY']).default('ALL'),
  scope: z.enum(['ACTIVE', 'HISTORY']).default('ACTIVE'),
});
export const reviewBody = z.strictObject({
  expected_updated_at: z.iso.datetime({ offset: true }),
  items: z
    .array(
      z
        .strictObject({
          id: uuid,
          availability: z.enum(['AVAILABLE', 'UNAVAILABLE', 'SOURCING']),
          note: z.string().trim().max(2000).optional(),
        })
        .superRefine((line, ctx) => {
          if (line.availability === 'UNAVAILABLE' && !line.note)
            ctx.addIssue({ code: 'custom', path: ['note'], message: 'Explain unavailable medicines to the customer.' });
        }),
    )
    .min(1)
    .max(100),
});
export const negotiateBody = z
  .strictObject({
    expected_version_id: uuid,
    operation_id: uuid,
    scope: z.enum(['MEDICINE', 'DELIVERY', 'BOTH']),
    body: text,
    proposed_medicine_subtotal: decimalInput.optional(),
    proposed_delivery_charge: decimalInput.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.scope === 'MEDICINE' && value.proposed_delivery_charge !== undefined) ||
      (value.scope === 'DELIVERY' && value.proposed_medicine_subtotal !== undefined)
    )
      ctx.addIssue({ code: 'custom', path: ['scope'], message: 'Proposed amounts must match the requested change.' });
    if (value.proposed_medicine_subtotal !== undefined && !new Exact(value.proposed_medicine_subtotal).gt(0))
      ctx.addIssue({
        code: 'custom',
        path: ['proposed_medicine_subtotal'],
        message: 'Medicine subtotal must be positive.',
      });
  });
export const responseBody = z.strictObject({
  expected_version_id: uuid,
  request_id: uuid,
  operation_id: uuid,
  mode: z.enum(['ACCEPT', 'COUNTEROFFER', 'RETAINED']),
  body: text,
  prices: z
    .array(z.strictObject({ rfq_item_id: uuid, selling_price: decimalInput }))
    .max(100)
    .optional(),
  delivery_charge: decimalInput.optional(),
  validity_days: z.number().int().min(1).max(365).default(7),
});
export const paymentRequestBody = z.strictObject({ expected_version_id: uuid });
export const guestLinkBody = z.strictObject({ action: z.enum(['REISSUE', 'REVOKE']) });

export function workflowStatus(
  rfq: Pick<IRfq, 'status' | 'workflow'>,
  version?: { status: string; payment_requested_at?: Date; valid_until?: Date } | null,
): (typeof workflowStatuses)[number] {
  if (version?.status === 'DELIVERED') return 'COMPLETED';
  if (version?.status === 'DECLINED') return 'DECLINED';
  if (['CLOSED', 'CANCELLED'].includes(rfq.status)) return 'CLOSED';
  if (version?.status === 'DISPATCHED') return 'DISPATCHED';
  if (version?.status === 'PAYMENT_RECEIVED') return 'PAID';
  if (version?.status === 'ACCEPTED') return version.payment_requested_at ? 'AWAITING_PAYMENT' : 'APPROVED';
  if (
    version &&
    (['VALIDITY_EXPIRED', 'PAYMENT_EXPIRED'].includes(version.status) ||
      (version.status === 'SENT' && version.valid_until && version.valid_until <= new Date()))
  )
    return 'EXPIRED';
  if (version?.status === 'SENT')
    return rfq.workflow?.pending_request_id ? 'CHANGE_REQUESTED' : (rfq.workflow?.offer_state ?? 'SENT');
  return rfq.workflow?.reviewed_at || rfq.status === 'UNDER_REVIEW' || rfq.status === 'QUOTED'
    ? 'UNDER_REVIEW'
    : 'SUBMITTED';
}

export function createRfqWorkflow(env: AppEnv, fx: FxService, logger: AppLogger, hooks: QuotationHooks = {}) {
  const quotes = createQuotationService(env, fx, logger, hooks);
  const signals = { notifications: () => undefined, submitted: () => undefined };
  const admin = createRfqAdminService(signals);
  function notify(id: string) {
    rfqEvents.emit('WORKFLOW_CHANGED', { rfq_id: id, changed_at: new Date().toISOString() });
    void Promise.resolve()
      .then(() => hooks.dispatchNotifications?.())
      .catch(() => logger.warn('Workflow notification delivery deferred'));
  }
  async function audit(req: Request, id: string, action: string, session: ClientSession) {
    await writeAuditLog(
      req,
      {
        actor_type: req.admin ? 'SUPER_ADMIN' : 'BUYER',
        actor_id: req.admin?.id,
        action,
        entity_type: 'rfqs',
        entity_id: id,
      },
      session,
    );
  }
  async function current(id: string, session?: ClientSession, customerId?: string) {
    const quote = await QuotationModel.findOne({ rfq_id: id, ...(customerId ? { customer_id: customerId } : {}) })
      .sort({ created_at: -1, _id: -1 })
      .session(session ?? null)
      .lean();
    const version = quote
      ? await QuotationVersionModel.findOne({ _id: quote.current_version_id, quotation_id: quote._id })
          .session(session ?? null)
          .lean()
      : null;
    return { quote, version };
  }
  async function detail(id: string) {
    const [rfq, offer] = await Promise.all([admin.detail(id), current(id)]);
    const products = await ProductModel.find({
      _id: { $in: rfq.items.flatMap((line) => (line.product_id ? [line.product_id] : [])) },
    })
      .select({ _id: 1, manufacturer_id: 1, strength: 1, dosage_form: 1, pack_size: 1, cold_chain_required: 1 })
      .lean();
    const quotation = offer.quote ? await quotes.detail(offer.quote._id) : null;
    const email_delivery = await NotificationLogModel.find({
      kind: 'EMAIL',
      $or: [
        { entity_type: 'rfqs', entity_id: id },
        {
          entity_type: 'quotation_versions',
          entity_id: { $in: quotation?.versions.map((version) => version.id) ?? [] },
        },
      ],
    })
      .select({ _id: 1, template_id: 1, status: 1, attempt_count: 1, next_retry_at: 1, sent_at: 1, created_at: 1 })
      .sort({ created_at: -1, _id: -1 })
      .limit(10)
      .lean();
    return {
      rfq,
      catalog_products: products,
      quotation,
      email_delivery,
      workflow_status: workflowStatus(rfq, offer.version),
    };
  }
  async function ledger(query: z.infer<typeof ledgerQuery>) {
    const match: Record<string, unknown> = {};
    if (query.country) match.destination_country = query.country;
    if (query.q)
      match.$or = ['rfq_number', 'contact_snapshot.full_name', 'contact_snapshot.company_name'].map((field) => ({
        [field]: { $regex: escapeRegex(query.q!), $options: 'i' },
      }));
    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $lookup: {
          from: 'quotations',
          let: { rfq: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$rfq_id', '$$rfq'] } } },
            { $sort: { created_at: -1, _id: -1 } },
            { $limit: 1 },
            { $project: { current_version_id: 1, overall_status: 1 } },
          ],
          as: 'quotes',
        },
      },
      { $set: { quote: { $first: '$quotes' } } },
      {
        $lookup: {
          from: 'quotation_versions',
          localField: 'quote.current_version_id',
          foreignField: '_id',
          pipeline: [{ $project: { status: 1, payment_requested_at: 1, valid_until: 1 } }],
          as: 'versions',
        },
      },
      { $set: { version: { $first: '$versions' } } },
      {
        $set: {
          workflow_status: {
            $switch: {
              branches: [
                { case: { $eq: ['$version.status', 'DELIVERED'] }, then: 'COMPLETED' },
                { case: { $eq: ['$version.status', 'DECLINED'] }, then: 'DECLINED' },
                { case: { $in: ['$status', ['CLOSED', 'CANCELLED']] }, then: 'CLOSED' },
                { case: { $eq: ['$version.status', 'DISPATCHED'] }, then: 'DISPATCHED' },
                { case: { $eq: ['$version.status', 'PAYMENT_RECEIVED'] }, then: 'PAID' },
                {
                  case: { $eq: ['$version.status', 'ACCEPTED'] },
                  then: {
                    $cond: [{ $ifNull: ['$version.payment_requested_at', false] }, 'AWAITING_PAYMENT', 'APPROVED'],
                  },
                },
                {
                  case: {
                    $or: [
                      { $in: ['$version.status', ['VALIDITY_EXPIRED', 'PAYMENT_EXPIRED']] },
                      { $and: [{ $eq: ['$version.status', 'SENT'] }, { $lte: ['$version.valid_until', new Date()] }] },
                    ],
                  },
                  then: 'EXPIRED',
                },
                {
                  case: { $eq: ['$version.status', 'SENT'] },
                  then: {
                    $cond: [
                      { $ifNull: ['$workflow.pending_request_id', false] },
                      'CHANGE_REQUESTED',
                      { $ifNull: ['$workflow.offer_state', 'SENT'] },
                    ],
                  },
                },
                {
                  case: {
                    $or: [
                      { $ifNull: ['$workflow.reviewed_at', false] },
                      { $in: ['$status', ['UNDER_REVIEW', 'QUOTED']] },
                    ],
                  },
                  then: 'UNDER_REVIEW',
                },
              ],
              default: 'SUBMITTED',
            },
          },
        },
      },
    ];
    const closed = ['COMPLETED', 'DECLINED', 'CLOSED'];
    const queueStatuses: Record<string, string[]> = {
      REVIEW: ['SUBMITTED', 'UNDER_REVIEW'],
      CUSTOMER: ['SENT', 'REVISED', 'COUNTEROFFER', 'RETAINED', 'EXPIRED'],
      NEGOTIATION: ['CHANGE_REQUESTED'],
      PAYMENT: ['APPROVED', 'AWAITING_PAYMENT'],
      SHIPPING: ['PAID', 'DISPATCHED'],
      HISTORY: closed,
    };
    const selected: Record<string, unknown> = {
      workflow_status: query.scope === 'HISTORY' || query.queue === 'HISTORY' ? { $in: closed } : { $nin: closed },
    };
    if (query.queue !== 'ALL' && query.queue !== 'HISTORY')
      selected.$and = [{ workflow_status: { $in: queueStatuses[query.queue] } }];
    if (query.status)
      selected.$and = [...((selected.$and as Record<string, unknown>[]) ?? []), { workflow_status: query.status }];
    pipeline.push({
      $facet: {
        rows: [
          { $match: selected },
          { $sort: { created_at: -1, _id: -1 } },
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
          {
            $lookup: {
              from: 'prescriptions',
              localField: '_id',
              foreignField: 'rfq_id',
              pipeline: [{ $project: { attachment_kind: 1, mime_type: 1, purge_status: 1 } }],
              as: 'attachments',
            },
          },
          {
            $project: {
              _id: 1,
              rfq_number: 1,
              contact_snapshot: { full_name: 1, company_name: 1, customer_type: 1 },
              destination_country: 1,
              has_prescription: 1,
              created_at: 1,
              workflow_status: 1,
              reviewed_at: '$workflow.reviewed_at',
              quotation_id: '$quote._id',
              attachments: 1,
            },
          },
        ],
        total: [{ $match: selected }, { $count: 'count' }],
        stats: [{ $group: { _id: '$workflow_status', count: { $sum: 1 } } }],
      },
    });
    const result = await RfqModel.aggregate<{
      rows: unknown[];
      total: { count: number }[];
      stats: { _id: string; count: number }[];
    }>(pipeline).option({ maxTimeMS: 10000 });
    const stats = result[0]?.stats ?? [];
    const count = (values: string[]) =>
      stats.filter((row) => values.includes(row._id)).reduce((sum, row) => sum + row.count, 0);
    return {
      rows: result[0]?.rows ?? [],
      total: result[0]?.total[0]?.count ?? 0,
      summary: {
        open_requests: stats.filter((row) => !closed.includes(row._id)).reduce((sum, row) => sum + row.count, 0),
        awaiting_customer: count(['SENT', 'REVISED', 'COUNTEROFFER', 'RETAINED']),
        payment_followup: count(['APPROVED', 'AWAITING_PAYMENT']),
        completed: count(['COMPLETED']),
      },
    };
  }
  async function review(req: Request, id: string, input: z.infer<typeof reviewBody>) {
    const result = await mongoose.connection.transaction(async (session) => {
      const rfq = await RfqModel.findById(id).session(session).lean();
      if (!rfq) throw AppError.notFound();
      if (
        !['SUBMITTED', 'UNDER_REVIEW', 'NEED_CLARIFICATION'].includes(rfq.status) ||
        rfq.updated_at.getTime() !== Date.parse(input.expected_updated_at)
      )
        throw AppError.conflict('Request changed. Refresh the review.');
      if (
        new Set(input.items.map((line) => line.id)).size !== rfq.items.length ||
        input.items.length !== rfq.items.length ||
        input.items.some((line) => !rfq.items.some((source) => source._id === line.id))
      )
        throw AppError.validation([{ field: 'items', issue: 'Review every medicine exactly once.' }]);
      const items = rfq.items.map((line) => {
        const reviewed = input.items.find((item) => item.id === line._id)!;
        return {
          ...line,
          item_availability_status: reviewed.availability,
          customer_facing_note: reviewed.note || undefined,
        };
      });
      await RfqModel.updateOne(
        { _id: id, updated_at: rfq.updated_at },
        {
          $set: {
            items,
            status: 'UNDER_REVIEW',
            'workflow.enabled': true,
            'workflow.reviewed_at': new Date().toISOString(),
            'workflow.reviewed_by': req.admin!.id,
          },
        },
        { session },
      );
      await audit(req, id, 'RFQ_REVIEW_SAVED', session);
      return { reviewed: true };
    });
    notify(id);
    return result;
  }
  async function buyerView(access: BuyerRfqAccess) {
    const rfq = await resolveBuyerRfq(access);
    const { version } = await current(rfq._id, undefined, rfq.customer_id);
    const parents = await QuotationModel.find({ rfq_id: rfq._id, customer_id: rfq.customer_id }).select('_id').lean();
    const history = await QuotationVersionModel.find({
      quotation_id: { $in: parents.map((parent) => parent._id) },
      status: { $ne: 'DRAFT' },
    })
      .sort({ created_at: -1, version_number: -1 })
      .lean();
    return {
      rfq: {
        id: rfq._id,
        rfq_number: rfq.rfq_number,
        buyer_name: rfq.contact_snapshot.full_name,
        country: rfq.destination_country,
        received_at: rfq.created_at,
        items: rfq.items.map((line) => ({
          name: line.product_snapshot?.brand_name ?? line.custom_medicine_name ?? 'Medicine',
          quantity: line.quantity,
          packaging_unit: line.packaging_unit,
        })),
      },
      workflow_status: workflowStatus(rfq, version),
      quote: version && version.status !== 'DRAFT' ? commercialQuotation(version) : null,
      history: history.map(commercialQuotation),
      messages: (rfq.workflow?.messages ?? []).map(
        ({
          id,
          author,
          kind,
          body,
          version_number,
          created_at,
          scope,
          proposed_medicine_subtotal,
          proposed_delivery_charge,
        }) => ({
          id,
          author,
          kind,
          body,
          version_number,
          created_at,
          scope,
          proposed_medicine_subtotal,
          proposed_delivery_charge,
        }),
      ),
      ...(typeof access === 'string' ? { expires_at: rfq.guest_expires_at } : {}),
    };
  }
  async function negotiate(req: Request, access: BuyerRfqAccess, input: z.infer<typeof negotiateBody>) {
    const result = await mongoose.connection.transaction(async (session) => {
      const rfq = await resolveBuyerRfq(access, session);
      const fingerprint = hashToken(canonicalPayload(input));
      const replay = rfq.workflow?.messages?.find((message) => message.operation_id === input.operation_id);
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw AppError.conflict('Operation key reused.');
        return { message_id: replay.id, rfqId: rfq._id, replayed: true };
      }
      const { quote, version } = await current(rfq._id, session, rfq.customer_id);
      if (!quote || !version || version._id !== input.expected_version_id) throw versionConflict();
      if (
        quote.overall_status !== 'ACTIVE' ||
        version.status !== 'SENT' ||
        !version.valid_until ||
        version.valid_until <= new Date() ||
        rfq.workflow?.pending_request_id
      )
        throw AppError.conflict('This offer cannot receive another change request.');
      if ((rfq.workflow?.messages?.length ?? 0) >= 199)
        throw AppError.conflict('Please contact our team to continue this conversation.');
      const id = randomUUID();
      await QuotationVersionModel.updateOne(
        { _id: version._id, status: 'SENT' },
        { $set: { revision_request: { requested_at: new Date(), message_id: id } } },
        { session },
      );
      await RfqModel.updateOne(
        { _id: rfq._id },
        {
          $set: {
            'workflow.enabled': rfq.workflow?.enabled ?? false,
            'workflow.pending_request_id': id,
            'workflow.offer_state': 'CHANGE_REQUESTED',
          },
          $push: {
            'workflow.messages': {
              ...input,
              id,
              fingerprint,
              author: 'BUYER',
              kind: 'REQUEST',
              version_id: version._id,
              version_number: version.version_number,
              created_at: new Date().toISOString(),
            },
          },
        },
        { session },
      );
      await queueAdminEmail(env, session, version._id, 'revision-request', `negotiation:${id}:admin`);
      await audit(req, rfq._id, 'RFQ_BETTER_OFFER_REQUESTED', session);
      return { message_id: id, rfqId: rfq._id, replayed: false };
    });
    if (!result.replayed) notify(result.rfqId);
    return { message_id: result.message_id, replayed: result.replayed };
  }
  async function respond(req: Request, id: string, input: z.infer<typeof responseBody>) {
    const rfq = await RfqModel.findById(id).lean();
    if (!rfq) throw AppError.notFound();
    const replay = rfq.workflow?.messages?.find((message) => message.operation_id === input.operation_id);
    if (replay) {
      if (replay.fingerprint !== hashToken(canonicalPayload(input)))
        throw AppError.conflict('Operation key was used for different terms.');
      return { responded: true };
    }
    const { quote, version } = await current(id);
    if (!quote || !version) throw AppError.notFound();
    if (input.mode === 'RETAINED') {
      await mongoose.connection.transaction(async (session) => {
        const source = await RfqModel.findById(id).session(session).lean();
        const repeated = source?.workflow?.messages?.find((message) => message.operation_id === input.operation_id);
        if (repeated) {
          if (repeated.fingerprint !== hashToken(canonicalPayload(input)))
            throw AppError.conflict('Operation key reused.');
          return;
        }
        const offer = await current(id, session);
        if (
          !source ||
          source.workflow?.pending_request_id !== input.request_id ||
          offer.version?._id !== input.expected_version_id ||
          offer.version.status !== 'SENT' ||
          !offer.version.valid_until ||
          offer.version.valid_until <= new Date()
        )
          throw versionConflict();
        await QuotationVersionModel.updateOne(
          { _id: offer.version._id, status: 'SENT' },
          { $unset: { revision_request: 1 } },
          { session },
        );
        await RfqModel.updateOne(
          { _id: id, 'workflow.pending_request_id': input.request_id },
          {
            $set: { 'workflow.offer_state': 'RETAINED' },
            $unset: { 'workflow.pending_request_id': 1 },
            $push: {
              'workflow.messages': {
                id: randomUUID(),
                operation_id: input.operation_id,
                fingerprint: hashToken(canonicalPayload(input)),
                author: 'ADMIN',
                kind: 'RETAINED',
                body: input.body,
                request_id: input.request_id,
                version_id: offer.version._id,
                version_number: offer.version.version_number,
                created_at: new Date().toISOString(),
              },
            },
          },
          { session },
        );
        await queueLifecycleEmail(
          session,
          offer.version._id,
          'negotiation-reply',
          source.contact_snapshot.email,
          `negotiation-reply:${input.operation_id}`,
        );
        await audit(req, id, 'RFQ_CURRENT_OFFER_RETAINED', session);
      });
    } else {
      if (
        !replay &&
        (rfq.workflow?.pending_request_id !== input.request_id || version._id !== input.expected_version_id)
      )
        throw versionConflict();
      const proposal = rfq.workflow?.messages?.find(
        (message) => message.id === input.request_id && message.author === 'BUYER',
      );
      if (!proposal) throw AppError.notFound();
      if (
        !input.prices ||
        new Set(input.prices.map((line) => line.rfq_item_id)).size !==
          version.items.filter((line) => line.availability_status === 'AVAILABLE').length ||
        input.prices.some(
          (line) =>
            !version.items.some(
              (source) => source.rfq_item_id === line.rfq_item_id && source.availability_status === 'AVAILABLE',
            ),
        )
      )
        throw AppError.validation([{ field: 'prices', issue: 'Price every quoted medicine exactly once.' }]);
      const subtotal = version.items
        .filter((line) => line.availability_status === 'AVAILABLE')
        .reduce(
          (sum, line) =>
            sum.plus(
              new Exact(input.prices!.find((price) => price.rfq_item_id === line.rfq_item_id)!.selling_price)
                .toDecimalPlaces(2)
                .mul(line.quantity),
            ),
          new Exact(0),
        );
      const delivery = input.delivery_charge ?? version.freight_cost.toString();
      if (
        input.mode === 'ACCEPT' &&
        ((proposal.proposed_medicine_subtotal !== undefined && !subtotal.eq(proposal.proposed_medicine_subtotal)) ||
          (proposal.proposed_delivery_charge !== undefined &&
            !new Exact(delivery).eq(proposal.proposed_delivery_charge)))
      )
        throw AppError.validation([
          {
            field: 'prices',
            issue:
              'To accept the proposal, the medicine subtotal and delivery charge must equal the buyer’s proposed amounts. Otherwise send a counteroffer.',
          },
        ]);
      const recordedCosts = await QuotationInternalCostModel.findOne({ quotation_version_id: version._id })
        .select('items')
        .lean();
      const pricing = reviseQuoteSchema.parse({
        expected_current_version_id: input.expected_version_id,
        billing_currency: version.billing_currency,
        items: version.items.map((line) => ({
          rfq_item_id: line.rfq_item_id,
          manufacturer_id: line.manufacturer_id,
          availability_status: line.availability_status,
          selling_price: input.prices!.find((price) => price.rfq_item_id === line.rfq_item_id)?.selling_price,
          ...(() => {
            const cost = recordedCosts?.items.find((item) => item.rfq_item_id === line.rfq_item_id);
            return cost
              ? {
                  procurement_cost_bdt: amount(new Exact(cost.procurement_unit_cost_bdt.toString()), 8),
                  markup_percent: amount(new Exact(cost.markup_percent.toString()), 8),
                }
              : {};
          })(),
          weight_per_pack_g: line.weight_per_pack_g?.toString(),
          customer_facing_note: line.customer_facing_note,
          snapshot: {
            brand_name: line.brand_name_snapshot,
            generic_name: line.generic_name_snapshot,
            strength: line.strength_snapshot,
            dosage_form: line.dosage_form_snapshot,
            pack_size: line.pack_size_snapshot,
          },
        })),
        freight_amount: delivery,
        insurance_amount: version.insurance_cost.toString(),
        packed_weight_g: version.packed_weight_g?.toString(),
        shipping_terms: version.shipping_terms,
        payment_terms: version.payment_terms,
        bank_details: version.bank_details_snapshot,
        issue_immediately: true,
        validity_days: input.validity_days,
        negotiation_response: {
          request_id: input.request_id,
          operation_id: input.operation_id,
          kind: input.mode === 'ACCEPT' ? 'REVISED' : 'COUNTEROFFER',
          body: input.body,
          request_fingerprint: hashToken(canonicalPayload(input)),
        },
      });
      await quotes.revise(req, quote._id, pricing);
    }
    notify(id);
    return { responded: true };
  }
  async function requestPayment(req: Request, id: string, input: z.infer<typeof paymentRequestBody>) {
    await mongoose.connection.transaction(async (session) => {
      const rfq = await RfqModel.findById(id).session(session).lean();
      const { quote, version } = await current(id, session);
      if (!rfq || !quote || !version || version._id !== input.expected_version_id) throw versionConflict();
      if (version.payment_requested_at) return;
      if (
        version.status !== 'ACCEPTED' ||
        version.reservation_status !== 'ACTIVE' ||
        !version.reservation_expires_at ||
        version.reservation_expires_at <= new Date()
      )
        throw AppError.conflict('Customer approval and an active reservation are required.');
      const changed = await QuotationVersionModel.updateOne(
        { _id: version._id, status: 'ACCEPTED', payment_requested_at: { $exists: false } },
        { $set: { payment_requested_at: new Date() } },
        { session },
      );
      if (!changed.matchedCount) throw AppError.conflict();
      await QuotationModel.updateOne(
        { _id: quote._id, current_version_id: version._id },
        { $set: { updated_at: new Date() } },
        { session },
      );
      await queueLifecycleEmail(
        session,
        version._id,
        'payment-request',
        rfq.contact_snapshot.email,
        `payment-request:${version._id}`,
      );
      await audit(req, id, 'RFQ_PAYMENT_REQUESTED', session);
    });
    notify(id);
    return { requested: true };
  }
  async function guestLink(req: Request, id: string, input: z.infer<typeof guestLinkBody>) {
    await mongoose.connection.transaction(async (session) => {
      const rfq = await RfqModel.findById(id).session(session).lean();
      if (!rfq) throw AppError.notFound();
      if (input.action === 'REVOKE')
        await RfqModel.updateOne({ _id: id }, { $set: { guest_revoked_at: new Date() } }, { session });
      else {
        if (!rfq.contact_snapshot.email)
          throw AppError.validation([
            {
              field: 'email',
              issue: 'The original RFQ has no email address. Contact the buyer to establish a verified address.',
            },
          ]);
        const access = newGuestAccess(env);
        await RfqModel.updateOne({ _id: id }, { $set: access, $unset: { guest_revoked_at: 1 } }, { session });
        await enqueueRfqEmail(
          session,
          id,
          'rfq-confirmation',
          rfq.contact_snapshot.email,
          `guest-link:${id}:${access.guest_token_hash}`,
        );
      }
      await audit(req, id, `RFQ_GUEST_LINK_${input.action}`, session);
    });
    notify(id);
    return { updated: true };
  }
  return { ledger, detail, review, buyerView, negotiate, respond, requestPayment, guestLink };
}
