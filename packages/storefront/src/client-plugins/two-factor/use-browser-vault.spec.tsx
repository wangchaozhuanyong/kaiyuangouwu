// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VAULT_PREFIX } from './browser-storage';
import { useBrowserVault, VAULT_IDLE_MS } from './use-browser-vault';

const storage = vi.hoisted(() => ({
    exists: false,
    close: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn(),
    create: vi.fn(),
}));
vi.mock('./browser-storage', async () => {
    const actual = await vi.importActual<typeof import('./browser-storage')>('./browser-storage');
    return {
        ...actual,
        browserVaultStorage: () => ({
            inspect: () => ({ exists: storage.exists, legacy: false }),
            unlock: storage.unlock,
            create: storage.create,
        }),
    };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const account = {
    id: 'a',
    projectName: 'Synthetic account',
    secret: 'JBSWY3DPEHPK3PXP',
    createdAt: new Date(0).toISOString(),
    lastUsedAt: null,
};
let vault: ReturnType<typeof useBrowserVault>;
const clearSensitive = vi.fn();
function Harness() {
    vault = useBrowserVault('owner-a', clearSensitive);
    return <span>{vault.accounts.length}</span>;
}

describe('vault lifecycle', () => {
    let root: ReturnType<typeof createRoot>;
    beforeEach(() => {
        vi.useFakeTimers();
        storage.exists = false;
        vi.clearAllMocks();
        storage.create.mockImplementation(() => {
            storage.exists = true;
            return Promise.resolve({
                accounts: [account],
                session: { close: storage.close, save: storage.save },
            });
        });
        storage.unlock.mockResolvedValue({
            accounts: [account],
            session: { close: storage.close, save: storage.save },
        });
        root = createRoot(document.createElement('div'));
        act(() => root.render(<Harness />));
    });
    afterEach(() => {
        act(() => root.unmount());
        vi.useRealTimers();
    });

    it('keeps temporary entries in memory and clears all fields when idle', async () => {
        await act(async () => {
            await vault.save([account]);
        });
        expect(vault.accounts).toHaveLength(1);
        expect(storage.save).not.toHaveBeenCalled();
        await act(() => vi.advanceTimersByTime(VAULT_IDLE_MS));
        expect(vault.accounts).toEqual([]);
        expect(clearSensitive).toHaveBeenCalled();
    });

    it('locks encrypted entries on pagehide and on updates from another tab', async () => {
        await act(async () => {
            await vault.open('synthetic-passphrase');
        });
        expect(vault.unlocked).toBe(true);
        await act(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
        expect(vault.unlocked).toBe(false);
        expect(vault.accounts).toEqual([]);
        expect(storage.close).toHaveBeenCalled();
        await act(async () => {
            await vault.open('synthetic-passphrase');
        });
        await act(() => window.dispatchEvent(new StorageEvent('storage', { key: VAULT_PREFIX + 'owner-a' })));
        expect(vault.unlocked).toBe(false);
        expect(vault.canWrite).toBe(false);
    });

    it('checks elapsed time on resume even if browser timers were suspended', async () => {
        await act(async () => {
            await vault.save([account]);
        });
        vi.setSystemTime(Date.now() + VAULT_IDLE_MS + 1);
        await act(() => document.dispatchEvent(new Event('visibilitychange')));
        expect(vault.accounts).toEqual([]);
    });

    it('invalidates an unlock that finishes after the page was locked', async () => {
        let finish!: (value: any) => void;
        storage.create.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        let opening!: Promise<boolean>;
        act(() => {
            opening = vault.open('synthetic-passphrase');
        });
        act(() => vault.lock());
        await act(async () => {
            finish({ accounts: [account], session: { close: storage.close, save: storage.save } });
            await opening;
        });
        expect(vault.accounts).toEqual([]);
        expect(vault.unlocked).toBe(false);
        expect(storage.close).toHaveBeenCalled();
    });
});
