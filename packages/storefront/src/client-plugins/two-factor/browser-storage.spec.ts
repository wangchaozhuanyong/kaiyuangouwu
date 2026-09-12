import { describe, expect, it } from 'vitest';

import { BrowserVaultStorage, VAULT_PREFIX } from './browser-storage';
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

const passphrase = 'synthetic-test-unlock-passphrase';
const createStore = (storage: Storage, legacy: Storage | null = null) =>
    new BrowserVaultStorage(storage, legacy, async (_name, run) => run());

describe('storefront encrypted two-factor storage', () => {
    it('retries legacy cleanup after a browser removal failure without losing the verified vault', async () => {
        const storage = new MemoryStorage();
        const key = 'storefront-two-factor-local:v1:customer-1';
        storage.setItem(key, JSON.stringify([account]));
        const remove = storage.removeItem.bind(storage);
        storage.removeItem = () => {
            throw new Error('synthetic removal failure');
        };
        const store = createStore(storage);
        const first = await store.create('customer-1', passphrase, []);
        expect(first.accounts).toEqual([account]);
        expect(store.inspect('customer-1').legacy).toBe(true);
        storage.removeItem = remove;
        expect(await first.session.migrateLegacy(first.accounts)).toEqual([account]);
        expect(store.inspect('customer-1').legacy).toBe(false);
        expect((await store.unlock('customer-1', passphrase)).accounts).toEqual([account]);
    });

    it('persists ciphertext only and restores after closing the unlocked session', async () => {
        const storage = new MemoryStorage();
        const store = createStore(storage);
        const result = await store.create('customer-1', passphrase, [account]);
        const serialized = storage.getItem(VAULT_PREFIX + 'customer-1');
        expect(serialized).not.toBeNull();
        expect(serialized).not.toContain(account.secret);
        expect(serialized).not.toContain(account.projectName);
        expect(serialized).not.toContain(passphrase);
        result.session.close();
        await expect(result.session.save([])).rejects.toThrow('VAULT_LOCKED');
        expect((await store.unlock('customer-1', passphrase)).accounts).toEqual([account]);
        expect(store.inspect('customer-2').exists).toBe(false);
    });

    it('rejects wrong passwords, tampering and moving ciphertext to another customer', async () => {
        const storage = new MemoryStorage();
        const store = createStore(storage);
        const { session } = await store.create('customer-1', passphrase, [account]);
        const original = session.backup();
        await expect(store.unlock('customer-1', 'incorrect-test-passphrase')).rejects.toThrow();
        storage.setItem(VAULT_PREFIX + 'customer-2', original);
        await expect(store.unlock('customer-2', passphrase)).rejects.toThrow();
        const modified = JSON.parse(original);
        modified.ciphertext = (modified.ciphertext[0] === 'A' ? 'B' : 'A') + modified.ciphertext.slice(1);
        storage.setItem(VAULT_PREFIX + 'customer-1', JSON.stringify(modified));
        await expect(store.unlock('customer-1', passphrase)).rejects.toThrow();
    });

    it('uses fresh nonces on every save and rejects stale-tab overwrites', async () => {
        const storage = new MemoryStorage();
        const store = createStore(storage);
        const first = await store.create('customer-1', passphrase, [account]);
        const stale = await store.unlock('customer-1', passphrase);
        const originalIv = JSON.parse(first.session.backup()).iv;
        await first.session.save([{ ...account, projectName: 'Updated' }]);
        expect(JSON.parse(first.session.backup()).iv).not.toBe(originalIv);
        await expect(stale.session.save([])).rejects.toThrow('VAULT_CHANGED');
        expect((await store.unlock('customer-1', passphrase)).accounts[0].projectName).toBe('Updated');
    });

    it('does not touch legacy data on inspection; migrates both stores only after verification', async () => {
        const storage = new MemoryStorage();
        const legacy = new MemoryStorage();
        const localKey = 'storefront-two-factor-local:v1:customer-1';
        const sessionKey = 'storefront-two-factor-session:v1:customer-1';
        storage.setItem(localKey, JSON.stringify([account]));
        legacy.setItem(sessionKey, JSON.stringify([account]));
        storage.setItem('unrelated', 'keep');
        const store = createStore(storage, legacy);
        expect(store.inspect('customer-1')).toEqual({ exists: false, legacy: true });
        expect(storage.getItem(localKey)).toContain(account.secret);
        expect((await store.create('customer-1', passphrase, [])).accounts).toEqual([account]);
        expect(storage.getItem(localKey)).toBeNull();
        expect(legacy.getItem(sessionKey)).toBeNull();
        expect(storage.getItem('unrelated')).toBe('keep');
    });

    it('retains legacy data when persistence fails or stored records are invalid', async () => {
        const storage = new MemoryStorage();
        const store = createStore(storage);
        const key = 'storefront-two-factor-local:v1:customer-1';
        storage.setItem(key, '{malformed');
        await expect(store.create('customer-1', passphrase, [])).rejects.toThrow();
        expect(storage.getItem(key)).toBe('{malformed');
        storage.setItem(key, JSON.stringify([account]));
        const setItem = storage.setItem.bind(storage);
        storage.setItem = (name, value) => {
            if (name.startsWith(VAULT_PREFIX)) throw new Error('quota');
            setItem(name, value);
        };
        await expect(store.create('customer-1', passphrase, [])).rejects.toThrow();
        expect(storage.getItem(key)).toContain(account.secret);
        expect(store.read('customer-1')).toBeNull();
    });

    it('does not publish a cancelled unlock or create', async () => {
        const storage = new MemoryStorage();
        const store = createStore(storage);
        await expect(store.create('customer-1', passphrase, [account], () => false)).rejects.toThrow();
        expect(store.read('customer-1')).toBeNull();
        await store.create('customer-1', passphrase, [account]);
        await expect(store.unlock('customer-1', passphrase, () => false)).rejects.toThrow();
    });

    it('restores an encrypted backup without overwriting an existing vault', async () => {
        const first = createStore(new MemoryStorage());
        const backup = (await first.create('customer-1', passphrase, [account])).session.backup();
        const second = createStore(new MemoryStorage());
        expect((await second.create('customer-1', passphrase, [], () => true, backup)).accounts).toEqual([
            account,
        ]);
        await expect(second.create('customer-1', passphrase, [], () => true, backup)).rejects.toThrow(
            'VAULT_EXISTS',
        );
    });

    it('rejects excessive KDF work and invalid oversized backups before derivation', async () => {
        const store = createStore(new MemoryStorage());
        await expect(
            store.create('customer-1', passphrase, [], () => true, 'x'.repeat(300_000)),
        ).rejects.toThrow('VAULT_INVALID');
        const backup = (await store.create('customer-1', passphrase, [])).session.backup();
        const modified = { ...JSON.parse(backup), iterations: 2_000_000_000 };
        const target = createStore(new MemoryStorage());
        await expect(
            target.create('customer-1', passphrase, [], () => true, JSON.stringify(modified)),
        ).rejects.toThrow('VAULT_INVALID');
    });
});
