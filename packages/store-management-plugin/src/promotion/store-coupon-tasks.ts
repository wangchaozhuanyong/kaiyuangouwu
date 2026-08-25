import { ScheduledTask } from '@vendure/core';

import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';

export const reconcileStoreCouponsTask = new ScheduledTask({
    id: 'reconcile-store-coupons',
    description: 'Expire customer coupons and release abandoned checkout locks',
    schedule: cron => cron.every(1).minutes(),
    async execute({ injector }) {
        return injector.get(StoreCouponLifecycleService).reconcile();
    },
});
