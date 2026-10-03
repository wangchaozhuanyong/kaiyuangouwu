import { ScheduledTask } from '@vendure/core';

import { PlatformStoreNotificationService } from './platform-store-notification.service';
import { StoreAvailabilityService } from './store-availability.service';
export const reconcileStoreNotificationsTask = new ScheduledTask({
    id: 'reconcile-platform-store-notifications',
    description: '汇总全店在线人数并检查库存和活动到期',
    schedule: cron => cron.every(1).minutes(),
    timeout: '5m',
    execute: ({ injector }) => injector.get(PlatformStoreNotificationService).reconcile(),
});

export const reconcileStoreAvailabilityTask = new ScheduledTask({
    id: 'reconcile-store-availability-notifications',
    description: '核验实际店铺入口与网站证书',
    schedule: '*/10 * * * *',
    timeout: '5m',
    async execute({ injector }) {
        await injector.get(StoreAvailabilityService).reconcile();
    },
});
