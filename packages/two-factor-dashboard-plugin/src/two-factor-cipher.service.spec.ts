import { afterEach, describe, expect, it } from 'vitest';

import { TwoFactorCipherService } from './two-factor-cipher.service';

const originalKey = process.env.TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
    process.env.TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY = originalKey;
    process.env.NODE_ENV = originalNodeEnv;
});

describe('TwoFactorCipherService', () => {
    it('encrypts secrets at rest and scopes stable fingerprints by administrator', () => {
        process.env.NODE_ENV = 'test';
        process.env.TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY =
            'dashboard-two-factor-test-key-with-more-than-32-characters';
        const service = new TwoFactorCipherService();
        const secret = 'JBSWY3DPEHPK3PXP';

        const encrypted = service.encrypt(secret);
        expect(encrypted).not.toContain(secret);
        expect(service.decrypt(encrypted)).toBe(secret);
        expect(service.fingerprint('admin-1', secret)).toBe(service.fingerprint('admin-1', secret));
        expect(service.fingerprint('admin-2', secret)).not.toBe(service.fingerprint('admin-1', secret));
    });

    it('rejects missing or placeholder keys in production', () => {
        process.env.NODE_ENV = 'production';
        for (const key of ['', 'replace-with-a-random-secret-at-least-32-characters']) {
            process.env.TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY = key;
            expect(() => new TwoFactorCipherService()).toThrow('TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY');
        }
    });
});
