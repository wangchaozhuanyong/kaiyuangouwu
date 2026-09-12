import { Inject, Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import type { IcloudRelayPluginOptions } from '../types';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from '../constants';

@Injectable()
export class IcloudCipherService {
    private readonly key: Buffer;

    constructor(
        @Optional()
        @Inject(ICLOUD_RELAY_PLUGIN_OPTIONS)
        options?: IcloudRelayPluginOptions,
    ) {
        const rawSecret =
            options?.encryptionKey ||
            process.env.ICLOUD_RELAY_ENCRYPTION_KEY ||
            process.env.VENDURE_COOKIE_SECRET ||
            'vendure-icloud-relay-default-secret-key-32b';
        this.key = crypto.createHash('sha256').update(rawSecret).digest();
    }

    encrypt(plainText: string): string {
        if (!plainText) return '';
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
        const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    decrypt(cipherText: string): string {
        if (!cipherText) return '';
        const parts = cipherText.split(':');
        if (parts.length !== 3) {
            // If not in encrypted format (e.g. legacy plain text), return as-is
            return cipherText;
        }
        const [ivHex, tagHex, dataHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const encrypted = Buffer.from(dataHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    }
}
