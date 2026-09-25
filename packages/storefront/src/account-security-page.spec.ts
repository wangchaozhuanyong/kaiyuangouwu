import { describe, expect, it } from 'vitest';

import {
    CUSTOMER_AVATAR_MAX_BYTES,
    canAppealFraudRiskCase,
    customerAvatarValidationMessage,
    riskCaseDescription,
} from './account-security-page';

describe('customerAvatarValidationMessage', () => {
    it('accepts supported images up to 5MB', () => {
        expect(customerAvatarValidationMessage({ type: 'image/jpeg', size: 1 }, 'zh')).toBeNull();
        expect(
            customerAvatarValidationMessage({ type: 'image/webp', size: CUSTOMER_AVATAR_MAX_BYTES }, 'en'),
        ).toBeNull();
    });

    it('rejects empty, unsupported, and oversized files with localized feedback', () => {
        expect(customerAvatarValidationMessage({ type: 'image/png', size: 0 }, 'zh')).toBe(
            '请选择有效的头像图片',
        );
        expect(customerAvatarValidationMessage({ type: 'image/gif', size: 20 }, 'en')).toBe(
            'Use a JPG, PNG, or WebP image.',
        );
        expect(
            customerAvatarValidationMessage({ type: 'image/png', size: CUSTOMER_AVATAR_MAX_BYTES + 1 }, 'zh'),
        ).toBe('头像图片不能超过 5MB');
    });
});

describe('customer risk case presentation', () => {
    it('uses account-safe wording and the actual review outcome', () => {
        expect(riskCaseDescription({ orderId: null, status: 'OPEN' }, 'zh')).not.toContain('订单');
        expect(riskCaseDescription({ orderId: null, status: 'APPROVED' }, 'zh')).toContain('已通过');
        expect(riskCaseDescription({ orderId: 'ORD-1', status: 'APPROVED' }, 'en')).toContain(
            'continue checkout',
        );
        expect(riskCaseDescription({ orderId: 'ORD-1', status: 'REJECTED' }, 'zh')).toContain('未通过复核');
    });

    it('does not offer a second appeal after the first one was reviewed', () => {
        expect(canAppealFraudRiskCase({ status: 'REJECTED', appeals: [] })).toBe(true);
        expect(
            canAppealFraudRiskCase({
                status: 'REJECTED',
                appeals: [
                    {
                        id: 'appeal-1',
                        createdAt: '2026-09-25T00:00:00Z',
                        status: 'REJECTED',
                        reason: 'Fixture',
                        reviewedAt: '2026-09-25T01:00:00Z',
                    },
                ],
            }),
        ).toBe(false);
        expect(canAppealFraudRiskCase({ status: 'APPROVED', appeals: [] })).toBe(false);
    });
});
