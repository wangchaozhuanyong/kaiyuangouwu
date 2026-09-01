import { describe, expect, it } from 'vitest';

import { CUSTOMER_AVATAR_MAX_BYTES, customerAvatarValidationMessage } from './account-security-page';

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
