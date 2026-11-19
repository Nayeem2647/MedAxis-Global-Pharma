import { randomUUID } from 'node:crypto';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { bankDetailsSchema } from '../../shared/validators/quotation.validator.js';
import { NotificationLogModel } from '../notification/notification.schema.js';
import { QuotationModel, QuotationVersionModel } from '../quotation/quotation.schema.js';
import { commercialQuotation, COMMERCIAL_PROJECTION } from '../quotation/quotation.dto.js';
import { isAccepted } from '../quotation/quotation.lifecycle.js';
import { PlatformSettingModel } from '../settings/settings.schema.js';
import { createStorageService, type StorageService } from '../storage/storage.service.js';
import { createPdfService, type PdfRenderer } from './pdf.service.js';
import type { PdfMode } from './pdf.template.js';

export interface PdfArtifact {
  bytes: Buffer;
  mode: PdfMode;
}
export interface PdfDelivery {
  get(versionId: string): Promise<PdfArtifact>;
  dispatch(): void | Promise<void>;
}
export function createPdfRuntime(
  env: AppEnv,
  logger: AppLogger,
  options: { storage?: StorageService; renderer?: PdfRenderer } = {},
) {
  const storage = options.storage ?? createStorageService(env);
  const renderer = options.renderer ?? createPdfService({ executablePath: env.PUPPETEER_EXECUTABLE_PATH });
  const pending = new Map<string, Promise<PdfArtifact>>();
  let draining: Promise<void> | undefined;
  let requested = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  async function produce(versionId: string): Promise<PdfArtifact> {
    const version = await QuotationVersionModel.findById(versionId).select(`${COMMERCIAL_PROJECTION} pdf`).lean();
    if (!version) throw AppError.notFound();
    const accepted = isAccepted(version.status);
    const mode = accepted ? 'ACCEPTED_QUOTE' : 'ORIGINAL_QUOTE';
    if (!accepted && version.status !== 'SENT') throw AppError.conflict('PDF is not available in this state.');
    const variant = accepted ? 'accepted' : 'original';
    const path = `pdf.${variant}`;
    const artifact = version.pdf?.[variant];
    const savedKey = artifact && typeof artifact === 'object'
      ? ('object_key' in artifact ? artifact.object_key : 'r2_object_key' in artifact ? artifact.r2_object_key : undefined)
      : undefined;
    if (typeof savedKey === 'string') {
      try {
        return { bytes: await storage.download('quotes', savedKey), mode };
      } catch {
        /* Regenerate a missing private object without exposing its key. */
      }
    }
    const quote = await QuotationModel.findOne({ _id: version.quotation_id, current_version_id: versionId })
      .select({ quotation_number: 1 })
      .lean();
    if (!quote) throw AppError.conflict('Quotation version changed.');
    const configured =
      version.bank_details_snapshot ??
      (await PlatformSettingModel.findOne({ key: 'wire_instructions' }).select({ value: 1 }).lean())?.value;
    const bank = bankDetailsSchema.safeParse(configured);
    if (!bank.success) throw AppError.unavailable('Verified bank wire instructions are required for PDF generation.');
    const bytes = await renderer.render({
      version: commercialQuotation(version),
      quotation_number: quote.quotation_number,
      wire_details: bank.data,
      branding: { name: 'MedAxis Global Pharma', email: env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] },
      mode,
    });
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) || bytes.length > 25 * 1024 * 1024)
      throw AppError.unavailable('Invalid PDF output.');
    const key = `quotes/${env.STORAGE_DRIVER === 'local' ? 'local' : 's3'}/${versionId}/${variant}-${randomUUID()}.pdf`;
    await storage.upload('quotes', key, bytes, 'application/pdf');
    try {
      const updated = await QuotationVersionModel.updateOne(
        {
          _id: versionId,
          status: accepted ? { $in: ['ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED'] } : 'SENT',
          [path]: artifact ?? { $exists: false },
        },
        { $set: { [path]: { object_key: key, generated_at: new Date(), mode } } },
      );
      if (!updated.matchedCount) {
        throw AppError.conflict('Quotation or PDF changed during rendering.');
      }
    } catch (error) {
      if (error instanceof AppError && error.status === 409)
        await storage.remove('quotes', key).catch(() => logger.warn('Unable to remove abandoned quote PDF'));
      throw error;
    }
    return { bytes, mode };
  }
  async function get(versionId: string): Promise<PdfArtifact> {
    if (stopped) throw AppError.unavailable();
    const existing = pending.get(versionId);
    if (existing) return existing;
    const result = produce(versionId).finally(() => {
      pending.delete(versionId);
    });
    pending.set(versionId, result);
    return result;
  }
  async function drain() {
    for (let count = 0; count < 20 && !stopped; count++) {
      const now = new Date();
      const lease = new Date(now.getTime() + 60_000);
      const job = await NotificationLogModel.findOneAndUpdate(
        {
          kind: 'PDF_RENDER',
          $or: [
            { status: { $in: ['PENDING', 'FAILED'] }, next_retry_at: { $lte: now } },
            { status: 'PROCESSING', lease_until: { $lte: now } },
          ],
        },
        { $set: { status: 'PROCESSING', lease_until: lease }, $inc: { attempt_count: 1 } },
        { sort: { created_at: 1 }, returnDocument: 'after' },
      ).lean();
      if (!job) break;
      const ownership = { _id: job._id, status: 'PROCESSING' as const, lease_until: lease };
      try {
        let artifact = await get(job.entity_id);
        if (job.safe_payload.mode !== 'ORIGINAL_QUOTE' && artifact.mode === 'ORIGINAL_QUOTE')
          artifact = await get(job.entity_id);
        if (job.safe_payload.mode !== 'ORIGINAL_QUOTE' && artifact.mode === 'ORIGINAL_QUOTE') throw AppError.conflict();
        const obsolete = job.safe_payload.mode === 'ORIGINAL_QUOTE' && artifact.mode !== 'ORIGINAL_QUOTE';
        await NotificationLogModel.updateOne(ownership, {
          $set: { status: obsolete ? 'DEAD' : 'SENT', sent_at: new Date() },
          $unset: { lease_until: 1, last_error_code: 1 },
        });
      } catch {
        await NotificationLogModel.updateOne(ownership, {
          $set: {
            status: job.attempt_count >= 3 ? 'DEAD' : 'FAILED',
            last_error_code: 'PDF_RENDER_FAILED',
            next_retry_at: new Date(Date.now() + 60_000 * 2 ** Math.min(job.attempt_count, 6)),
          },
          $unset: { lease_until: 1 },
        });
        logger.warn('Quote PDF job failed', { notification_id: job._id });
      }
    }
  }
  const dispatch = () => {
    requested = true;
    draining ??= (async () => {
      do {
        requested = false;
        await drain();
      } while (requested && !stopped);
    })()
      .catch(() => {
        logger.error('PDF worker failed');
      })
      .finally(() => {
        draining = undefined;
      });
    return draining;
  };
  function start() {
    if (!timer) {
      timer = setInterval(() => {
        void dispatch();
      }, 15_000);
      timer.unref();
      void dispatch();
    }
  }
  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  async function close() {
    stop();
    await renderer.close();
    await draining;
    await Promise.allSettled([...pending.values()]);
  }
  return { get, dispatch, start, stop, close };
}
