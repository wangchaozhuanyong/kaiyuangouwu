import { describe, expect, it } from 'vitest';

import {
    decodeBase32,
    formatTotpCode,
    generateTotp,
    getTotpSecondsRemaining,
    normalizeBase32Secret,
} from './totp';

describe('storefront TOTP utilities', () => {
    it('normalizes and validates Base32 secrets', () => {
        expect(normalizeBase32Secret(' jbsw-y3dp ehpk3pxp= ')).toBe('JBSWY3DPEHPK3PXP');
        expect(() => normalizeBase32Secret('short')).toThrow();
        expect(() => normalizeBase32Secret('JBSWY3DP!HPK3PXP')).toThrow();
    });

    it('decodes Base32 input', () => {
        expect(new TextDecoder().decode(decodeBase32('JBSWY3DPEBLW64TMMQ======'))).toBe('Hello World');
    });

    it('matches RFC 6238 SHA-1 vectors in the browser implementation', async () => {
        const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
        await expect(generateTotp(secret, 59_000, 8)).resolves.toBe('94287082');
        await expect(generateTotp(secret, 1_111_111_109_000, 8)).resolves.toBe('07081804');
        await expect(generateTotp(secret, 2_000_000_000_000, 8)).resolves.toBe('69279037');
    });

    it('formats six-digit codes and calculates the countdown', () => {
        expect(formatTotpCode('123456')).toBe('123 456');
        expect(getTotpSecondsRemaining(0)).toBe(30);
        expect(getTotpSecondsRemaining(29_000)).toBe(1);
        expect(getTotpSecondsRemaining(30_000)).toBe(30);
    });
});
