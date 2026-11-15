import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { Request } from 'express';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { hashToken } from '../../shared/utils/crypto.js';
import type { RfqIntake } from '../../shared/validators/rfq.validator.js';
import { AdminModel } from '../auth/auth.schema.js';
import { ProductModel } from '../catalog/catalog.schema.js';
import { CustomerModel } from '../customer/customer.schema.js';
import { PlatformSettingModel } from '../settings/settings.schema.js';
import { PrescriptionModel } from '../storage/storage.schema.js';
import { RfqModel, RfqIdempotencyKeyModel, type IRfq } from './rfq.schema.js';
import type { RfqSignals } from './rfq.events.js';
import { enqueueRfqEmail } from './rfq.outbox.js';

export const STAGING_COOKIE = 'prescription_upload_session';
export const DAY_MS = 86_400_000;
export function canonicalPayload(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPayload).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalPayload(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const duplicateKey = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'code' in error && error.code === 11000;
function requestIdentity(req: Request, input: RfqIntake, kind: IRfq['inquiry_type']) {
  const { idempotency_key: _key, turnstile_token: _token, ...payload } = input;
  const staging: unknown = req.signedCookies?.[STAGING_COOKIE];
  const stagingHash = typeof staging === 'string' && /^[a-f0-9]{64}$/.test(staging) ? hashToken(staging) : undefined;
  return {
    stagingHash,
    requestHash: hashToken(
      canonicalPayload({
        ...payload,
        inquiry_type: kind,
        ...(input.prescription_ids.length ? { upload_owner: stagingHash ?? null } : {}),
      }),
    ),
  };
}
export async function findRfqReplay(req: Request, input: RfqIntake, kind: IRfq['inquiry_type']) {
  const previous = await RfqIdempotencyKeyModel.findOne({
    key: input.idempotency_key,
    expires_at: { $gt: new Date() },
  }).lean();
  if (!previous) return null;
  if (previous.request_hash !== requestIdentity(req, input, kind).requestHash)
    throw AppError.conflict('Idempotency key was used for a different payload.', 'IDEMPOTENCY_KEY_CONFLICT');
  return previous.response_snapshot;
}
export function createRfqIntakeService(env: AppEnv, signals: RfqSignals) {
  return async (req: Request, input: RfqIntake, kind: IRfq['inquiry_type']) => {
    const key = input.idempotency_key;
    const { stagingHash, requestHash } = requestIdentity(req, input, kind);
    let result: { snapshot: Record<string, unknown>; replayed: boolean } | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        result = await mongoose.connection.transaction(async (session) => {
          const now = new Date();
          const previous = await RfqIdempotencyKeyModel.findOne({ key }).session(session).lean();
          if (previous && previous.expires_at > now) {
            if (previous.request_hash !== requestHash)
              throw AppError.conflict('Idempotency key was used for a different payload.', 'IDEMPOTENCY_KEY_CONFLICT');
            return { snapshot: previous.response_snapshot, replayed: true };
          }
          if (previous)
            await RfqIdempotencyKeyModel.deleteOne({ _id: previous._id, expires_at: { $lte: now } }).session(session);
          const owner = await AdminModel.findOne({ singleton_key: 'SUPER_ADMIN', is_active: true })
            .session(session)
            .lean();
          if (!owner) throw AppError.unavailable('RFQ intake is not configured.');
          if (input.prescription_ids.length) {
            if (!stagingHash)
              throw AppError.validation([
                { field: 'prescription_ids', issue: 'Prescription upload session is required.' },
              ]);
            const available = await PrescriptionModel.countDocuments({
              _id: { $in: input.prescription_ids },
              rfq_id: { $exists: false },
              customer_id: { $exists: false },
              upload_token_hash: stagingHash,
              purge_status: 'ACTIVE',
              purge_scheduled_at: { $gt: now },
            }).session(session);
            if (available !== input.prescription_ids.length)
              throw AppError.validation([
                {
                  field: 'prescription_ids',
                  issue: 'Prescription is unavailable or belongs to another upload session.',
                },
              ]);
          }
          let customer = input.contact.email
            ? await CustomerModel.findOne({ email: input.contact.email }).session(session)
            : null;
          if (!customer) {
            customer = new CustomerModel({
              ...input.contact,
              country: input.destination_country,
              city: input.destination_city_port?.slice(0, 100),
            });
            await customer.save({ session });
          }
          const packaging = await PlatformSettingModel.findOne({ key: 'packaging_units' }).session(session).lean();
          const items: IRfq['items'] = [];
          for (const line of input.items) {
            if (
              packaging &&
              (!Array.isArray(packaging.value.units) || !packaging.value.units.includes(line.packaging_unit))
            )
              throw AppError.validation([
                { field: 'items.packaging_unit', issue: 'Packaging unit is not configured.' },
              ]);
            const product = line.product_id
              ? await ProductModel.findOne({ _id: line.product_id, status: 'PUBLISHED' })
                  .select({ 'translations.en.brand_name': 1, 'translations.zhCN.brand_name': 1, pack_size: 1 })
                  .session(session)
                  .lean()
              : null;
            if (!line.is_uncatalogued && !product)
              throw AppError.validation([{ field: 'items.product_id', issue: 'Published product not found.' }]);
            items.push({
              ...line,
              _id: randomUUID(),
              item_availability_status: 'SOURCING',
              ...(product
                ? {
                    product_snapshot: {
                      brand_name:
                        (input.locale === 'zh-CN' ? product.translations.zhCN?.brand_name : undefined) ??
                        product.translations.en.brand_name,
                      pack_size: product.pack_size,
                    },
                  }
                : {}),
            });
          }
          const year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Dhaka' }).format(now);
          const sequenceKey = `rfq_sequence_${year}`;
          if (!(await PlatformSettingModel.exists({ key: sequenceKey }).session(session))) {
            const last = await RfqModel.findOne({ rfq_number: { $regex: `^RFQ-${year}-[0-9]+$` } })
              .sort({ rfq_number: -1 })
              .select({ rfq_number: 1 })
              .session(session)
              .lean();
            await new PlatformSettingModel({
              key: sequenceKey,
              value: { next_number: last ? Number(last.rfq_number.split('-').at(-1)) : 0 },
              updated_by: owner._id,
            }).save({ session });
          }
          const sequence = await PlatformSettingModel.findOneAndUpdate(
            { key: sequenceKey },
            { $inc: { 'value.next_number': 1 } },
            { session, returnDocument: 'after' },
          ).lean();
          const number = sequence?.value.next_number;
          if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1)
            throw AppError.unavailable('RFQ numbering is not configured.');
          const rfq = new RfqModel({
            rfq_number: `RFQ-${year}-${String(number).padStart(5, '0')}`,
            customer_id: customer._id,
            inquiry_type: kind,
            contact_snapshot: input.contact,
            destination_country: input.destination_country,
            destination_city_port: input.destination_city_port,
            preferred_currency: input.preferred_currency,
            status: 'SUBMITTED',
            has_prescription: input.prescription_ids.length > 0,
            items,
          });
          await rfq.save({ session });
          if (input.prescription_ids.length) {
            if (!stagingHash)
              throw AppError.validation([
                { field: 'prescription_ids', issue: 'Prescription upload session is required.' },
              ]);
            const linked = await PrescriptionModel.updateMany(
              {
                _id: { $in: input.prescription_ids },
                rfq_id: { $exists: false },
                customer_id: { $exists: false },
                upload_token_hash: stagingHash,
                purge_status: 'ACTIVE',
                purge_scheduled_at: { $gt: now },
              },
              { $set: { rfq_id: rfq._id, customer_id: customer._id }, $unset: { upload_token_hash: 1 } },
              { session },
            );
            if (linked.matchedCount !== input.prescription_ids.length)
              throw AppError.validation([
                {
                  field: 'prescription_ids',
                  issue: 'Prescription is unavailable or belongs to another upload session.',
                },
              ]);
          }
          await writeAuditLog(
            req,
            {
              actor_type: 'BUYER',
              actor_id: customer._id,
              action: 'RFQ_SUBMITTED',
              entity_type: 'rfqs',
              entity_id: rfq._id,
              metadata: { inquiry_type: kind, item_count: items.length, has_prescription: rfq.has_prescription },
            },
            session,
          );
          await enqueueRfqEmail(session, rfq._id, 'rfq-confirmation', input.contact.email, `rfq:${rfq._id}:buyer`);
          await enqueueRfqEmail(
            session,
            rfq._id,
            'new-rfq-admin-alert',
            env.ADMIN_ALERT_EMAIL ?? owner.email,
            `rfq:${rfq._id}:admin`,
            { priority: 'HIGH' },
          );
          const snapshot = {
            rfq_id: rfq._id,
            rfq_number: rfq.rfq_number,
            status: 'SUBMITTED',
            created_at: now.toISOString(),
            total_items: items.length,
            customer: {
              id: customer._id,
              full_name: input.contact.full_name,
              ...(input.contact.email ? { email: input.contact.email } : {}),
            },
          };
          await new RfqIdempotencyKeyModel({
            key,
            request_hash: requestHash,
            rfq_id: rfq._id,
            response_snapshot: snapshot,
            expires_at: new Date(now.getTime() + DAY_MS),
          }).save({ session });
          return { snapshot, replayed: false };
        });
        break;
      } catch (error) {
        if (duplicateKey(error) && attempt < 3) continue;
        throw error;
      }
    }
    if (!result) throw AppError.unavailable();
    if (!result.replayed)
      signals.submitted(
        {
          type: 'NEW_RFQ',
          rfq_id: String(result.snapshot.rfq_id),
          rfq_number: String(result.snapshot.rfq_number),
          created_at: String(result.snapshot.created_at),
        },
        req.requestId,
      );
    return result;
  };
}
