import { describe, expect, it } from 'vitest';

import {
    clearLegacyTwoFactorSessionStorage,
    decodeBase32,
    formatTotpCode,
    generateTotp,
    getTotpSecondsRemaining,
    loadLegacyTwoFactorSessionAccounts,
    normalizeBase32Secret,
    parseBatchImport,
} from './two-factor-utils';

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length() {
        return this.values.size;
    }

    clear() {
        this.values.clear();
    }

    getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    key(index: number) {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string) {
        this.values.delete(key);
    }

    setItem(key: string, value: string) {
        this.values.set(key, value);
    }
}

describe('next-admin 2FA utilities', () => {
    it('normalizes and decodes common Base32 formatting', () => {
        expect(normalizeBase32Secret(' jbsw-y3dp ehpk3pxp= ')).toBe('JBSWY3DPEHPK3PXP');
        expect(new TextDecoder().decode(decodeBase32('JBSWY3DPEBLW64TMMQ======'))).toBe('Hello World');
    });

    it('rejects malformed secrets', () => {
        expect(() => normalizeBase32Secret('short')).toThrow();
        expect(() => normalizeBase32Secret('JBSWY3DP!HPK3PXP')).toThrow();
    });

    it('matches RFC 6238 SHA-1 vectors', async () => {
        const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
        await expect(generateTotp(secret, 59_000, 8)).resolves.toBe('94287082');
        await expect(generateTotp(secret, 1_111_111_109_000, 8)).resolves.toBe('07081804');
        await expect(generateTotp(secret, 2_000_000_000_000, 8)).resolves.toBe('69279037');
    });

    it('formats codes and calculates the shared countdown', () => {
        expect(formatTotpCode('123456')).toBe('123 456');
        expect(getTotpSecondsRemaining(0)).toBe(30);
        expect(getTotpSecondsRemaining(29_000)).toBe(1);
        expect(getTotpSecondsRemaining(30_000)).toBe(30);
    });

    it('parses named and key-only imports while rejecting duplicates', () => {
        const result = parseBatchImport(
            ['客服账号 | JBSWY3DPEHPK3PXP', 'GEZDGNBVGY3TQOJQ', '重复账号 | JBSWY3DPEHPK3PXP'].join('\n'),
        );
        expect(result.accounts).toEqual([
            { lineNumber: 1, projectName: '客服账号', secret: 'JBSWY3DPEHPK3PXP' },
            { lineNumber: 2, projectName: '未命名-001', secret: 'GEZDGNBVGY3TQOJQ' },
        ]);
        expect(result.errors).toEqual([{ lineNumber: 3, code: 'DUPLICATE_SECRET' }]);
    });

    it('loads and removes only the current administrator legacy record', () => {
        const storage = new MemoryStorage();
        storage.setItem(
            'vendure-two-factor-session:v1:admin-1',
            JSON.stringify([{ projectName: ' Support ', secret: 'jbsw y3dp ehpk3pxp' }]),
        );
        storage.setItem('vendure-two-factor-session:v1:admin-2', 'keep');

        expect(loadLegacyTwoFactorSessionAccounts('admin-1', storage)).toEqual({
            accounts: [{ projectName: 'Support', secret: 'JBSWY3DPEHPK3PXP' }],
            found: true,
            valid: true,
        });
        clearLegacyTwoFactorSessionStorage('admin-1', storage);
        expect(storage.getItem('vendure-two-factor-session:v1:admin-1')).toBeNull();
        expect(storage.getItem('vendure-two-factor-session:v1:admin-2')).toBe('keep');
    });

    it('preserves malformed legacy data for manual recovery', () => {
        const storage = new MemoryStorage();
        storage.setItem('vendure-two-factor-session:v1:admin-1', 'malformed-secret-data');
        expect(loadLegacyTwoFactorSessionAccounts('admin-1', storage)).toEqual({
            accounts: [],
            found: true,
            valid: false,
        });
        expect(storage.getItem('vendure-two-factor-session:v1:admin-1')).toBe('malformed-secret-data');
    });
});
