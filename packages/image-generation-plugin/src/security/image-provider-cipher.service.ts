import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const DEVELOPMENT_KEY = 'vendure-development-image-provider-key-do-not-use-in-production';
const MINIMUM_KEY_LENGTH = 32;

@Injectable()
export class ImageProviderCipherService {
    private readonly key: Buffer;

    constructor() {
        const configured = process.env.IMAGE_GENERATION_MASTER_KEY?.trim();
        const production = process.env.NODE_ENV === 'production';
        if (
            production &&
            (!configured || configured.length < MINIMUM_KEY_LENGTH || isPlaceholder(configured))
        ) {
            throw new Error(
                'IMAGE_GENERATION_MASTER_KEY must be a non-placeholder secret of at least 32 characters',
            );
        }
        const source =
            configured && configured.length >= MINIMUM_KEY_LENGTH && !isPlaceholder(configured)
                ? configured
                : DEVELOPMENT_KEY;
        this.key = createHash('sha256').update(`image-provider:${source}`).digest();
    }

    encrypt(apiKey: string): string {
        const value = apiKey.trim();
        if (!value) throw new Error('中转站 API Key 不能为空');
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
    }

    decrypt(payload: string): string {
        const [version, ivValue, tagValue, encryptedValue, extra] = payload.split('.');
        if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue || extra) {
            throw new Error('中转站 API Key 密文格式无效');
        }
        try {
            const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
            decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
            return Buffer.concat([
                decipher.update(Buffer.from(encryptedValue, 'base64url')),
                decipher.final(),
            ]).toString('utf8');
        } catch {
            throw new Error('无法解密中转站 API Key，请检查 IMAGE_GENERATION_MASTER_KEY');
        }
    }
}

function isPlaceholder(value: string): boolean {
    return /(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value);
}
