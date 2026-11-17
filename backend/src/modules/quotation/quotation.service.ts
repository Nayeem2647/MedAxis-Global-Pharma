import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Request } from 'express';
import mongoose, { type ClientSession, type HydratedDocument } from 'mongoose';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { generateToken, hashToken } from '../../shared/utils/crypto.js';
import { bsonDecimal } from '../../shared/utils/decimal.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import {
  bankDetailsSchema,
  draftQuoteSchema,
  reviseQuoteSchema,
  sendQuoteSchema,
  updateDraftQuoteSchema,
  type QuotePricing,
} from '../../shared/validators/quotation.validator.js';
import { ProductModel, ManufacturerModel, GenericModel } from '../catalog/catalog.schema.js';
import type { FxService } from '../fx/fx.service.js';
import { RfqModel, type IRfq } from '../rfq/rfq.schema.js';
import { PlatformSettingModel } from '../settings/settings.schema.js';
import { NotificationLogModel } from '../notification/notification.schema.js';
import {
  calculateFastQuote,
  type FastQuoteLine,
  type InternalCalculation,
  type CommercialCalculation,
} from './fastquote.engine.js';
import {
  QuotationModel,
  QuotationVersionModel,
  QuotationInternalCostModel,
  type IQuotation,
  type IQuotationVersion,
} from './quotation.schema.js';
import { commercialQuotation } from './quotation.dto.js';
import { enqueueQuotation } from './quotation.outbox.js';

export const quotationEvents = new EventEmitter();
export interface QuotationHooks {
  dispatchNotifications?: () => void | Promise<void>;
}
type VersionDoc = HydratedDocument<IQuotationVersion>;

function commercialFields(calculation: CommercialCalculation) {
  return {
    subtotal_amount: bsonDecimal(calculation.subtotal_amount),
    freight_cost: bsonDecimal(calculation.freight_cost),
    insurance_cost: bsonDecimal(calculation.insurance_cost),
    total_amount: bsonDecimal(calculation.total_amount),
  };
}
function costFields(calculation: InternalCalculation) {
  return {
    ...calculation,
    items: calculation.items.map((item) => ({
      ...item,
      procurement_unit_cost_bdt: bsonDecimal(item.procurement_unit_cost_bdt),
      markup_percent: bsonDecimal(item.markup_percent),
    })),
    procurement_cost_bdt: bsonDecimal(calculation.procurement_cost_bdt),
    target_markup_percent: bsonDecimal(calculation.target_markup_percent),
    calculated_base_bdt: bsonDecimal(calculation.calculated_base_bdt),
    gross_margin_bdt: bsonDecimal(calculation.gross_margin_bdt),
    effective_gross_margin_percent: bsonDecimal(calculation.effective_gross_margin_percent),
  };
}
function pricedLines(
  lines: IQuotationVersion['items'],
  calculation: CommercialCalculation,
): IQuotationVersion['items'] {
  return lines.map((line) => {
    const price = calculation.items.find((value) => value.rfq_item_id === line.rfq_item_id)!;
    return {
      ...line,
      unit_quoted_price: price.unit_quoted_price === undefined ? undefined : bsonDecimal(price.unit_quoted_price),
      total_line_price: price.total_line_price === undefined ? undefined : bsonDecimal(price.total_line_price),
    };
  });
}

