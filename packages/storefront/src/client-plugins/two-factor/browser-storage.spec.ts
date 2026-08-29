import { describe, expect, it } from 'vitest';

import { clearBrowserAccounts, loadBrowserAccounts, saveBrowserAccounts } from './browser-storage';
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

describe('storefront two-factor browser storage', () => {
    it('isolates saved accounts by customer', () => {
        const storage = new MemoryStorage();
        expect(saveBrowserAccounts('customer-1', [account], storage)).toBe(true);
        expect(loadBrowserAccounts('customer-1', storage, null).accounts).toEqual([account]);
        expect(loadBrowserAccounts('customer-2', storage, null).accounts).toEqual([]);
    });

    it('fails closed when stored data is malformed', () => {
        const storage = new MemoryStorage();
        storage.setItem('storefront-two-factor-local:v1:customer-1', '{bad json');
        expect(loadBrowserAccounts('customer-1', storage, null)).toEqual({
            accounts: [],
            available: true,
        });
    });

    it('only clears the selected customer accounts', () => {
        const storage = new MemoryStorage();
        saveBrowserAccounts('customer-1', [account], storage);
        saveBrowserAccounts('customer-2', [account], storage);
        storage.setItem('unrelated', 'keep');

        clearBrowserAccounts('customer-1', storage);
        expect(loadBrowserAccounts('customer-1', storage, null).accounts).toEqual([]);
        expect(loadBrowserAccounts('customer-2', storage, null).accounts).toHaveLength(1);
        expect(storage.getItem('unrelated')).toBe('keep');
    });

    it('migrates existing session accounts into persistent browser storage', () => {
        const storage = new MemoryStorage();
        const legacyStorage = new MemoryStorage();
        legacyStorage.setItem('storefront-two-factor-session:v1:customer-1', JSON.stringify([account]));

        expect(loadBrowserAccounts('customer-1', storage, legacyStorage)).toEqual({
            accounts: [account],
            available: true,
        });
        expect(loadBrowserAccounts('customer-1', storage, null).accounts).toEqual([account]);
        expect(legacyStorage.getItem('storefront-two-factor-session:v1:customer-1')).toBeNull();
    });
});
