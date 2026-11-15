import { z } from 'zod';
import mongoose from 'mongoose';
import type { AppEnv } from '../../config/env.js';
import { decrypt, hashToken } from '../../shared/utils/crypto.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { RfqModel, ClarificationMessageModel } from '../rfq/rfq.schema.js';
import { QuotationModel, QuotationVersionModel } from '../quotation/quotation.schema.js';
import { COMMERCIAL_PROJECTION, commercialQuotation } from '../quotation/quotation.dto.js';
import { isAccepted } from '../quotation/quotation.lifecycle.js';
import type { SecurityEvent } from '../auth/auth.security.js';
import { AdminModel } from '../auth/auth.schema.js';
import { NotificationLogModel, type INotificationLog } from './notification.schema.js';
import { createMailTransport, DeliveryError, type MailProvider } from './notification.transport.js';
import { template, type EmailContext, type TemplateId } from './email.templates/template.js';
import { enqueueOperatorAlert } from './notification.alerts.js';

const primaryTemplates = new Set<TemplateId>([
  'rfq-confirmation',
  'quotation-sent',
  'accepted',
  'expiry-reminder',
  'dispatch',
  'delivered',
  'clarification-request',
  'unable-to-supply',
  'revision-request',
  'admin-new-rfq-alert',
  'admin-accepted-alert',
  'operational-alert',
  'payment-received',
  'reservation-expired',
  'quotation-declined',
  'refresh-request',
]);
const aliases: Record<string, TemplateId> = {
  'new-rfq-admin-alert': 'admin-new-rfq-alert',
  'quotation-resend': 'quotation-sent',
  'admin-reservation-expired': 'reservation-expired',
  'fx-rate-alert': 'operational-alert',
  'acceptance-failure-alert': 'operational-alert',
  'admin-security-alert': 'operational-alert',
};
export const NOTIFICATION_MAX_ATTEMPTS = 3;
export const NOTIFICATION_LEASE_MS = 120000;
class ObsoleteDelivery extends Error {}

