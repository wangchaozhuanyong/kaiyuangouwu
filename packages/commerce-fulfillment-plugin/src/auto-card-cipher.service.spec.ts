import { afterEach, describe, expect, it } from 'vitest';

import { AutoCardCipherService } from './auto-card-cipher.service';

const originalKey = process.env.AUTO_CARD_ENCRYPTION_KEY;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
    process.env.AUTO_CARD_ENCRYPTION_KEY = originalKey;
    process.env.NODE_ENV = originalNodeEnv;
});

describe('AutoCardCipherService', () => {
    it('encrypts authenticated payloads and produces stable fingerprints', () => {
        process.env.NODE_ENV = 'test';
        process.env.AUTO_CARD_ENCRYPTION_KEY = 'a-secure-auto-card-key-with-more-than-32-characters';
        const service = new AutoCardCipherService();
        const values = { account: 'buyer@example.com', password: 'secret' };

        const encrypted = service.encrypt(values);
        expect(encrypted).not.toContain('buyer@example.com');
        expect(service.decrypt(encrypted)).toEqual(values);
        expect(service.fingerprint('1', values)).toBe(service.fingerprint('1', values));
        expect(service.fingerprint('2', values)).not.toBe(service.fingerprint('1', values));
    });

    it('rejects placeholder keys in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTO_CARD_ENCRYPTION_KEY = 'replace-with-a-random-secret-at-least-32-characters';
        expect(() => new AutoCardCipherService()).toThrow('AUTO_CARD_ENCRYPTION_KEY');
    });
});
