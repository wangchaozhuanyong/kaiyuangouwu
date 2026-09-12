import { normalizeBase32Secret } from './totp';
import { MAX_TWO_FACTOR_ACCOUNTS, TwoFactorAccount } from './types';

export const VAULT_PREFIX = 'storefront-two-factor-vault:v2:';
const LEGACY_PREFIX = 'storefront-two-factor-local:v1:';
const SESSION_PREFIX = 'storefront-two-factor-session:v1:';
export const MAX_VAULT_BYTES = 256 * 1024;
const ITERATIONS = 600_000;

interface Envelope {
    version: 2;
    ownerId: string;
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    iv: string;
    ciphertext: string;
}

export type VaultLock = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
const browserLock: VaultLock = async (name, operation) => {
    if (!globalThis.navigator?.locks) throw new Error('VAULT_UNAVAILABLE');
    return await navigator.locks.request(name, operation);
};

export function browserVaultStorage(): BrowserVaultStorage | null {
    try {
        if (!globalThis.crypto?.subtle || !globalThis.navigator?.locks) return null;
        return new BrowserVaultStorage(window.localStorage, window.sessionStorage);
    } catch {
        return null;
    }
}

function encode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}

function decode(value: string): Uint8Array<ArrayBuffer> {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('VAULT_INVALID');
    return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function parseEnvelope(serialized: string, ownerId: string): Envelope {
    if (serialized.length > MAX_VAULT_BYTES) throw new Error('VAULT_INVALID');
    const value = JSON.parse(serialized) as Envelope;
    if (
        !value ||
        value.version !== 2 ||
        value.ownerId !== ownerId ||
        value.kdf !== 'PBKDF2-SHA256' ||
        value.iterations !== ITERATIONS ||
        typeof value.salt !== 'string' ||
        typeof value.iv !== 'string' ||
        typeof value.ciphertext !== 'string' ||
        decode(value.salt).length !== 16 ||
        decode(value.iv).length !== 12 ||
        decode(value.ciphertext).length < 16
    )
        throw new Error('VAULT_INVALID');
    return value;
}

function validateAccounts(value: unknown): TwoFactorAccount[] {
    if (!Array.isArray(value) || value.length > MAX_TWO_FACTOR_ACCOUNTS) throw new Error('VAULT_INVALID');
    const ids = new Set<string>();
    const secrets = new Set<string>();
    for (const account of value as TwoFactorAccount[]) {
        if (
            !account ||
            typeof account.id !== 'string' ||
            !account.id ||
            account.id.length > 128 ||
            typeof account.projectName !== 'string' ||
            !account.projectName.trim() ||
            account.projectName.length > 80 ||
            typeof account.secret !== 'string' ||
            account.secret.length > 256 ||
            typeof account.createdAt !== 'string' ||
            account.createdAt.length > 40 ||
            (account.lastUsedAt !== null &&
                (typeof account.lastUsedAt !== 'string' || account.lastUsedAt.length > 40)) ||
            ids.has(account.id)
        )
            throw new Error('VAULT_INVALID');
        const secret = normalizeBase32Secret(account.secret);
        if (secrets.has(secret)) throw new Error('VAULT_INVALID');
        ids.add(account.id);
        secrets.add(secret);
    }
    return value as TwoFactorAccount[];
}

function aad(envelope: Envelope): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(
        JSON.stringify([VAULT_PREFIX, envelope.ownerId, envelope.kdf, envelope.iterations, envelope.salt]),
    );
}

async function deriveKey(passphrase: string, salt: string): Promise<CryptoKey> {
    if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('VAULT_PASSPHRASE');
    const bytes = new TextEncoder().encode(passphrase);
    try {
        const material = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
        return await crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: decode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
    } finally {
        bytes.fill(0);
    }
}

async function decrypt(envelope: Envelope, key: CryptoKey): Promise<TwoFactorAccount[]> {
    const bytes = new Uint8Array(
        await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decode(envelope.iv), additionalData: aad(envelope), tagLength: 128 },
            key,
            decode(envelope.ciphertext),
        ),
    );
    try {
        return validateAccounts(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    } finally {
        bytes.fill(0);
    }
}