export function createNotificationService(
  env: AppEnv,
  logger: AppLogger,
  options: { fetcher?: typeof fetch; batchSize?: number } = {},
) {
  const transport = createMailTransport(env, options.fetcher);
  let active: Promise<void> | undefined;
  let requested = false;
  let stopped = false;
  async function context(job: INotificationLog): Promise<{ id: TemplateId; data: EmailContext }> {
    const raw = job.template_id ?? '';
    const id = aliases[raw] ?? raw;
    if (!primaryTemplates.has(id as TemplateId)) throw new DeliveryError('UNKNOWN_EMAIL_TEMPLATE', false, true);
    const data: EmailContext = { locale: 'en', reference: job.entity_id, replyTo: env.EMAIL_REPLY_TO };
    if (job.entity_type === 'rfqs') {
      const rfq = await RfqModel.findById(job.entity_id)
        .select({ rfq_number: 1, contact_snapshot: 1, unable_to_supply_reason: 1 })
        .lean();
      if (!rfq) throw new DeliveryError('EMAIL_REFERENCE_MISSING', false, true);
      data.reference = rfq.rfq_number;
      data.locale = rfq.contact_snapshot.preferred_locale;
      data.buyerName = rfq.contact_snapshot.full_name;
      if (id === 'unable-to-supply') data.body = rfq.unable_to_supply_reason;
      if (id === 'clarification-request') {
        const messageId = job.safe_payload.clarification_message_id;
        if (typeof messageId !== 'string' || !z.uuid().safeParse(messageId).success)
          throw new DeliveryError('EMAIL_THREAD_MISSING', false, true);
        const message = await ClarificationMessageModel.findOne({
          _id: messageId,
          rfq_id: rfq._id,
          direction: 'ADMIN_TO_BUYER',
          channel: 'EMAIL',
        })
          .select({ body: 1, thread_id: 1 })
          .lean();
        if (!message) throw new DeliveryError('EMAIL_THREAD_MISSING', false, true);
        data.body = message.body;
        data.threadId = message.thread_id;
        if (env.EMAIL_REPLY_DOMAIN) data.replyTo = `reply+${message.thread_id}@${env.EMAIL_REPLY_DOMAIN}`;
      }
    } else if (job.entity_type === 'quotation_versions') {
      const version = await QuotationVersionModel.findById(job.entity_id).select(COMMERCIAL_PROJECTION).lean();
      if (!version) throw new DeliveryError('EMAIL_REFERENCE_MISSING', false, true);
      const quote = await QuotationModel.findOne({ _id: version.quotation_id, current_version_id: version._id })
        .select({ quotation_number: 1 })
        .lean();
      if (!quote || version.status === 'SUPERSEDED') throw new ObsoleteDelivery();
      data.reference = quote.quotation_number;
      data.locale = version.contact_snapshot.preferred_locale;
      data.buyerName = version.contact_snapshot.full_name;
      data.quotation = commercialQuotation(version);
      if (id === 'quotation-sent') {
        if (version.status !== 'SENT' || !version.valid_until || version.valid_until <= new Date())
          throw new ObsoleteDelivery();
        if (!env.QUOTATION_TOKEN_ENCRYPTION_KEY || !env.QUOTATION_TOKEN_KEY_ID)
          throw new DeliveryError('EMAIL_ENCRYPTION_NOT_CONFIGURED');
        const expires = job.safe_payload.delivery_expires_at;
        if (typeof expires !== 'string' || !Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.now())
          throw new ObsoleteDelivery();
        let link: URL;
        try {
          const key = env.QUOTATION_TOKEN_ENCRYPTION_KEY;
          link = new URL(
            decrypt(
              job.safe_payload.delivery,
              Buffer.from(key, /^[a-f0-9]{64}$/i.test(key) ? 'hex' : 'base64'),
              env.QUOTATION_TOKEN_KEY_ID,
            ).toString(),
          );
        } catch {
          throw new DeliveryError('INVALID_DELIVERY_ENVELOPE', false, true);
        }
        const token = /^\/q\/([a-f0-9]{64})$/.exec(link.pathname)?.[1];
        if (
          !token ||
          link.search ||
          link.hash ||
          !env.PUBLIC_ORIGIN.some((origin) => new URL(origin).origin === link.origin)
        )
          throw new DeliveryError('INVALID_DELIVERY_ENVELOPE', false, true);
        if (
          !(await QuotationVersionModel.exists({
            _id: version._id,
            magic_link_token_hash: hashToken(token),
            status: 'SENT',
          }))
        )
          throw new ObsoleteDelivery();
        data.link = link.href;
        data.pdfLink = new URL(`/v1/public/quotation/pdf/${token}`, env.API_ORIGIN).href;
      }
      if (['accepted', 'admin-accepted-alert'].includes(id) && !isAccepted(version.status))
        throw new ObsoleteDelivery();
      if (
        (id === 'accepted' || (id === 'expiry-reminder' && job.safe_payload.reminder_kind === 'RESERVATION_DAY3')) &&
        !data.quotation.bank_details
      )
        throw new DeliveryError('VERIFIED_WIRE_DETAILS_MISSING', false, true);
      if (
        (id === 'dispatch' && !['DISPATCHED', 'DELIVERED'].includes(version.status)) ||
        (id === 'delivered' && version.status !== 'DELIVERED')
      )
        throw new ObsoleteDelivery();
      if (id === 'expiry-reminder') {
        data.reminderKind =
          job.safe_payload.reminder_kind === 'RESERVATION_DAY3' ? 'RESERVATION_DAY3' : 'QUOTATION_24H';
        if (
          data.reminderKind === 'QUOTATION_24H'
            ? version.status !== 'SENT' || !version.valid_until || version.valid_until <= new Date()
            : version.status !== 'ACCEPTED' ||
              !!version.payment ||
              version.reservation_status !== 'ACTIVE' ||
              !version.reservation_expires_at ||
              version.reservation_expires_at <= new Date()
        )
          throw new ObsoleteDelivery();
      }
    } else if (job.entity_type !== 'admins') throw new DeliveryError('EMAIL_REFERENCE_MISSING', false, true);
    if (id === 'operational-alert')
      data.alertCode =
        typeof job.safe_payload.alert_code === 'string'
          ? job.safe_payload.alert_code
          : typeof job.safe_payload.error_code === 'string'
            ? job.safe_payload.error_code
            : raw.toUpperCase().replace(/-/g, '_');
    if (job.entity_type === 'admins' && typeof job.safe_payload.reference_id === 'string')
      data.reference = job.safe_payload.reference_id;
    if (raw === 'admin-security-alert') {
      const security = z
        .object({
          occurred_at: z.string().max(100),
          ip_address: z.string().max(200),
          country: z.string().nullable(),
          city: z.string().nullable(),
          user_agent: z.string().max(2000),
          new_ip: z.boolean().optional(),
          foreign_ip: z.boolean().optional(),
        })
        .safeParse(job.safe_payload.security);
      if (security.success) data.security = security.data;
    }
    return { id: id as TemplateId, data };
  }
  async function process(job: INotificationLog) {
    const ownership = { _id: job._id, status: 'PROCESSING' as const, lease_until: job.lease_until };
    const pin = async (provider: MailProvider) => {
      const updated = await NotificationLogModel.updateOne(
        { ...ownership, lease_until: { $eq: job.lease_until, $gt: new Date() } },
        { $set: { delivery_provider: provider } },
      );
      if (!updated.matchedCount) throw new ObsoleteDelivery();
    };
    try {
      if (job.attempt_count > NOTIFICATION_MAX_ATTEMPTS) throw new DeliveryError('RETRY_EXHAUSTED', false, true);
      let provider = job.delivery_provider ?? (env.RESEND_API_KEY ? 'RESEND' : 'BREVO');
      await pin(provider);
      const rendered = await context(job);
      const message = template(rendered.id)(rendered.data);
      if (
        !(await NotificationLogModel.exists({ ...ownership, lease_until: { $eq: job.lease_until, $gt: new Date() } }))
      )
        throw new ObsoleteDelivery();
      let delivery;
      try {
        delivery = await transport.send(provider, job.recipient ?? '', message, job.dedupe_key, job._id);
      } catch (error) {
        if (
          !(error instanceof DeliveryError) ||
          !error.fallbackAllowed ||
          provider !== 'RESEND' ||
          !env.EMAIL_FALLBACK_ENABLED ||
          !env.BREVO_API_KEY
        )
          throw error;
        provider = 'BREVO';
        await pin(provider);
        delivery = await transport.send(provider, job.recipient ?? '', message, job.dedupe_key, job._id);
      }
      await NotificationLogModel.updateOne(ownership, {
        $set: {
          status: 'SENT',
          sent_at: new Date(),
          provider_message_id: delivery.id,
          delivery_provider: delivery.provider,
        },
        $unset: {
          lease_until: 1,
          last_error_code: 1,
          'safe_payload.delivery': 1,
          'safe_payload.delivery_expires_at': 1,
        },
      });
    } catch (error) {
      const obsolete = error instanceof ObsoleteDelivery;
      const permanent =
        obsolete ||
        job.attempt_count >= NOTIFICATION_MAX_ATTEMPTS ||
        (error instanceof DeliveryError && error.permanent);
      const code = obsolete ? 'OBSOLETE_NOTIFICATION' : error instanceof DeliveryError ? error.code : 'DELIVERY_FAILED';
      await mongoose.connection.transaction(async (session) => {
        const changed = await NotificationLogModel.updateOne(
          ownership,
          {
            $set: {
              status: permanent ? 'DEAD' : 'FAILED_RETRY',
              last_error_code: code,
              next_retry_at: new Date(Date.now() + 15 * 60000 * 2 ** Math.min(job.attempt_count - 1, 3)),
            },
            $unset: {
              lease_until: 1,
              ...(permanent ? { 'safe_payload.delivery': 1, 'safe_payload.delivery_expires_at': 1 } : {}),
            },
          },
          { session },
        );
        if (changed.matchedCount && permanent && !obsolete && job.template_id !== 'operational-alert')
          await enqueueOperatorAlert(env, 'EMAIL_DELIVERY_EXHAUSTED', job._id, `email-dead:${job._id}`, session);
      });
      if (!obsolete) logger.warn('Email delivery attempt failed', { notification_id: job._id, error_code: code });
    }
  }
  async function drain() {
    if (!transport.ready()) return;
    for (let count = 0; count < (options.batchSize ?? 50) && !stopped; count++) {
      const now = new Date();
      const job = await NotificationLogModel.findOneAndUpdate(
        {
          kind: 'EMAIL',
          $or: [
            { status: { $in: ['PENDING', 'FAILED', 'FAILED_RETRY'] }, next_retry_at: { $lte: now } },
            { status: 'PROCESSING', lease_until: { $lte: now } },
          ],
        },
        {
          $set: { status: 'PROCESSING', lease_until: new Date(now.getTime() + NOTIFICATION_LEASE_MS) },
          $min: { first_attempt_at: now },
          $inc: { attempt_count: 1 },
        },
        { sort: { 'safe_payload.priority': -1, created_at: 1, _id: 1 }, returnDocument: 'after' },
      ).lean();
      if (!job) break;
      await process(job);
    }
  }
  const dispatch = () => {
    requested = true;
    active ??= (async () => {
      do {
        requested = false;
        await drain();
      } while (requested && !stopped);
    })()
      .catch(() => {
        logger.error('Notification worker failed; lease recovery will retry');
      })
      .finally(() => {
        active = undefined;
      });
    return active;
  };
  async function securityEvent(event: SecurityEvent) {
    const owner = await AdminModel.findOne({ singleton_key: 'SUPER_ADMIN', is_active: true })
      .select({ _id: 1, email: 1 })
      .lean();
    if (!owner) return;
    await NotificationLogModel.create({
      dedupe_key: `security:${event.event}:${event.request_id}`,
      entity_type: 'admins',
      entity_id: owner._id,
      kind: 'EMAIL',
      recipient: env.ADMIN_ALERT_EMAIL ?? owner.email,
      template_id: 'admin-security-alert',
      safe_payload: {
        priority: event.severity,
        alert_code: event.event,
        security: {
          occurred_at: event.occurred_at,
          ip_address: event.ip_address,
          country: event.country,
          city: event.city,
          user_agent: event.user_agent,
          new_ip: event.new_ip,
          foreign_ip: event.foreign_ip,
        },
      },
      status: 'PENDING',
      next_retry_at: new Date(),
    });
    void dispatch();
  }
  function stop() {
    stopped = true;
  }
  async function close() {
    stop();
    await active;
  }
  return { dispatch, close, stop, securityEvent };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
