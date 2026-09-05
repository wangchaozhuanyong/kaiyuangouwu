/* eslint-disable no-bitwise -- RFC 4226 truncation and Base32 encoding require bit operations. */
import {
    createCipheriv,
    createDecipheriv,
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createTotpSecret(): string {
    const bytes = randomBytes(20);
    let bits = 0;
    let value = 0;
    let result = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            result += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    return result;
}

function decodeBase32(secret: string): Buffer {
    let bits = 0;
    let value = 0;
    const bytes: number[] = [];
    for (const character of secret) {
        const digit = BASE32.indexOf(character);
        if (digit < 0) throw new Error('Invalid TOTP secret');
        value = (value << 5) | digit;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

/** RFC 4226/6238, SHA-1, 30-second steps, six digits. */
export function totpAtStep(secret: string, step: number, digits = 6): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
    const offset = digest[digest.length - 1] & 15;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

export function matchTotpStep(
    secret: string,
    code: string,
    lastUsedStep: number,
    now = Date.now(),
): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const current = Math.floor(now / 30000);
    for (const step of [current, current - 1, current + 1]) {
        if (
            step > lastUsedStep &&
            timingSafeEqual(Buffer.from(code), Buffer.from(totpAtStep(secret, step)))
        ) {
            return step;
        }
    }
    return null;
}

export const hashValue = (value: string) => createHash('sha256').update(value).digest('hex');
export const newOpaqueToken = () => randomBytes(32).toString('base64url');
export const normalizeRecoveryCode = (code: string) => code.replace(/[\s-]/g, '').toUpperCase();
export const createRecoveryCodes = () =>
    Array.from({ length: 10 }, () => {
        const hex = randomBytes(16).toString('hex').toUpperCase();
        return Array.from({ length: 8 }, (_, index) => hex.slice(index * 4, index * 4 + 4)).join('-');
    });

/** No development fallback: an absent key disables enrollment and fails closed for enrolled users. */
export class AdminTwoFactorCrypto {
    private readonly key: Buffer | undefined;

    constructor(source = process.env.ADMIN_TWO_FACTOR_ENCRYPTION_KEY) {
        if (source && /^[a-f0-9]{64}$/i.test(source) && new Set(source.toLowerCase()).size > 8) {
            this.key = Buffer.from(source, 'hex');
        }
    }

    get available(): boolean {
        return !!this.key;
    }

    private requireKey(): Buffer {
        if (!this.key) throw new Error('登录 2FA 安全密钥未配置，请联系系统管理员');
        return this.key;
    }

    encrypt(secret: string, userId: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.requireKey(), iv);
        cipher.setAAD(Buffer.from(`admin-login-2fa:v1:${userId}`));
        const payload = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
        return [
            'v1',
            iv.toString('base64url'),
            cipher.getAuthTag().toString('base64url'),
            payload.toString('base64url'),
        ].join('.');
    }

    decrypt(payload: string, userId: string): string {
        const [version, iv, tag, value, extra] = payload.split('.');
        if (version !== 'v1' || !iv || !tag || !value || extra) throw new Error('登录 2FA 密钥不可用');
        try {
            const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), Buffer.from(iv, 'base64url'));
            decipher.setAAD(Buffer.from(`admin-login-2fa:v1:${userId}`));
            decipher.setAuthTag(Buffer.from(tag, 'base64url'));
            return Buffer.concat([
                decipher.update(Buffer.from(value, 'base64url')),
                decipher.final(),
            ]).toString('utf8');
        } catch {
            throw new Error('登录 2FA 密钥不可用，请联系系统管理员');
        }
    }

    passwordFingerprint(passwordHash: string): string {
        return createHmac('sha256', this.requireKey())
            .update(`admin-login-password:${passwordHash}`)
            .digest('hex');
    }
}
