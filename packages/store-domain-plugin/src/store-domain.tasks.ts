import { ScheduledTask } from '@vendure/core';

import { StoreDomainService } from './store-domain.service';

export const reconcileAutomatedStoreDomainsTask = new ScheduledTask({
    id: 'reconcile-automated-store-domains',
    description: 'Reconcile pending Cloudflare custom hostnames and SSL certificates',
    schedule: cron => cron.every(1).minutes(),
    async execute({ injector }) {
        const reconciled = await injector.get(StoreDomainService).reconcilePending();
        return { reconciled };
    },
});
