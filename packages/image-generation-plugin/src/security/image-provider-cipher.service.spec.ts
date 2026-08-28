import { afterEach, describe, expect, it } from 'vitest';

import { ImageProviderCipherService } from './image-provider-cipher.service';

const originalMasterKey = process.env.IMAGE_GENERATION_MASTER_KEY;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
    process.env.IMAGE_GENERATION_MASTER_KEY = originalMasterKey;
    process.env.NODE_ENV = originalNodeEnv;
});

describe('ImageProviderCipherService', () => {
    it('encrypts the relay key with authenticated encryption', () => {
        process.env.NODE_ENV = 'test';
        process.env.IMAGE_GENERATION_MASTER_KEY = 'a-secure-master-key-with-more-than-32-characters';
        const service = new ImageProviderCipherService();

        const encrypted = service.encrypt('relay-secret-key');

        expect(encrypted).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]+$/u);
        expect(encrypted).not.toContain('relay-secret-key');
        expect(service.decrypt(encrypted)).toBe('relay-secret-key');
    });

    it('rejects tampered ciphertext', () => {
        process.env.NODE_ENV = 'test';
        process.env.IMAGE_GENERATION_MASTER_KEY = 'another-secure-master-key-with-32-characters';
        const service = new ImageProviderCipherService();
        const encrypted = service.encrypt('relay-secret-key');
        const [version, iv, tag, ciphertext] = encrypted.split('.');
        const tamperedCiphertext = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;
        const tampered = [version, iv, tag, tamperedCiphertext].join('.');

        expect(() => service.decrypt(tampered)).toThrow('无法解密');
    });

    it('requires a non-placeholder production key', () => {
        process.env.NODE_ENV = 'production';
        process.env.IMAGE_GENERATION_MASTER_KEY = 'change-me-development-secret-that-is-long-enough';

        expect(() => new ImageProviderCipherService()).toThrow('IMAGE_GENERATION_MASTER_KEY');
    });
});
