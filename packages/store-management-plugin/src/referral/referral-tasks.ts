import { ScheduledTask } from '@vendure/core';

import { ReferralService } from './referral.service';

export const reconcileReferralRewardsTask = new ScheduledTask({
    id: 'reconcile-referral-rewards',
    description: 'Release matured referral rewards',
    schedule: cron => cron.every(1).minutes(),
    async execute({ injector }) {
        return injector.get(ReferralService).reconcile();
    },
});

/** Runs after the business day closes in the application's Asia/Shanghai timezone. */
export const auditReferralBalancesTask = new ScheduledTask({
    id: 'audit-referral-balances',
    description: 'Audit referral wallet balances against the immutable ledger',
    schedule: '15 2 * * *',
    async execute({ injector }) {
        return injector.get(ReferralService).auditAllBalances();
    },
});
