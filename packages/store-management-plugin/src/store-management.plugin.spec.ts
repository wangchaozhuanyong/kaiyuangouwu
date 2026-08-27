import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreManagementPlugin } from './store-management.plugin';

describe('StoreManagementPlugin promotion options', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        StoreManagementPlugin.init({ enabled: false });
    });

    it('requires a strong signing secret for the referral balance handler in production', () => {
        vi.stubEnv('NODE_ENV', 'production');

        expect(() => StoreManagementPlugin.init({ enabled: false, signingSecret: 'short' })).toThrow(
            'at least 32 characters',
        );
    });

    it('enables secure cookies and removes development host bypasses by default in production', () => {
        vi.stubEnv('NODE_ENV', 'production');

        StoreManagementPlugin.init({
            signingSecret: 'production-promotion-secret-that-is-long-enough',
        });

        expect(StoreManagementPlugin.promotionOptions).toMatchObject({
            enabled: true,
            secureCookie: true,
            bypassHosts: [],
        });
    });
});
