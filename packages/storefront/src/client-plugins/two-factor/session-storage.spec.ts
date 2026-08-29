import { describe, expect, it } from 'vitest';

import {
    clearAllStorefrontTwoFactorSessions,
    clearSessionAccounts,
    loadSessionAccounts,
    saveSessionAccounts,
} from './session-storage';
import { TwoFactorAccount } from './types';

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

const account: TwoFactorAccount = {
    id: 'account-1',
    projectName: '客服账号 01',
    secret: 'JBSWY3DPEHPK3PXP',
    createdAt: '2026-08-28T00:00:00.000Z',
    lastUsedAt: null,
};

describe('storefront two-factor session storage', () => {
    it('isolates saved accounts by customer', () => {
        const storage = new MemoryStorage();
        expect(saveSessionAccounts('customer-1', [account], storage)).toBe(true);
        expect(loadSessionAccounts('customer-1', storage).accounts).toEqual([account]);
        expect(loadSessionAccounts('customer-2', storage).accounts).toEqual([]);
    });

    it('fails closed when stored data is malformed', () => {
        const storage = new MemoryStorage();
        storage.setItem('storefront-two-factor-session:v1:customer-1', '{bad json');
        expect(loadSessionAccounts('customer-1', storage)).toEqual({ accounts: [], available: true });
    });

    it('clears plugin-owned sessions without touching unrelated browser data', () => {
        const storage = new MemoryStorage();
        saveSessionAccounts('customer-1', [account], storage);
        saveSessionAccounts('customer-2', [account], storage);
        storage.setItem('unrelated', 'keep');

        clearSessionAccounts('customer-1', storage);
        expect(loadSessionAccounts('customer-1', storage).accounts).toEqual([]);
        expect(loadSessionAccounts('customer-2', storage).accounts).toHaveLength(1);

        clearAllStorefrontTwoFactorSessions(storage);
        expect(loadSessionAccounts('customer-2', storage).accounts).toEqual([]);
        expect(storage.getItem('unrelated')).toBe('keep');
    });
});