export function createQuotationService(env: AppEnv, fx: FxService, logger: AppLogger, hooks: QuotationHooks = {}) {
  function notify(id: string) {
    void Promise.resolve()
      .then(() => quotationEvents.emit('QUOTATION_CHANGED', { quotation_id: id }))
      .catch(() => logger.warn('Quotation event hook failed', { quotation_id: id }));
    void Promise.resolve()
      .then(() => hooks.dispatchNotifications?.())
      .catch(() => logger.warn('Quotation dispatch hook failed', { quotation_id: id }));
  }
  async function audit(
    req: Request,
    id: string,
    action: string,
    session: ClientSession,
    metadata: Record<string, unknown> = {},
  ) {
    await writeAuditLog(
      req,
      {
        actor_type: 'SUPER_ADMIN',
        actor_id: req.admin!.id,
        action,
        entity_type: 'quotations',
        entity_id: id,
        metadata,
      },
      session,
    );
  }
  async function rfqFor(id: string, session: ClientSession) {
    const rfq = await RfqModel.findById(id).session(session).lean();
    if (!rfq) throw AppError.notFound('RFQ not found.');
    if (['CLOSED', 'CANCELLED', 'CONVERTED'].includes(rfq.status))
      throw AppError.conflict('RFQ cannot be quoted in this state.');
    return rfq;
  }
  async function buildLines(rfq: IRfq, input: QuotePricing, session: ClientSession) {
    if (
      input.items.length !== rfq.items.length ||
      input.items.some((item) => !rfq.items.some((line) => line._id === item.rfq_item_id))
    )
      throw AppError.validation([
        { field: 'items', issue: 'Quote every RFQ line exactly once, including unavailable lines.' },
      ]);
    const lines: IQuotationVersion['items'] = [];
    for (const item of input.items) {
      const source = rfq.items.find((line) => line._id === item.rfq_item_id)!;
      // Serialize against manufacturer deactivation while the quote is created.
      const manufacturer = await ManufacturerModel.findOneAndUpdate(
        { _id: item.manufacturer_id, is_active: true },
        { $set: { updated_at: new Date() } },
        { session, returnDocument: 'after' },
      ).lean();
      if (!manufacturer)
        throw AppError.validation([{ field: 'items.manufacturer_id', issue: 'An active manufacturer is required.' }]);
      let details = item.snapshot;
      if (source.product_id) {
        const product = await ProductModel.findById(source.product_id).session(session).lean();
        if (!product || product.manufacturer_id !== item.manufacturer_id)
          throw AppError.validation([
            { field: 'items.manufacturer_id', issue: 'Manufacturer must match the catalog product.' },
          ]);
        const generic = await GenericModel.findById(product.generic_id).session(session).lean();
        if (!generic) throw AppError.validation([{ field: 'items', issue: 'Product generic is missing.' }]);
        const localized =
          rfq.contact_snapshot.preferred_locale === 'zh-CN'
            ? (product.translations.zhCN ?? product.translations.en)
            : product.translations.en;
        details = {
          brand_name: source.product_snapshot?.brand_name ?? localized.brand_name,
          generic_name:
            (rfq.contact_snapshot.preferred_locale === 'zh-CN' ? generic.translations.zhCN?.name : undefined) ??
            generic.translations.en.name,
          strength: product.strength,
          dosage_form: product.dosage_form,
          pack_size: source.product_snapshot?.pack_size ?? product.pack_size,
        };
        if (
          item.availability_status === 'AVAILABLE' &&
          product.cold_chain_required &&
          !input.shipping_terms.cold_chain_required
        )
          throw AppError.validation([
            {
              field: 'shipping_terms.cold_chain_required',
              issue: 'Available cold-chain products require cold-chain shipping.',
            },
          ]);
      }
      if (!details)
        throw AppError.validation([
          { field: 'items.snapshot', issue: 'Uncatalogued RFQ lines require complete commercial specifications.' },
        ]);
      lines.push({
        _id: randomUUID(),
        rfq_item_id: source._id,
        product_id: source.product_id,
        manufacturer_id: item.manufacturer_id,
        brand_name_snapshot: details.brand_name,
        generic_name_snapshot: details.generic_name,
        strength_snapshot: details.strength,
        dosage_form_snapshot: details.dosage_form,
        pack_size_snapshot: details.pack_size,
        packaging_unit: source.packaging_unit,
        quantity: source.quantity,
        availability_status: item.availability_status,
        customer_facing_note: item.customer_facing_note,
      });
    }
    return lines;
  }
  async function createVersion(
    req: Request,
    quote: IQuotation,
    rfq: IRfq,
    input: QuotePricing,
    session: ClientSession,
    existing?: VersionDoc,
  ) {
    const snapshot = await fx.snapshot(input.billing_currency, session, true);
    const lines = await buildLines(rfq, input, session);
    const calculated = calculateFastQuote({
      currency: input.billing_currency,
      rate_to_bdt: snapshot.rate,
      freight_amount: input.freight_amount,
      insurance_amount: input.insurance_amount,
      items: input.items.map((item) => ({
        ...item,
        quantity: lines.find((line) => line.rfq_item_id === item.rfq_item_id)!.quantity,
      })),
    });
    const version = existing ?? new QuotationVersionModel();
    const previousUpdate = existing?.updated_at.getTime();
    version.set({
      _id: quote.current_version_id,
      quotation_id: quote._id,
      version_number: quote.current_version,
      status: 'DRAFT',
      contact_snapshot: rfq.contact_snapshot,
      items: pricedLines(lines, calculated.commercial),
      billing_currency: input.billing_currency,
      ...commercialFields(calculated.commercial),
      shipping_terms: input.shipping_terms,
      payment_terms: input.payment_terms,
      bank_details_snapshot: input.bank_details,
    });
    await version.save({ session });
    const costs = existing
      ? await QuotationInternalCostModel.findOne({ quotation_version_id: version._id }).session(session)
      : new QuotationInternalCostModel();
    if (!costs) throw AppError.conflict('Draft cost record is missing.');
    costs.set({
      quotation_version_id: version._id,
      ...costFields(calculated.internal),
      internal_procurement_notes: input.internal_procurement_notes,
    });
    await costs.save({ session });
    if (previousUpdate !== undefined) {
      const updated = new Date(Math.max(Date.now(), previousUpdate + 1));
      await QuotationVersionModel.updateOne(
        { _id: version._id, status: 'DRAFT' },
        { $set: { updated_at: updated } },
        { session, timestamps: false },
      );
      version.updated_at = updated;
    }
    await audit(req, quote._id, existing ? 'QUOTATION_DRAFT_UPDATED' : 'QUOTATION_DRAFT_CREATED', session, {
      version_number: version.version_number,
    });
    return {
      version,
      preview: { rates_to_bdt: snapshot.rates, stale: snapshot.stale, captured_at: snapshot.captured_at },
    };
  }
  async function lockQuote(id: string, session: ClientSession, expected?: string) {
    const quote = await QuotationModel.findOne({ _id: id, overall_status: 'ACTIVE' }).session(session).lean();
    if (!quote) throw AppError.notFound();
    if (expected && quote.current_version_id !== expected)
      throw AppError.conflict('Quotation current version changed.', 'QUOTATION_VERSION_CONFLICT');
    const locked = await QuotationModel.findOneAndUpdate(
      {
        _id: id,
        overall_status: 'ACTIVE',
        current_version_id: quote.current_version_id,
        current_version: quote.current_version,
      },
      { $set: { updated_at: new Date() } },
      { session, returnDocument: 'after' },
    );
    if (!locked) throw AppError.conflict('Quotation current version changed.', 'QUOTATION_VERSION_CONFLICT');
    return locked;
  }
  async function bankDetails(version: VersionDoc, input: z.infer<typeof sendQuoteSchema>, session: ClientSession) {
    const settings = await PlatformSettingModel.findOne({ key: 'wire_instructions' }).session(session).lean();
    const parsed = bankDetailsSchema.safeParse(input.bank_details ?? version.bank_details_snapshot ?? settings?.value);
    if (!parsed.success)
      throw AppError.validation([
        { field: 'bank_details', issue: 'Verified bank wire instructions are required before issuance.' },
      ]);
    if (parsed.data.currency && parsed.data.currency !== version.billing_currency)
      throw AppError.validation([{ field: 'bank_details.currency', issue: 'Bank currency must match the quotation.' }]);
    return parsed.data;
  }
  async function issue(
    req: Request,
    quote: IQuotation,
    version: VersionDoc,
    input: z.infer<typeof sendQuoteSchema>,
    session: ClientSession,
    token: string,
  ) {
    if (version.status !== 'DRAFT' || version.fx_snapshot)
      throw AppError.conflict('Only an unlocked draft can be issued.');
    if (!version.contact_snapshot.email)
      throw AppError.validation([{ field: 'contact.email', issue: 'A recipient email is required before issuance.' }]);
    if (version.items.some((line) => line.availability_status === 'SOURCING'))
      throw AppError.validation([{ field: 'items', issue: 'Resolve sourcing lines before issuance.' }]);
    const rfq = await rfqFor(quote.rfq_id, session);
    if (rfq.status === 'NEED_CLARIFICATION') throw AppError.conflict('Resolve RFQ clarification before issuance.');
    const rates = await fx.snapshot(version.billing_currency, session, input.allow_stale_fx);
    const costs = await QuotationInternalCostModel.findOne({ quotation_version_id: version._id })
      .select('+internal_procurement_notes')
      .session(session);
    if (!costs) throw AppError.conflict('Internal costs are missing.');
    const calculation = calculateFastQuote({
      currency: version.billing_currency,
      rate_to_bdt: rates.rate,
      freight_amount: version.freight_cost.toString(),
      insurance_amount: version.insurance_cost.toString(),
      items: version.toObject().items.map((line): FastQuoteLine => {
        const cost = costs.items.find((item) => item.rfq_item_id === line.rfq_item_id);
        return {
          rfq_item_id: line.rfq_item_id,
          manufacturer_id: line.manufacturer_id,
          quantity: line.quantity,
          availability_status: line.availability_status,
          procurement_cost_bdt: cost?.procurement_unit_cost_bdt.toString(),
          markup_percent: cost?.markup_percent.toString(),
        };
      }),
    });
    const bank = await bankDetails(version, input, session);
    const presets = await PlatformSettingModel.findOne({ key: 'payment_presets' }).session(session).lean();
    const configuredDays = presets?.value.quote_validity_days;
    const days =
      input.validity_days ??
      (typeof configuredDays === 'number' &&
      Number.isInteger(configuredDays) &&
      configuredDays >= 1 &&
      configuredDays <= 365
        ? configuredDays
        : 7);
    costs.set(costFields(calculation.internal));
    await costs.save({ session }); // Must precede issuance; guard requires DRAFT.
    const now = new Date();
    version.set({
      ...commercialFields(calculation.commercial),
      items: pricedLines(version.toObject().items, calculation.commercial),
      status: 'SENT',
      issued_at: now,
      valid_until: new Date(now.getTime() + days * 86_400_000),
      bank_details_snapshot: bank,
      magic_link_token_hash: hashToken(token),
      fx_snapshot: {
        mode:
          version.billing_currency === 'BDT'
            ? Object.values(rates.modes).includes('MANUAL_FIXED')
              ? 'MANUAL_FIXED'
              : 'LIVE'
            : rates.modes[version.billing_currency],
        modes: rates.modes,
        fetched_at: rates.fetched,
        stale_rates_used: rates.stale,
        captured_at: rates.captured_at,
        rates_to_bdt: {
          USD: bsonDecimal(rates.rates.USD),
          CNY: bsonDecimal(rates.rates.CNY),
          EUR: bsonDecimal(rates.rates.EUR),
        },
      },
    });
    await version.save({ session });
    const updated = await RfqModel.updateOne(
      { _id: rfq._id, status: rfq.status },
      { $set: { status: 'QUOTED' } },
      { session },
    );
    if (updated.matchedCount !== 1) throw AppError.conflict();
    const origin = env.PUBLIC_ORIGIN[0]!;
    const url = new URL(`/q/${token}`, origin).href;
    await enqueueQuotation(env, version.toObject(), hashToken(token), url, session);
    await audit(req, quote._id, 'QUOTATION_SENT', session, {
      version_number: version.version_number,
      stale_fx_used: rates.stale,
    });
    return { version: commercialQuotation(version.toObject()), magic_link_url: url };
  }
  async function draft(req: Request, input: z.infer<typeof draftQuoteSchema>) {
    const id = randomUUID();
    const versionId = randomUUID();
    const result = await mongoose.connection.transaction(async (session) => {
      const rfq = await rfqFor(input.rfq_id, session);
      if (await QuotationModel.exists({ rfq_id: rfq._id, overall_status: 'ACTIVE' }).session(session))
        throw AppError.conflict('RFQ already has an active quotation.');
      const quote = new QuotationModel({
        _id: id,
        quotation_number: `QT-${rfq.rfq_number}-${id.slice(0, 8)}`,
        rfq_id: rfq._id,
        customer_id: rfq.customer_id,
        current_version: 1,
        current_version_id: versionId,
        overall_status: 'ACTIVE',
      });
      await quote.save({ session });
      const built = await createVersion(req, quote.toObject(), rfq, input, session);
      return { quotation_id: id, version: commercialQuotation(built.version.toObject()), fx_preview: built.preview };
    });
    return result;
  }
  async function send(req: Request, id: string, input: z.infer<typeof sendQuoteSchema>) {
    const token = generateToken();
    const result = await mongoose.connection.transaction(async (session) => {
      const quote = await lockQuote(id, session, input.expected_version_id);
      const version = await QuotationVersionModel.findOne({ _id: quote.current_version_id, quotation_id: id })
        .select('+magic_link_token_hash')
        .session(session);
      if (!version) throw AppError.conflict('Current quotation version is missing.');
      return issue(req, quote.toObject(), version, input, session, token);
    });
    notify(id);
    return result;
  }
  async function revise(req: Request, id: string, input: z.infer<typeof reviseQuoteSchema>) {
    const token = generateToken();
    const versionId = randomUUID();
    const result = await mongoose.connection.transaction(async (session) => {
      const quote = await lockQuote(id, session, input.expected_current_version_id);
      const previous = await QuotationVersionModel.findOne({
        _id: quote.current_version_id,
        quotation_id: id,
      }).session(session);
      if (!previous || previous.status !== 'SENT')
        throw AppError.conflict('Only a current SENT quotation can be revised.');
      const rfq = await rfqFor(quote.rfq_id, session);
      const oldId = quote.current_version_id;
      quote.current_version += 1;
      quote.current_version_id = versionId;
      await quote.save({ session });
      const built = await createVersion(req, quote.toObject(), rfq, input, session);
      const changed = await QuotationVersionModel.updateOne(
        { _id: oldId, status: 'SENT' },
        { $set: { status: 'SUPERSEDED' } },
        { session },
      );
      if (changed.matchedCount !== 1)
        throw AppError.conflict('Quotation was accepted or changed during revision.', 'QUOTATION_VERSION_CONFLICT');
      await NotificationLogModel.updateMany(
        {
          entity_type: 'quotation_versions',
          entity_id: oldId,
          status: { $in: ['PENDING', 'FAILED', 'FAILED_RETRY', 'PROCESSING'] },
        },
        { $set: { status: 'DEAD', safe_payload: { version_id: oldId, superseded: true } } },
        { session },
      );
      await audit(req, id, 'QUOTATION_REVISED', session, {
        previous_version_id: oldId,
        version_number: quote.current_version,
      });
      if (input.issue_immediately)
        return issue(
          req,
          quote.toObject(),
          built.version,
          { ...input, expected_version_id: versionId },
          session,
          token,
        );
      return { version: commercialQuotation(built.version.toObject()), fx_preview: built.preview };
    });
    notify(id);
    return result;
  }
  async function resend(req: Request, id: string, expected?: string) {
    const token = generateToken();
    const result = await mongoose.connection.transaction(async (session) => {
      const quote = await lockQuote(id, session, expected);
      const previous = await QuotationVersionModel.findOne({
        _id: quote.current_version_id,
        quotation_id: id,
        status: 'SENT',
        valid_until: { $gt: new Date() },
      })
        .select('+magic_link_token_hash')
        .session(session);
      if (!previous) throw AppError.conflict('Only a current, unexpired SENT version can be resent.');
      await rfqFor(quote.rfq_id, session);
      const version = await QuotationVersionModel.findOneAndUpdate(
        { _id: previous._id, status: 'SENT', magic_link_token_hash: previous.magic_link_token_hash },
        { $set: { magic_link_token_hash: hashToken(token) } },
        { session, returnDocument: 'after' },
      );
      if (!version) throw AppError.conflict('Quotation token changed concurrently.');
      const url = new URL(`/q/${token}`, env.PUBLIC_ORIGIN[0]!).href;
      await enqueueQuotation(env, version.toObject(), hashToken(token), url, session, true);
      await audit(req, id, 'QUOTATION_RESENT', session, { version_number: version.version_number });
      return { version: commercialQuotation(version.toObject()), magic_link_url: url };
    });
    notify(id);
    return result;
  }
  async function updateDraft(req: Request, id: string, input: z.infer<typeof updateDraftQuoteSchema>) {
    return mongoose.connection.transaction(async (session) => {
      const quote = await lockQuote(id, session, input.expected_current_version_id);
      const version = await QuotationVersionModel.findOne({ _id: quote.current_version_id, quotation_id: id }).session(
        session,
      );
      if (
        !version ||
        version.status !== 'DRAFT' ||
        version.fx_snapshot ||
        version.updated_at.getTime() !== Date.parse(input.expected_updated_at)
      )
        throw AppError.conflict('Draft changed or was issued. Refresh before editing.', 'QUOTATION_VERSION_CONFLICT');
      const rfq = await rfqFor(quote.rfq_id, session);
      const built = await createVersion(req, quote.toObject(), rfq, input, session, version);
      return { version: commercialQuotation(built.version.toObject()), fx_preview: built.preview };
    });
  }
  async function detail(id: string) {
    const quote = await QuotationModel.findById(id).lean();
    if (!quote) throw AppError.notFound();
    const versions = await QuotationVersionModel.find({ quotation_id: id }).sort({ version_number: 1 }).lean();
    const costs = await QuotationInternalCostModel.find({
      quotation_version_id: { $in: versions.map((version) => version._id) },
    })
      .select('+internal_procurement_notes')
      .lean();
    return {
      quotation: quote,
      versions: versions.map((version) => ({
        ...commercialQuotation(version),
        locked_fx_rates: version.fx_snapshot
          ? {
              mode: version.fx_snapshot.mode,
              modes: version.fx_snapshot.modes,
              captured_at: version.fx_snapshot.captured_at,
              fetched_at: version.fx_snapshot.fetched_at,
              stale_rates_used: version.fx_snapshot.stale_rates_used,
              rates_to_bdt: {
                USD: version.fx_snapshot.rates_to_bdt.USD.toString(),
                CNY: version.fx_snapshot.rates_to_bdt.CNY.toString(),
                EUR: version.fx_snapshot.rates_to_bdt.EUR.toString(),
              },
            }
          : undefined,
      })),
      internal_costs: costs.map((cost) => ({
        id: cost._id,
        quotation_version_id: cost.quotation_version_id,
        items: cost.items.map((line) => ({
          rfq_item_id: line.rfq_item_id,
          manufacturer_id: line.manufacturer_id,
          quantity: line.quantity,
          procurement_unit_cost_bdt: line.procurement_unit_cost_bdt.toString(),
          markup_percent: line.markup_percent.toString(),
        })),
        procurement_cost_bdt: cost.procurement_cost_bdt.toString(),
        target_markup_percent: cost.target_markup_percent.toString(),
        calculated_base_bdt: cost.calculated_base_bdt.toString(),
        gross_margin_bdt: cost.gross_margin_bdt?.toString(),
        effective_gross_margin_percent: cost.effective_gross_margin_percent?.toString(),
        internal_procurement_notes: cost.internal_procurement_notes,
      })),
    };
  }
  return { draft, send, revise, resend, detail, updateDraft };
}
