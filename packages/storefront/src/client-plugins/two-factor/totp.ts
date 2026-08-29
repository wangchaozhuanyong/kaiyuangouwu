/* eslint-disable no-bitwise -- Base32 decoding and RFC dynamic truncation are bit-oriented. */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD_SECONDS = 30;
const MIN_SECRET_LENGTH = 8;
const MAX_SECRET_LENGTH = 256;

export class InvalidTwoFactorSecretError extends Error {
    constructor(message = 'The 2FA secret is not valid Base32') {
        super(message);
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

export async function generateTotp(
    value: string,
    timeMs = Date.now(),
    digits = DEFAULT_DIGITS,
    periodSeconds = DEFAULT_PERIOD_SECONDS,
): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is not available in this browser');
    if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
        throw new Error('TOTP digits must be between 6 and 8');
    }
    if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
        throw new Error('TOTP period must be a positive integer');
    }

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

export function getTotpSecondsRemaining(timeMs = Date.now(), periodSeconds = DEFAULT_PERIOD_SECONDS): number {
    return periodSeconds - (Math.floor(timeMs / 1000) % periodSeconds);
}

export function formatTotpCode(code: string): string {
    return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
