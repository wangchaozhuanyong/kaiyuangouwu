import { ScheduledTask } from '@vendure/core';

import { AdminNotificationService } from './admin-notification.service';

export const reconcileAdminNotificationsTask = new ScheduledTask({
    id: 'reconcile-admin-telegram-notifications',
    description: 'Dispatch due Telegram notification outbox rows and escalate overdue P1 incidents',
    schedule: '* * * * *',
    timeout: '1m',
    async execute({ injector }) {
        const notifications = injector.get(AdminNotificationService);
        const escalated = await notifications.escalateOverdue();
        const dispatched = await notifications.dispatchDue();
        return { dispatched, escalated };
    },
});
