import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { AppEnv } from '../config/env.js';
import type { AppLogger } from '../shared/utils/logger.js';
import { writeAuditLog } from '../shared/middleware/auditLogger.js';
import { PrescriptionModel } from '../modules/storage/storage.schema.js';
import type { StorageService } from '../modules/storage/storage.service.js';
import { enqueueOperatorAlert } from '../modules/notification/notification.alerts.js';
import { dhakaDate } from './expiryReminder.job.js';

export function createPrescriptionPurgeJob(env: AppEnv, logger: AppLogger, storage: Pick<StorageService, 'remove'>) {
  return async (now = new Date()) => {
    let purged = 0;
    for (let count = 0; count < 100; count++) {
      // next_retry_at doubles as a DELETING lease, preserving the canonical prescription schema.
      const lease = new Date(Math.max(Date.now(), now.getTime()) + 120000);
      const row = await PrescriptionModel.findOneAndUpdate(
        {
          purge_status: { $ne: 'PURGED' },
          $and: [
            {
              $or: [
                { purge_scheduled_at: { $lte: now } },
                { uploaded_at: { $lte: new Date(now.getTime() - 90 * 86400000) } },
              ],
            },
            { $or: [{ next_retry_at: { $exists: false } }, { next_retry_at: { $lte: now } }] },
          ],
        },
        { $set: { purge_status: 'DELETING', next_retry_at: lease }, $inc: { retry_count: 1 } },
        { sort: { purge_scheduled_at: 1 }, returnDocument: 'after' },
      ).lean();
      if (!row) break;
      const ownership = { _id: row._id, purge_status: 'DELETING' as const, next_retry_at: lease };
      try {
        const key = row.object_key ?? row.r2_storage_key;
        if (!key || !/^prescriptions\/(?:local|s3)\//.test(key)) throw new Error('Legacy storage requires migration before deletion');
        await storage.remove('prescriptions', key); // Must complete before *any* PURGED metadata write.
        const committed = await mongoose.connection.transaction(async (session) => {
          const changed = await PrescriptionModel.updateOne(
            ownership,
            {
              $set: { purge_status: 'PURGED', purged_at: new Date() },
              $unset: { object_key: 1, r2_storage_key: 1, encryption: 1, next_retry_at: 1 },
            },
            { session },
          );
          if (!changed.matchedCount) return false;
          await writeAuditLog(
            { requestId: randomUUID(), get: () => undefined },
            { actor_type: 'SYSTEM', action: 'PRESCRIPTION_PURGED', entity_type: 'prescriptions', entity_id: row._id },
            session,
          );
          return true;
        });
        if (committed) purged++;
      } catch {
        const updated = await PrescriptionModel.updateOne(ownership, {
          $set: {
            purge_status: 'PENDING',
            next_retry_at: new Date(
              Math.max(Date.now(), now.getTime()) +
                Math.min(3600000, 15 * 60000 * 2 ** Math.min(row.retry_count - 1, 3)),
            ),
          },
        });
        logger.warn('Prescription purge failed; protected metadata retained for retry', { prescription_id: row._id });
        if (
          updated.matchedCount &&
          (row.retry_count >= 3 || row.purge_scheduled_at.getTime() <= now.getTime() - 3600000)
        )
          await enqueueOperatorAlert(
            env,
            'PRESCRIPTION_PURGE_OVERDUE',
            row._id,
            `purge-alert:${row._id}:${dhakaDate(now)}`,
          );
      }
    }
    return purged;
  };
}
