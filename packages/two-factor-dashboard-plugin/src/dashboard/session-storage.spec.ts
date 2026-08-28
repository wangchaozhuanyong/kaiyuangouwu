import { describe, expect, it } from 'vitest';

import {
    clearAllTwoFactorSessions,
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
    projectName: 'ChatGPT-客服01',
    secret: 'JBSWY3DPEHPK3PXP',
    createdAt: '2026-08-28T00:00:00.000Z',
    lastUsedAt: null,
};

describe('two-factor session storage', () => {
    it('isolates saved accounts by administrator', () => {
        const storage = new MemoryStorage();
        expect(saveSessionAccounts('admin-1', [account], storage)).toBe(true);
        expect(loadSessionAccounts('admin-1', storage).accounts).toEqual([account]);
        expect(loadSessionAccounts('admin-2', storage).accounts).toEqual([]);
    });

    it('fails closed when stored data is malformed', () => {
        const storage = new MemoryStorage();
        storage.setItem('vendure-two-factor-session:v1:admin-1', '{bad json');
        expect(loadSessionAccounts('admin-1', storage)).toEqual({ accounts: [], available: true });
    });

    it('clears one user or every plugin-owned session without touching other keys', () => {
        const storage = new MemoryStorage();
        saveSessionAccounts('admin-1', [account], storage);
        saveSessionAccounts('admin-2', [account], storage);
        storage.setItem('unrelated', 'keep');

        clearSessionAccounts('admin-1', storage);
        expect(loadSessionAccounts('admin-1', storage).accounts).toEqual([]);
        expect(loadSessionAccounts('admin-2', storage).accounts).toHaveLength(1);

        clearAllTwoFactorSessions(storage);
        expect(loadSessionAccounts('admin-2', storage).accounts).toEqual([]);
        expect(storage.getItem('unrelated')).toBe('keep');
    });
});
