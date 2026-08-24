import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const DEVELOPMENT_KEY = 'vendure-development-auto-card-key-do-not-use-in-production';
const KEY_MIN_LENGTH = 32;

@Injectable()
export class AutoCardCipherService {
    private readonly key: Buffer;
    private readonly fingerprintKey: Buffer;

    constructor() {
        const configured = process.env.AUTO_CARD_ENCRYPTION_KEY?.trim();
        const production = process.env.NODE_ENV === 'production';
        if (production && (!configured || configured.length < KEY_MIN_LENGTH || isPlaceholder(configured))) {
            throw new Error(
                'AUTO_CARD_ENCRYPTION_KEY must be a non-placeholder secret of at least 32 characters',
            );
        }
        const source =
            configured && configured.length >= KEY_MIN_LENGTH && !isPlaceholder(configured)
                ? configured
                : DEVELOPMENT_KEY;
        this.key = createHash('sha256').update(`payload:${source}`).digest();
        this.fingerprintKey = createHash('sha256').update(`fingerprint:${source}`).digest();
    }

    encrypt(values: Record<string, string>): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(sortRecord(values)), 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
    }

    decrypt(payload: string): Record<string, string> {
        const [version, ivValue, tagValue, encryptedValue, extra] = payload.split('.');
        if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue || extra) {
            throw new Error('发卡数据密文格式无效');
        }
        try {
            const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
            decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(encryptedValue, 'base64url')),
                decipher.final(),
            ]).toString('utf8');
            const parsed = JSON.parse(decrypted) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error();
            }
            return Object.fromEntries(
                Object.entries(parsed).map(([key, value]) => [key, typeof value === 'string' ? value : '']),
            );
        } catch {
            throw new Error('无法解密发卡数据，请检查 AUTO_CARD_ENCRYPTION_KEY');
        }
    }

    fingerprint(configId: string | number, values: Record<string, string>): string {
        return createHmac('sha256', this.fingerprintKey)
            .update(`${String(configId)}:${JSON.stringify(sortRecord(values))}`)
            .digest('hex');
    }
}

function sortRecord(values: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

function isPlaceholder(value: string): boolean {
    return /(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value);
}
