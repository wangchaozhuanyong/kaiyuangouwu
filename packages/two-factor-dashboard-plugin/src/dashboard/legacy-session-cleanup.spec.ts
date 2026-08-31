import { describe, expect, it } from 'vitest';

import {
    clearLegacyTwoFactorSessionStorage,
    loadLegacyTwoFactorSessionAccounts,
} from './legacy-session-cleanup';

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

describe('legacy dashboard 2FA session cleanup', () => {
    it('loads the current administrator record for one-time migration', () => {
        const storage = new MemoryStorage();
        storage.setItem(
            'vendure-two-factor-session:v1:admin-1',
            JSON.stringify([
                {
                    id: 'legacy-id',
                    projectName: ' Support ',
                    secret: 'jbsw y3dp ehpk3pxp',
                    createdAt: '2026-08-01T00:00:00.000Z',
                    lastUsedAt: null,
                },
            ]),
        );
        storage.setItem('vendure-two-factor-session:v1:admin-2', 'other-admin-data');

        expect(loadLegacyTwoFactorSessionAccounts('admin-1', storage)).toEqual({
            accounts: [{ projectName: 'Support', secret: 'JBSWY3DPEHPK3PXP' }],
            found: true,
            valid: true,
        });
        expect(storage.getItem('vendure-two-factor-session:v1:admin-2')).toBe('other-admin-data');
    });

    it('keeps malformed legacy data instead of deleting it silently', () => {
        const storage = new MemoryStorage();
        storage.setItem('vendure-two-factor-session:v1:admin-1', 'secret-data');

        expect(loadLegacyTwoFactorSessionAccounts('admin-1', storage)).toEqual({
            accounts: [],
            found: true,
            valid: false,
        });
        expect(storage.getItem('vendure-two-factor-session:v1:admin-1')).toBe('secret-data');
    });

    it('removes only the migrated administrator record', () => {
        const storage = new MemoryStorage();
        storage.setItem('vendure-two-factor-session:v1:admin-1', 'migrated-data');
        storage.setItem('vendure-two-factor-session:v1:admin-2', 'other-admin-data');
        storage.setItem('unrelated', 'keep');

        clearLegacyTwoFactorSessionStorage('admin-1', storage);

        expect(storage.getItem('vendure-two-factor-session:v1:admin-1')).toBeNull();
        expect(storage.getItem('vendure-two-factor-session:v1:admin-2')).toBe('other-admin-data');
        expect(storage.getItem('unrelated')).toBe('keep');
    });
});
