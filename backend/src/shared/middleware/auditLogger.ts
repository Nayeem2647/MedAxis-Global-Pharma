import type { ClientSession } from 'mongoose';
import { AuditLogModel, type IAuditLog } from '../../modules/audit/audit.schema.js';
import { redact } from '../utils/logger.js';

export interface AuditEvent {
  actor_type: IAuditLog['actor_type'];
  actor_id?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata?: Record<string, unknown>;
  old_status?: string;
  new_status?: string;
}

/** Append only. Map API terminology to the canonical database field names. */
export async function writeAuditLog(
  request: { requestId: string; clientIp?: string; get(name: string): string | undefined },
  event: AuditEvent,
  session?: ClientSession,
): Promise<void> {
  const record = new AuditLogModel({
    actor_type: event.actor_type,
    actor_id: event.actor_id,
    action_type: event.action,
    old_status: event.old_status,
    new_status: event.new_status,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    request_id: request.requestId,
    ip_address: request.clientIp,
    user_agent: request.get('user-agent')?.slice(0, 2000),
    safe_changes: redact(event.metadata ?? {}),
  });
  await record.save({ session });
}
