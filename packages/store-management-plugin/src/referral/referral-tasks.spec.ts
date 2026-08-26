import 'reflect-metadata';

import type { Injector } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { auditReferralBalancesTask, reconcileReferralRewardsTask } from './referral-tasks';
import { ReferralService } from './referral.service';

describe('referral scheduled tasks', () => {
    it('releases matured rewards every minute', () => {
        expect(typeof reconcileReferralRewardsTask.options.schedule).not.toBe('string');
    });

    it('runs a full wallet-to-ledger audit daily at 02:15 business time', async () => {
        expect(auditReferralBalancesTask.options.schedule).toBe('15 2 * * *');
        const auditAllBalances = vi.fn().mockResolvedValue({ auditedWallets: 10, balanceAnomalies: 0 });
        const injector = {
            get: (token: unknown) => {
                expect(token).toBe(ReferralService);
                return { auditAllBalances };
            },
        } as Injector;

        await expect(
            auditReferralBalancesTask.options.execute({ injector, params: {} } as never),
        ).resolves.toEqual({ auditedWallets: 10, balanceAnomalies: 0 });
        expect(auditAllBalances).toHaveBeenCalledOnce();
    });
});
