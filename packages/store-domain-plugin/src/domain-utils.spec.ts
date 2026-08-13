import { describe, expect, it } from 'vitest';

import { normalizeDomain, normalizeRequestHost, verificationRecordValue } from './domain-utils';

describe('normalizeDomain', () => {
    it.each([
        ['Shop.Example.com', 'shop.example.com'],
        ['https://shop.example.com/', 'shop.example.com'],
        ['https://\u4f8b\u5b50.\u6d4b\u8bd5/', 'xn--fsqu00a.xn--0zwm56d'],
        ['shop.example.com.', 'shop.example.com'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizeDomain(input)).toBe(expected);
    });

    it.each(['', 'localhost', '127.0.0.1', '*.example.com', 'example', 'https://example.com/path'])(
        'rejects %s',
        input => {
            expect(() => normalizeDomain(input)).toThrow();
        },
    );
});

describe('normalizeRequestHost', () => {
    it('removes a port and selects the first forwarded host', () => {
        expect(normalizeRequestHost('SHOP.EXAMPLE.COM:443, proxy.internal')).toBe('shop.example.com');
    });

    it('returns undefined for malformed hosts', () => {
        expect(normalizeRequestHost('not a host')).toBeUndefined();
    });
});

it('builds the exact TXT verification value', () => {
    expect(verificationRecordValue('abc123')).toBe('vendure-domain-verification=abc123');
});
