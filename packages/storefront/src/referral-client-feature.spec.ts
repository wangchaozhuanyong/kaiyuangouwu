import { describe, expect, it } from 'vitest';

import {
    isReferralClientFeatureEnabled,
    readCachedReferralProgram,
    writeCachedReferralProgram,
} from './referral-client-feature';
import { ReferralProgram } from './types';

describe('referral client feature gate', () => {
    it('shows client entry points only when the backend program is enabled', () => {
        expect(isReferralClientFeatureEnabled({ enabled: true })).toBe(true);
        expect(isReferralClientFeatureEnabled({ enabled: false })).toBe(false);
        expect(isReferralClientFeatureEnabled(undefined)).toBe(false);
    });

    it('persists and restores referral program cache for zero-shift initialization', () => {
        const store = new Map<string, string>();
        const storageMock = {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => store.set(key, value),
            removeItem: (key: string) => store.delete(key),
            clear: () => store.clear(),
            length: 0,
            key: () => null,
        } as unknown as Storage;
        Object.defineProperty(globalThis, 'localStorage', {
            value: storageMock,
            configurable: true,
            writable: true,
        });

        const dummyProgram: ReferralProgram = {
            channelId: 'channel-1',
            enabled: true,
            rewardRate: 10,
            releaseDelayDays: 0,
            minimumOrderAmount: 0,
            maxRewardPerOrder: null,
            allowBalanceSpend: true,
            attributionWindowDays: 30,
            defaultPosterTemplate: 'BRAND_MINIMAL',
            posterTemplates: ['BRAND_MINIMAL'],
        };
        writeCachedReferralProgram('test-market', dummyProgram);
        const cached = readCachedReferralProgram('test-market');
        expect(cached?.enabled).toBe(true);
        expect(isReferralClientFeatureEnabled(cached)).toBe(true);
    });
});
