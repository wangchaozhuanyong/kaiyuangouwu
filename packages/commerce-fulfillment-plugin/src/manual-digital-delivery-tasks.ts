import { ScheduledTask } from '@vendure/core';

import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';

export const reconcileManualDigitalDeliveriesTask = new ScheduledTask({
    id: 'reconcile-manual-digital-deliveries',
    description: 'Retry failed manual-delivery email jobs and complete pending fulfillments',
    schedule: cron => cron.every(5).minutes(),
    async execute({ injector }) {
        return injector.get(ManualDigitalDeliveryService).reconcilePending();
    },
});
