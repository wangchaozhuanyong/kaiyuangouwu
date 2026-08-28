import { normalizeBase32Secret } from './totp';
import { MAX_TWO_FACTOR_ACCOUNTS, TwoFactorAccount } from './types';

const STORAGE_PREFIX = 'vendure-two-factor-session:v1:';

export interface StoredAccountsResult {
    accounts: TwoFactorAccount[];
    available: boolean;
}

function storageKey(ownerId: string): string {
    return `${STORAGE_PREFIX}${ownerId}`;
}

function resolveSessionStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        const storage = window.sessionStorage;
        const probeKey = `${STORAGE_PREFIX}probe`;
        storage.setItem(probeKey, '1');
        storage.removeItem(probeKey);
        return storage;
    } catch {
        return null;
    }
}

function isStoredAccount(value: unknown): value is TwoFactorAccount {
    if (!value || typeof value !== 'object') return false;
    const account = value as Partial<TwoFactorAccount>;
    if (
        typeof account.id !== 'string' ||
        typeof account.projectName !== 'string' ||
        typeof account.secret !== 'string' ||
        typeof account.createdAt !== 'string' ||
        (account.lastUsedAt !== null && typeof account.lastUsedAt !== 'string')
    ) {
        return false;
    }
    try {
        normalizeBase32Secret(account.secret);
        return account.projectName.trim().length > 0 && account.projectName.length <= 80;
    } catch {
        return false;
    }
}

export function loadSessionAccounts(
    ownerId: string,
    storage = resolveSessionStorage(),
): StoredAccountsResult {
    if (!ownerId || !storage) return { accounts: [], available: false };
    const key = storageKey(ownerId);
    try {
        const serialized = storage.getItem(key);
        if (!serialized) return { accounts: [], available: true };
        const parsed = JSON.parse(serialized) as unknown;
        if (!Array.isArray(parsed)) {
            storage.removeItem(key);
            return { accounts: [], available: true };
        }
        return {
            accounts: parsed.filter(isStoredAccount).slice(0, MAX_TWO_FACTOR_ACCOUNTS),
            available: true,
        };
    } catch {
        try {
            storage.removeItem(key);
        } catch {
            // Storage is already unavailable; return a safe empty state.
        }
        return { accounts: [], available: true };
    }
}

export function saveSessionAccounts(
    ownerId: string,
    accounts: TwoFactorAccount[],
    storage = resolveSessionStorage(),
): boolean {
    if (!ownerId || !storage || accounts.length > MAX_TWO_FACTOR_ACCOUNTS) return false;
    try {
        storage.setItem(storageKey(ownerId), JSON.stringify(accounts));
        return true;
    } catch {
        return false;
    }
}

export function clearSessionAccounts(ownerId: string, storage = resolveSessionStorage()): void {
    if (!ownerId || !storage) return;
    try {
        storage.removeItem(storageKey(ownerId));
    } catch {
        // Logging out must not fail when browser storage is unavailable.
    }
}

export function clearAllTwoFactorSessions(storage = resolveSessionStorage()): void {
    if (!storage) return;
    try {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
        }
        for (const key of keys) storage.removeItem(key);
    } catch {
        // Authentication cleanup should remain best-effort in restricted browsers.
    }
}
