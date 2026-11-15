import { EventEmitter } from 'node:events';
import type { AppLogger } from '../../shared/utils/logger.js';

export interface NewRfqEvent {
  type: 'NEW_RFQ';
  rfq_id: string;
  rfq_number: string;
  created_at: string;
}
export interface RfqHooks {
  onNewRfq?: (event: NewRfqEvent) => void | Promise<void>;
  dispatchNotifications?: () => void | Promise<void>;
}
/** Step 7's SSE transport can subscribe here; messages contain no contact or medical content. */
export const rfqEvents = new EventEmitter();
export function createRfqSignals(logger: AppLogger, hooks: RfqHooks = {}) {
  const safe = (work: () => unknown, requestId: string) => {
    void Promise.resolve()
      .then(work)
      .catch(() => logger.warn('RFQ post-commit hook failed', { request_id: requestId }));
  };
  const notifications = (requestId: string) => {
    safe(() => {
      rfqEvents.emit('NOTIFICATIONS_READY');
      return hooks.dispatchNotifications?.();
    }, requestId);
  };
  const submitted = (event: NewRfqEvent, requestId: string) => {
    safe(() => rfqEvents.emit('NEW_RFQ', event), requestId);
    if (hooks.onNewRfq) safe(() => hooks.onNewRfq!(event), requestId);
    notifications(requestId);
  };
  return { notifications, submitted };
}
export type RfqSignals = ReturnType<typeof createRfqSignals>;
