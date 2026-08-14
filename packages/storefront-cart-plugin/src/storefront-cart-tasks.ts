import { ScheduledTask } from '@vendure/core';

import { StorefrontCartLifecycleService } from './storefront-cart-lifecycle.service';

export const reconcileStorefrontCartCheckoutsTask = new ScheduledTask({
    id: 'reconcile-storefront-cart-checkouts',
    description: 'Complete storefront carts whose Vendure orders were already placed',
    schedule: cron => cron.every(15).minutes(),
    async execute({ injector }) {
        const lifecycleService = injector.get(StorefrontCartLifecycleService);
        const reconciled = await lifecycleService.reconcilePlacedCheckouts();
        return { reconciled };
    },
});
