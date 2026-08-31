import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/core';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const DEVELOPMENT_KEY = 'vendure-development-dashboard-two-factor-key-do-not-use-in-production';
const KEY_MIN_LENGTH = 32;

@Injectable()
export class TwoFactorCipherService {
    private readonly encryptionKey: Buffer;
    private readonly fingerprintKey: Buffer;

    constructor() {
        const configured = process.env.TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY?.trim();
        const production = process.env.NODE_ENV === 'production';
        if (production && (!configured || configured.length < KEY_MIN_LENGTH || isPlaceholder(configured))) {
            throw new Error(
                'TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY must be a non-placeholder secret of at least 32 characters',
            );
        }
        const source =
            configured && configured.length >= KEY_MIN_LENGTH && !isPlaceholder(configured)
                ? configured
                : DEVELOPMENT_KEY;
        this.encryptionKey = createHash('sha256').update(`dashboard-2fa:payload:${source}`).digest();
        this.fingerprintKey = createHash('sha256').update(`dashboard-2fa:fingerprint:${source}`).digest();
    }

    encrypt(secret: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
    }

    decrypt(payload: string): string {
        const [version, ivValue, tagValue, encryptedValue, extra] = payload.split('.');
        if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue || extra) {
            throw new Error('后台 2FA 密钥密文格式无效');
        }
        try {
            const decipher = createDecipheriv(
                'aes-256-gcm',
                this.encryptionKey,
                Buffer.from(ivValue, 'base64url'),
            );
            decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
            return Buffer.concat([
                decipher.update(Buffer.from(encryptedValue, 'base64url')),
                decipher.final(),
            ]).toString('utf8');
        } catch {
            throw new Error('无法解密后台 2FA 密钥，请检查 TWO_FACTOR_DASHBOARD_ENCRYPTION_KEY');
        }
    }

    fingerprint(administratorId: ID, secret: string): string {
        return createHmac('sha256', this.fingerprintKey)
            .update(`${String(administratorId)}:${secret}`)
            .digest('hex');
    }
}

function isPlaceholder(value: string): boolean {
    return /(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value);
}
