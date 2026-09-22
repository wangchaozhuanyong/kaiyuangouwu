import { ScheduledTask } from '@vendure/core';

import { AdminNotificationService } from './admin-notification.service';
import { IncidentResponseService } from './incident-response.service';

export const reconcileAdminNotificationsTask = new ScheduledTask({
    id: 'reconcile-admin-telegram-notifications',
    description: 'Dispatch due notifications and escalate overdue incident response stages',
    schedule: '* * * * *',
    timeout: '1m',
    async execute({ injector }) {
        const notifications = injector.get(AdminNotificationService);
        const incidents = injector.get(IncidentResponseService);
        const acknowledgementEscalated = await notifications.escalateOverdue();
        const workflowEscalated = await incidents.escalateWorkflowOverdue();
        const dispatched = await notifications.dispatchDue();
        return { dispatched, acknowledgementEscalated, workflowEscalated };
    },
});