async function encrypt(envelope: Envelope, key: CryptoKey, accounts: TwoFactorAccount[]): Promise<string> {
    const bytes = new TextEncoder().encode(JSON.stringify(validateAccounts(accounts)));
    if (bytes.length > MAX_VAULT_BYTES / 2) throw new Error('VAULT_INVALID');
    const next = { ...envelope, iv: encode(crypto.getRandomValues(new Uint8Array(12))) };
    try {
        next.ciphertext = encode(
            new Uint8Array(
                await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: decode(next.iv), additionalData: aad(next), tagLength: 128 },
                    key,
                    bytes,
                ),
            ),
        );
        return JSON.stringify(next);
    } finally {
        bytes.fill(0);
    }
}

/** Key material is retained only by an unlocked session. Close invalidates in-flight writes. */
export class VaultSession {
    private key: CryptoKey | null;
    constructor(
        private readonly store: BrowserVaultStorage,
        readonly ownerId: string,
        key: CryptoKey,
        private serialized: string,
    ) {
        this.key = key;
    }

    close(): void {
        this.key = null;
    }

    async save(accounts: TwoFactorAccount[]): Promise<void> {
        await this.store.exclusive(this.ownerId, async () => {
            const key = this.key;
            if (!key) throw new Error('VAULT_LOCKED');
            const previous = this.serialized;
            const next = await encrypt(parseEnvelope(previous, this.ownerId), key, accounts);
            if (this.key !== key) throw new Error('VAULT_LOCKED');
            this.store.commit(this.ownerId, previous, next);
            this.serialized = next;
        });
    }

    async migrateLegacy(accounts: TwoFactorAccount[]): Promise<TwoFactorAccount[]> {
        return this.store.exclusive(this.ownerId, async () => {
            const key = this.key;
            if (!key) throw new Error('VAULT_LOCKED');
            const result = await this.store.migrateLegacy(
                this.ownerId,
                this.serialized,
                key,
                accounts,
                () => this.key === key,
            );
            this.serialized = result.serialized;
            return result.accounts;
        });
    }

    backup(): string {
        if (!this.key || this.store.read(this.ownerId) !== this.serialized) throw new Error('VAULT_CHANGED');
        return this.serialized;
    }
}

/** Storage contains ciphertext only. Legacy entries are read only on explicit migration. */
export class BrowserVaultStorage {
    constructor(
        private readonly storage: Storage,
        private readonly legacySession: Storage | null = null,
        private readonly lock: VaultLock = browserLock,
    ) {}

    read(ownerId: string): string | null {
        return this.storage.getItem(VAULT_PREFIX + ownerId);
    }

    inspect(ownerId: string): { exists: boolean; legacy: boolean } {
        return {
            exists: this.read(ownerId) !== null,
            legacy:
                this.storage.getItem(LEGACY_PREFIX + ownerId) !== null ||
                this.legacySession?.getItem(SESSION_PREFIX + ownerId) != null,
        };
    }

    exclusive<T>(ownerId: string, operation: () => Promise<T>): Promise<T> {
        if (!ownerId) throw new Error('VAULT_INVALID');
        return this.lock(VAULT_PREFIX + ownerId, operation);
    }

    commit(ownerId: string, expected: string | null, next: string): void {
        if (this.read(ownerId) !== expected) throw new Error('VAULT_CHANGED');
        this.storage.setItem(VAULT_PREFIX + ownerId, next);
        if (this.read(ownerId) !== next) throw new Error('VAULT_WRITE_FAILED');
    }

    async unlock(ownerId: string, passphrase: string, active = () => true) {
        const serialized = this.read(ownerId);
        if (!serialized) throw new Error('VAULT_MISSING');
        const envelope = parseEnvelope(serialized, ownerId);
        const key = await deriveKey(passphrase, envelope.salt);
        const accounts = await decrypt(envelope, key);
        if (!active() || this.read(ownerId) !== serialized) throw new Error('VAULT_CHANGED');
        return { accounts, session: new VaultSession(this, ownerId, key, serialized) };
    }

