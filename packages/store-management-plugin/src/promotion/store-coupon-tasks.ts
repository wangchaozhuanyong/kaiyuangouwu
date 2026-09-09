import { ScheduledTask } from '@vendure/core';

import { StoreCouponClosureRepairService } from './store-coupon-closure-repair.service';
import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';

export const reconcileStoreCouponsTask = new ScheduledTask({
    id: 'reconcile-store-coupons',
    description: 'Expire customer coupons and release abandoned checkout locks',
    schedule: cron => cron.every(1).minutes(),
    async execute({ injector }) {
        const expiry = await injector.get(StoreCouponLifecycleService).reconcile();
        const closure = await injector.get(StoreCouponClosureRepairService).reconcile();
        return { ...expiry, ...closure };
    },
});
