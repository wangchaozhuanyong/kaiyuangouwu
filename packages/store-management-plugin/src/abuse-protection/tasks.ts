import { Logger, ScheduledTask } from '@vendure/core';

import { ShopAbuseStore } from './store';

/** No business data: only expired counters and challenges, with active cooldown predicates rechecked on deletion. */
export const pruneShopAbuseStateTask = new ScheduledTask({
    id: 'prune-expired-shop-abuse-state',
    description: 'Remove expired shop security counters and challenges in bounded batches',
    schedule: cron => cron.everyMinute(),
    async execute({ injector }) {
        const store = injector.get(ShopAbuseStore);
        let buckets = 0;
        let challenges = 0;
        for (let batch = 0; batch < 100; batch++) {
            const removed = await store.pruneExpired();
            buckets += removed.buckets;
            challenges += removed.challenges;
            if (removed.buckets < 200 && removed.challenges < 200)
                return { buckets, challenges, bounded: false };
        }
        Logger.warn(
            'Shop security expiry cleanup reached its batch limit; check scheduler throughput',
            'ShopAbuseProtection',
        );
        return { buckets, challenges, bounded: true };
    },
});
