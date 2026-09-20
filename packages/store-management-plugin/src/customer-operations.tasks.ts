import { ScheduledTask } from '@vendure/core';

import { CustomerOperationsService } from './customer-operations.service';

export const reconcileCustomerOperationsTask = new ScheduledTask({
    id: 'reconcile-customer-operations',
    description: 'Refresh customer RFM segments and escalate overdue follow-up tasks',
    schedule: cron => cron.every(6).hours(),
    execute({ injector }) {
        return injector.get(CustomerOperationsService).reconcileAll();
    },
});