    async migrateLegacy(
        ownerId: string,
        previous: string,
        key: CryptoKey,
        accounts: TwoFactorAccount[],
        active: () => boolean,
    ) {
        const sources = [
            { storage: this.storage, key: LEGACY_PREFIX + ownerId },
            { storage: this.legacySession, key: SESSION_PREFIX + ownerId },
        ].map(source => ({ ...source, value: source.storage?.getItem(source.key) ?? null }));
        const combined = [...accounts];
        for (const source of sources) {
            if (source.value === null) continue;
            if (source.value.length > MAX_VAULT_BYTES) throw new Error('VAULT_INVALID');
            for (const item of validateAccounts(JSON.parse(source.value))) {
                if (!combined.some(account => JSON.stringify(account) === JSON.stringify(item)))
                    combined.push(item);
            }
        }
        const serialized = await encrypt(parseEnvelope(previous, ownerId), key, combined);
        if (!active()) throw new Error('VAULT_LOCKED');
        this.commit(ownerId, previous, serialized);
        const persisted = this.read(ownerId);
        if (persisted === null) throw new Error('VAULT_WRITE_FAILED');
        const verified = await decrypt(parseEnvelope(persisted, ownerId), key);
        if (JSON.stringify(verified) !== JSON.stringify(combined)) throw new Error('VAULT_WRITE_FAILED');
        for (const source of sources) {
            if (active() && source.value !== null && source.storage?.getItem(source.key) === source.value) {
                try {
                    source.storage.removeItem(source.key);
                } catch {
                    /* Retry from the unlocked migration control. */
                }
            }
        }
        if (!active()) throw new Error('VAULT_LOCKED');
        return { accounts: verified, serialized };
    }

    async create(
        ownerId: string,
        passphrase: string,
        accounts: TwoFactorAccount[],
        active = () => true,
        backup?: string,
    ) {
        return this.exclusive(ownerId, async () => {
            if (this.read(ownerId) !== null) throw new Error('VAULT_EXISTS');
            const legacySources = [
                { storage: this.storage, key: LEGACY_PREFIX + ownerId },
                { storage: this.legacySession, key: SESSION_PREFIX + ownerId },
            ].map(source => ({ ...source, value: source.storage?.getItem(source.key) ?? null }));
            const restored = backup ? parseEnvelope(backup, ownerId) : null;
            const combined = [...accounts];
            if (restored) {
                for (const item of await decrypt(restored, await deriveKey(passphrase, restored.salt))) {
                    if (!combined.some(account => JSON.stringify(account) === JSON.stringify(item)))
                        combined.push(item);
                }
            }
            for (const source of legacySources) {
                if (source.value === null) continue;
                if (source.value.length > MAX_VAULT_BYTES) throw new Error('VAULT_INVALID');
                for (const account of validateAccounts(JSON.parse(source.value))) {
                    // Exact duplicates are safe; conflicting records abort without deleting anything.
                    if (!combined.some(item => JSON.stringify(item) === JSON.stringify(account)))
                        combined.push(account);
                }
            }
            validateAccounts(combined);
            const envelope: Envelope = {
                version: 2,
                ownerId,
                kdf: 'PBKDF2-SHA256',
                iterations: ITERATIONS,
                salt: encode(crypto.getRandomValues(new Uint8Array(16))),
                iv: '',
                ciphertext: '',
            };
            const key = await deriveKey(passphrase, envelope.salt);
            const serialized = await encrypt(envelope, key, combined);
            if (!active()) throw new Error('VAULT_LOCKED');
            this.commit(ownerId, null, serialized);
            const persisted = this.read(ownerId);
            if (persisted === null) throw new Error('VAULT_WRITE_FAILED');
            const verified = await decrypt(parseEnvelope(persisted, ownerId), key);
            if (JSON.stringify(verified) !== JSON.stringify(combined)) throw new Error('VAULT_WRITE_FAILED');
            // Remove old plaintext only after complete read-back and decryption. An old tab's
            // concurrent changes remain available for recovery instead of being discarded.
            for (const source of legacySources) {
                if (
                    active() &&
                    source.value !== null &&
                    source.storage?.getItem(source.key) === source.value
                ) {
                    try {
                        source.storage.removeItem(source.key);
                    } catch {
                        /* Retain plaintext for a visible retry. */
                    }
                }
            }
            if (!active()) throw new Error('VAULT_LOCKED');
            return { accounts: verified, session: new VaultSession(this, ownerId, key, serialized) };
        });
    }
}
