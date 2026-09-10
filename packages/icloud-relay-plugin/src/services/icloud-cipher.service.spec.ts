import { describe, expect, it } from 'vitest';

import { IcloudCipherService } from './icloud-cipher.service';

describe('IcloudCipherService', () => {
    const cipher = new IcloudCipherService({ encryptionKey: 'test-secret-key-for-unit-testing' });

    it('should encrypt and decrypt a plain text round-trip', () => {
        const password = 'abcd-efgh-ijkl-mnop';
        const encrypted = cipher.encrypt(password);
        expect(encrypted).not.toBe(password);
        expect(encrypted).toContain(':');

        const decrypted = cipher.decrypt(encrypted);
        expect(decrypted).toBe(password);
    });

    it('should handle empty strings', () => {
        expect(cipher.encrypt('')).toBe('');
        expect(cipher.decrypt('')).toBe('');
    });

    it('should return plain text for non-encrypted format (legacy)', () => {
        const plain = 'some-plain-text-without-colons-format';
        // No colons → treated as legacy plain text
        expect(cipher.decrypt(plain)).toBe(plain);
    });

    it('should produce different ciphertexts for the same input (random IV)', () => {
        const password = 'test-password-123';
        const enc1 = cipher.encrypt(password);
        const enc2 = cipher.encrypt(password);
        expect(enc1).not.toBe(enc2); // Different IVs
        expect(cipher.decrypt(enc1)).toBe(password);
        expect(cipher.decrypt(enc2)).toBe(password);
    });
});
