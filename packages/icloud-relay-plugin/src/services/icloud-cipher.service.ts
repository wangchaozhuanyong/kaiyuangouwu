import { Inject, Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from '../constants';
import { type IcloudRelayPluginOptions } from '../types';

@Injectable()
export class IcloudCipherService {
    private readonly key: Buffer;
    private readonly queryAuditKey: Buffer;

    constructor(
        @Optional()
        @Inject(ICLOUD_RELAY_PLUGIN_OPTIONS)
        options?: IcloudRelayPluginOptions,
    ) {
        const configuredSecret =
            options?.encryptionKey ||
            process.env.ICLOUD_RELAY_ENCRYPTION_KEY ||
            process.env.VENDURE_COOKIE_SECRET;
        const rawSecret = configuredSecret || 'vendure-icloud-relay-default-secret-key-32b';
        this.key = crypto.createHash('sha256').update(rawSecret).digest();
        // Local installs without a configured secret still need an unguessable audit key.
        this.queryAuditKey = configuredSecret
            ? crypto.createHmac('sha256', configuredSecret).update('vendure:icloud-query-audit:v1').digest()
            : crypto.randomBytes(32);
    }

    fingerprintQueryCode(queryCode: string): string {
        return crypto.createHmac('sha256', this.queryAuditKey).update(queryCode).digest('hex');
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
