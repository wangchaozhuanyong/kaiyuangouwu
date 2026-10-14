import { ConfigService, ScheduledTask } from '@vendure/core';

import { AutoCardService } from './auto-card.service';
import { DeliveryRecoveryCursors } from './delivery-recovery-scan';

export const reconcileAutoCardDeliveriesTask = new ScheduledTask({
    id: 'reconcile-auto-card-deliveries',
    description: 'Allocate replenished credential pools and retry stalled auto-card delivery emails',
    schedule: cron => cron.every(5).minutes(),
    async execute({ injector, signal }) {
        const previous = await injector
            .get(ConfigService)
            .schedulerOptions.schedulerStrategy.getTask('reconcile-auto-card-deliveries');
        const scanCursors: DeliveryRecoveryCursors = { ...previous?.lastResult?.scanCursors };
        const result = await injector.get(AutoCardService).reconcilePending(scanCursors, signal);
        return { ...result, scanCursors };
    },
});
