import { ScheduledTask } from '@vendure/core';

import { AdminNotificationService } from './admin-notification.service';
import { IncidentResponseService } from './incident-response.service';
import { SecurityNotificationService } from './security-notification.service';

export const reconcileAdminNotificationsTask = new ScheduledTask({
    id: 'reconcile-admin-telegram-notifications',
    description: '派发到期通知并核验持续告警、处置流程与账号失败窗口',
    schedule: '* * * * *',
    timeout: '1m',
    async execute({ injector }) {
        const notifications = injector.get(AdminNotificationService);
        await injector.get(SecurityNotificationService).reconcile();
        const incidents = injector.get(IncidentResponseService);
        const acknowledgementEscalated = await notifications.escalateOverdue();
        const workflowEscalated = await incidents.escalateWorkflowOverdue();
        const dispatched = await notifications.dispatchDue();
        return { dispatched, acknowledgementEscalated, workflowEscalated };
    },
});
