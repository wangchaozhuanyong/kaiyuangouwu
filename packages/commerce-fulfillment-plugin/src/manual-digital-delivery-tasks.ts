import { ConfigService, ScheduledTask } from '@vendure/core';

import { DeliveryRecoveryCursors } from './delivery-recovery-scan';
import { ManualDigitalDeliveryService } from './manual-digital-delivery.service';

export const reconcileManualDigitalDeliveriesTask = new ScheduledTask({
    id: 'reconcile-manual-digital-deliveries',
    description: 'Retry failed manual-delivery email jobs and complete pending fulfillments',
    schedule: cron => cron.every(5).minutes(),
    async execute({ injector, signal }) {
        const previous = await injector
            .get(ConfigService)
            .schedulerOptions.schedulerStrategy.getTask('reconcile-manual-digital-deliveries');
        const scanCursors: DeliveryRecoveryCursors = { ...previous?.lastResult?.scanCursors };
        const result = await injector.get(ManualDigitalDeliveryService).reconcilePending(scanCursors, signal);
        return { ...result, scanCursors };
    },
});
