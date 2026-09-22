import { ScheduledTask } from '@vendure/core';

import { FulfillmentDeliveryService } from './fulfillment-delivery.service';

export const reconcileFulfillmentDeliveriesTask = new ScheduledTask({
    id: 'reconcile-fulfillment-deliveries',
    description: 'Escalate carrier exceptions and physical shipments past their follow-up deadline',
    schedule: cron => cron.every(30).minutes(),
    async execute({ injector }) {
        return injector.get(FulfillmentDeliveryService).reconcileOverdue();
    },
});
