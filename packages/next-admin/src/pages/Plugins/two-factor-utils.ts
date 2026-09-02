/* oxlint-disable no-bitwise -- Base32 decoding and RFC 6238 dynamic truncation are bit-oriented. */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD_SECONDS = 30;
const MIN_SECRET_LENGTH = 8;
const MAX_SECRET_LENGTH = 256;
const LEGACY_STORAGE_PREFIX = 'vendure-two-factor-session:v1:';

export const MAX_TWO_FACTOR_ACCOUNTS = 100;

export class InvalidTwoFactorSecretError extends Error {
    constructor() {
        super('2FA 密钥不是有效的 Base32');
        this.name = 'InvalidTwoFactorSecretError';
    }
}

export function normalizeBase32Secret(value: string): string {
    const normalized = value
        .trim()
        .replace(/[\s-]+/g, '')
        .replace(/=+$/g, '')
        .toUpperCase();
    if (
        normalized.length < MIN_SECRET_LENGTH ||
        normalized.length > MAX_SECRET_LENGTH ||
        !/^[A-Z2-7]+$/.test(normalized)
    ) {
        throw new InvalidTwoFactorSecretError();
    }
    return normalized;
}

export function decodeBase32(value: string): Uint8Array {
    const secret = normalizeBase32Secret(value);
    const output: number[] = [];
    let buffer = 0;
    let bits = 0;

    for (const character of secret) {
        const index = BASE32_ALPHABET.indexOf(character);
        if (index < 0) throw new InvalidTwoFactorSecretError();
        buffer = (buffer << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            output.push((buffer >>> bits) & 0xff);
            buffer &= bits === 0 ? 0 : (1 << bits) - 1;
        }
    }

    if (!output.length) throw new InvalidTwoFactorSecretError();
    return Uint8Array.from(output);
}

export async function generateTotp(
    value: string,
    timeMs = Date.now(),
    digits = DEFAULT_DIGITS,
    periodSeconds = DEFAULT_PERIOD_SECONDS,
): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持 Web Crypto');
    if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new Error('TOTP 位数无效');
    if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) throw new Error('TOTP 周期无效');

    const key = await globalThis.crypto.subtle.importKey(
        'raw',
        toArrayBuffer(decodeBase32(value)),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign'],
    );
    const counter = Math.floor(timeMs / 1000 / periodSeconds);
    const signature = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, counterBytes(counter)));
    const offset = signature[signature.length - 1] & 0x0f;
    const binary =
        ((signature[offset] & 0x7f) << 24) |
        ((signature[offset + 1] & 0xff) << 16) |
        ((signature[offset + 2] & 0xff) << 8) |
        (signature[offset + 3] & 0xff);
    return String(binary % 10 ** digits).padStart(digits, '0');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

function counterBytes(counter: number): ArrayBuffer {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, Math.floor(counter / 0x1_0000_0000), false);
    view.setUint32(4, counter >>> 0, false);
    return buffer;
}

export function getTotpSecondsRemaining(timeMs = Date.now(), periodSeconds = DEFAULT_PERIOD_SECONDS): number {
    return periodSeconds - (Math.floor(timeMs / 1000) % periodSeconds);
}

export function formatTotpCode(code: string): string {
    return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export type BatchImportErrorCode =
    'MISSING_NAME' | 'MISSING_SECRET' | 'INVALID_SECRET' | 'DUPLICATE_SECRET' | 'LIMIT_REACHED';

export interface ParsedBatchAccount {
    lineNumber: number;
    projectName: string;
    secret: string;
}

export interface BatchImportError {
    lineNumber: number;
    code: BatchImportErrorCode;
}

export function parseBatchImport(
    input: string,
    existingSecrets: Iterable<string> = [],
    maximumAccounts = MAX_TWO_FACTOR_ACCOUNTS,
): { accounts: ParsedBatchAccount[]; errors: BatchImportError[] } {
    const accounts: ParsedBatchAccount[] = [];
    const errors: BatchImportError[] = [];
    const seenSecrets = new Set<string>();
    for (const secret of existingSecrets) {
        try {
            seenSecrets.add(normalizeBase32Secret(secret));
        } catch {
            // Malformed legacy values must not prevent validation of new rows.
        }
    }

    let unnamedIndex = 0;
    input.split(/\r?\n/).forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const line = rawLine.trim();
        if (!line) return;

        const separatorIndex = line.indexOf('|');
        let projectName: string;
        let rawSecret: string;
        if (separatorIndex >= 0) {
            projectName = line.slice(0, separatorIndex).trim();
            rawSecret = line.slice(separatorIndex + 1).trim();
            if (!projectName || projectName.length > 80) {
                errors.push({ lineNumber, code: 'MISSING_NAME' });
                return;
            }
        } else {
            unnamedIndex += 1;
            projectName = `未命名-${String(unnamedIndex).padStart(3, '0')}`;
            rawSecret = line;
        }

        if (!rawSecret) {
            errors.push({ lineNumber, code: 'MISSING_SECRET' });
            return;
        }

        let secret: string;
        try {
            secret = normalizeBase32Secret(rawSecret);
        } catch {
            errors.push({ lineNumber, code: 'INVALID_SECRET' });
            return;
        }
        if (seenSecrets.has(secret)) {
            errors.push({ lineNumber, code: 'DUPLICATE_SECRET' });
            return;
        }
        if (seenSecrets.size >= maximumAccounts) {
            errors.push({ lineNumber, code: 'LIMIT_REACHED' });
            return;
        }

        seenSecrets.add(secret);
        accounts.push({ lineNumber, projectName, secret });
    });
    return { accounts, errors };
}

export interface LegacyTwoFactorAccount {
    projectName: string;
    secret: string;
}

export function loadLegacyTwoFactorSessionAccounts(
    ownerId: string,
    storage = resolveSessionStorage(),
): { accounts: LegacyTwoFactorAccount[]; found: boolean; valid: boolean } {
    if (!ownerId || !storage) return { accounts: [], found: false, valid: true };
    try {
        const serialized = storage.getItem(`${LEGACY_STORAGE_PREFIX}${ownerId}`);
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

export function clearLegacyTwoFactorSessionStorage(ownerId: string, storage = resolveSessionStorage()): void {
    if (!ownerId || !storage) return;
    try {
        storage.removeItem(`${LEGACY_STORAGE_PREFIX}${ownerId}`);
    } catch {
        // Cleanup is best-effort when the browser restricts Session Storage.
    }
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
