import { ScheduledTask } from '@vendure/core';

import { AutoCardService } from './auto-card.service';

export const reconcileAutoCardDeliveriesTask = new ScheduledTask({
    id: 'reconcile-auto-card-deliveries',
    description: 'Allocate replenished credential pools and retry stalled auto-card delivery emails',
    schedule: cron => cron.every(5).minutes(),
    async execute({ injector }) {
        return injector.get(AutoCardService).reconcilePending();
    },
});
