import { normalizeBase32Secret } from './totp';

const LEGACY_STORAGE_PREFIX = 'vendure-two-factor-session:v1:';

export interface LegacyTwoFactorAccount {
    projectName: string;
    secret: string;
}

export interface LegacyTwoFactorAccountsResult {
    accounts: LegacyTwoFactorAccount[];
    found: boolean;
    valid: boolean;
}

/** Reads obsolete dashboard Session Storage records for a one-time server migration. */
export function loadLegacyTwoFactorSessionAccounts(
    ownerId: string,
    storage = resolveSessionStorage(),
): LegacyTwoFactorAccountsResult {
    if (!ownerId || !storage) return { accounts: [], found: false, valid: true };
    try {
        const serialized = storage.getItem(storageKey(ownerId));
        if (!serialized) return { accounts: [], found: false, valid: true };
        const parsed = JSON.parse(serialized) as unknown;
        if (!Array.isArray(parsed) || !parsed.every(isLegacyAccount)) {
            return { accounts: [], found: true, valid: false };
        }
        return {
            accounts: parsed.map(account => ({
                projectName: account.projectName.trim(),
                secret: normalizeBase32Secret(account.secret),
            })),
            found: true,
            valid: true,
        };
    } catch {
        return { accounts: [], found: true, valid: false };
    }
}

/** Removes one administrator's obsolete record only after it was migrated successfully. */
export function clearLegacyTwoFactorSessionStorage(ownerId: string, storage = resolveSessionStorage()): void {
    if (!ownerId || !storage) return;
    try {
        storage.removeItem(storageKey(ownerId));
    } catch {
        // Legacy cleanup is best-effort in browsers that restrict Session Storage.
    }
}

function storageKey(ownerId: string): string {
    return `${LEGACY_STORAGE_PREFIX}${ownerId}`;
}

function isLegacyAccount(value: unknown): value is LegacyTwoFactorAccount {
    if (!value || typeof value !== 'object') return false;
    const account = value as Partial<LegacyTwoFactorAccount>;
    if (
        typeof account.projectName !== 'string' ||
        !account.projectName.trim() ||
        account.projectName.trim().length > 80 ||
        typeof account.secret !== 'string'
    ) {
        return false;
    }
    try {
        normalizeBase32Secret(account.secret);
        return true;
    } catch {
        return false;
    }
}

function resolveSessionStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}
