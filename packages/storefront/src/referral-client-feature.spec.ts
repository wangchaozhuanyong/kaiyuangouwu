import { describe, expect, it } from 'vitest';

import { isReferralClientFeatureEnabled } from './referral-client-feature';

describe('referral client feature gate', () => {
    it('shows client entry points only when the backend program is enabled', () => {
        expect(isReferralClientFeatureEnabled({ enabled: true })).toBe(true);
        expect(isReferralClientFeatureEnabled({ enabled: false })).toBe(false);
        expect(isReferralClientFeatureEnabled(undefined)).toBe(false);
    });
});
