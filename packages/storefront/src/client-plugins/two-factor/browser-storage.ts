import { normalizeBase32Secret } from './totp';
import { MAX_TWO_FACTOR_ACCOUNTS, TwoFactorAccount } from './types';

const STORAGE_PREFIX = 'storefront-two-factor-local:v1:';
const LEGACY_SESSION_STORAGE_PREFIX = 'storefront-two-factor-session:v1:';

export interface StoredAccountsResult {
    accounts: TwoFactorAccount[];
    available: boolean;
}

function storageKey(ownerId: string): string {
    return `${STORAGE_PREFIX}${ownerId}`;
}

function legacyStorageKey(ownerId: string): string {
    return `${LEGACY_SESSION_STORAGE_PREFIX}${ownerId}`;
}

function resolveLocalStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        const storage = window.localStorage;
        const probeKey = `${STORAGE_PREFIX}probe`;
        storage.setItem(probeKey, '1');
        storage.removeItem(probeKey);
        return storage;
    } catch {
        return null;
    }
}

function resolveLegacySessionStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
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

function readAccounts(storage: Storage, key: string): TwoFactorAccount[] | null {
    const serialized = storage.getItem(key);
    if (!serialized) return null;
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredAccount).slice(0, MAX_TWO_FACTOR_ACCOUNTS);
}

export function loadBrowserAccounts(
    ownerId: string,
    storage = resolveLocalStorage(),
    legacyStorage = resolveLegacySessionStorage(),
): StoredAccountsResult {
    if (!ownerId || !storage) return { accounts: [], available: false };
    const key = storageKey(ownerId);
    try {
        const accounts = readAccounts(storage, key);
        if (accounts !== null) return { accounts, available: true };

        if (!legacyStorage) return { accounts: [], available: true };
        const legacyKey = legacyStorageKey(ownerId);
        const legacyAccounts = readAccounts(legacyStorage, legacyKey);
        if (legacyAccounts === null) return { accounts: [], available: true };

        storage.setItem(key, JSON.stringify(legacyAccounts));
        legacyStorage.removeItem(legacyKey);
        return { accounts: legacyAccounts, available: true };
    } catch {
        try {
            storage.removeItem(key);
        } catch {
            // Restricted storage should fall back to an empty in-memory state.
        }
        return { accounts: [], available: true };
    }
}

export function saveBrowserAccounts(
    ownerId: string,
    accounts: TwoFactorAccount[],
    storage = resolveLocalStorage(),
): boolean {
    if (!ownerId || !storage || accounts.length > MAX_TWO_FACTOR_ACCOUNTS) return false;
    try {
        storage.setItem(storageKey(ownerId), JSON.stringify(accounts));
        return true;
    } catch {
        return false;
    }
}

export function clearBrowserAccounts(ownerId: string, storage = resolveLocalStorage()): void {
    if (!ownerId || !storage) return;
    try {
        storage.removeItem(storageKey(ownerId));
    } catch {
        // Clearing local 2FA data remains best-effort when storage is restricted.
    }
}
