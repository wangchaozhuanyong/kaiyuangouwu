import { describe, expect, it } from 'vitest';

import {
    ACCOUNT_PASSWORD_MAX_LENGTH,
    ACCOUNT_PASSWORD_MIN_LENGTH,
    validateAccountPassword,
} from './auth-validation';

describe('account password validation', () => {
    it('accepts passwords within the supported length when both values match', () => {
        const password = 'secure-password';
        expect(validateAccountPassword(password, password, 'en')).toBeNull();
    });

    it('returns localized length errors', () => {
        expect(validateAccountPassword('short', 'short', 'zh')).toContain(
            String(ACCOUNT_PASSWORD_MIN_LENGTH),
        );
        expect(validateAccountPassword('x'.repeat(ACCOUNT_PASSWORD_MAX_LENGTH + 1), '', 'en')).toContain(
            String(ACCOUNT_PASSWORD_MAX_LENGTH),
        );
    });

    it('rejects mismatched confirmation values', () => {
        expect(validateAccountPassword('secure-password', 'different-password', 'en')).toBe(
            'The passwords do not match',
        );
    });
});
