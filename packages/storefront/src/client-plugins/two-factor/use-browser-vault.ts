import { useCallback, useEffect, useRef, useState } from 'react';

import { browserVaultStorage, VAULT_PREFIX, VaultSession } from './browser-storage';
import { TwoFactorAccount } from './types';

export const VAULT_IDLE_MS = 5 * 60_000;

export function useBrowserVault(ownerId: string, onLock: () => void) {
    const store = useRef<ReturnType<typeof browserVaultStorage>>(null);
    const session = useRef<VaultSession | null>(null);
    const revision = useRef(0);
    const pending = useRef(false);
    const onLockRef = useRef(onLock);
    onLockRef.current = onLock;
    const [accounts, setAccounts] = useState<TwoFactorAccount[]>([]);
    const [available, setAvailable] = useState(false);
    const [exists, setExists] = useState(false);
    const [legacy, setLegacy] = useState(false);
    const [unlocked, setUnlocked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);

    const inspect = useCallback(() => {
        try {
            const status = store.current?.inspect(ownerId);
            setAvailable(!!status);
            setExists(status?.exists ?? false);
            setLegacy(status?.legacy ?? false);
        } catch {
            setAvailable(false);
        }
    }, [ownerId]);

    const lock = useCallback(() => {
        revision.current++;
        session.current?.close();
        session.current = null;
        pending.current = false;
        setBusy(false);
        setUnlocked(false);
        setAccounts([]);
        setError(false);
        onLockRef.current();
        inspect();
    }, [inspect]);

    useEffect(() => {
        store.current = browserVaultStorage();
        inspect();
        let lastActivity = Date.now();
        const check = () => {
            if (Date.now() - lastActivity >= VAULT_IDLE_MS) {
                lock();
                lastActivity = Date.now();
            }
        };
        const activity = () => {
            // Check BEFORE updating the deadline, including after a suspended tab wakes.
            check();
            lastActivity = Date.now();
        };
        const onStorage = (event: StorageEvent) => {
            if (
                event.key === null ||
                event.key === VAULT_PREFIX + ownerId ||
                event.key.endsWith('v1:' + ownerId)
            )
                lock();
        };
        const timer = window.setInterval(check, 1000);
        window.addEventListener('pointerdown', activity, true);
        window.addEventListener('keydown', activity, true);
        window.addEventListener('pagehide', lock);
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', check);
        return () => {
            revision.current++;
            session.current?.close();
            session.current = null;
            window.clearInterval(timer);
            window.removeEventListener('pointerdown', activity, true);
            window.removeEventListener('keydown', activity, true);
            window.removeEventListener('pagehide', lock);
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', check);
        };
    }, [inspect, lock, ownerId]);

    const open = async (passphrase: string, backup?: string) => {
        if (!store.current || pending.current) return false;
        pending.current = true;
        setBusy(true);
        setError(false);
        const epoch = revision.current;
        const active = () => revision.current === epoch;
        try {
            const result = exists
                ? await store.current.unlock(ownerId, passphrase, active)
                : await store.current.create(ownerId, passphrase, accounts, active, backup);
            if (!active()) {
                result.session.close();
                return false;
            }
            session.current = result.session;
            setAccounts(result.accounts);
            setUnlocked(true);
            inspect();
            return true;
        } catch {
            if (active()) {
                setError(true);
                inspect();
            }
            return false;
        } finally {
            if (active()) {
                pending.current = false;
                setBusy(false);
            }
        }
    };

    const save = async (next: TwoFactorAccount[]) => {
        if (pending.current || (exists && !session.current)) return false;
        pending.current = true;
        setBusy(true);
        const epoch = revision.current;
        try {
            if (session.current) await session.current.save(next);
            if (revision.current !== epoch) return false;
            setAccounts(next);
            return true;
        } catch {
            if (revision.current === epoch) setError(true);
            return false;
        } finally {
            if (revision.current === epoch) {
                pending.current = false;
                setBusy(false);
            }
        }
    };

    const migrateLegacy = async () => {
        const current = session.current;
        if (!current || pending.current) return;
        const epoch = revision.current;
        pending.current = true;
        setBusy(true);
        setError(false);
        try {
            const next = await current.migrateLegacy(accounts);
            if (revision.current === epoch) {
                setAccounts(next);
                inspect();
            }
        } catch {
            if (revision.current === epoch) setError(true);
        } finally {
            if (revision.current === epoch) {
                pending.current = false;
                setBusy(false);
            }
        }
    };

    return {
        accounts,
        available,
        exists,
        legacy,
        unlocked,
        busy,
        error,
        lock,
        open,
        save,
        canWrite: !busy && (!exists || unlocked),
        migrateLegacy,
        backup: () => session.current?.backup() ?? null,
    };
}
