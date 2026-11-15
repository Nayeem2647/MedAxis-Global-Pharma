import type { NotificationService } from '../modules/notification/notification.service.js';
export const createNotificationRetryJob = (notifications: Pick<NotificationService, 'dispatch'>) => () =>
  notifications.dispatch();
