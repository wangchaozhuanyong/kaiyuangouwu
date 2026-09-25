import { Inject, Injectable, Optional } from '@nestjs/common';
import { processCustomerImage, UserInputError } from '@vendure/core';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

import { normalizeDigitalDeliveryHost } from './digital-delivery-token.service';

export const AFTER_SALES_EVIDENCE_STORAGE = 'AFTER_SALES_EVIDENCE_STORAGE';
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
export const EVIDENCE_STORAGE_PREFIX = 'private/v1/after-sales/';

export interface AfterSalesEvidenceStorageOptions {
    rootDirectory?: string;
    signingSecret?: string;
    production?: boolean;
    blobStore?: {
        put(key: string, bytes: Buffer): Promise<void>;
        get(key: string): Promise<Buffer>;
        delete(key: string): Promise<void>;
    };
}

export interface EvidenceUpload {
    filename: string;
    mimetype: string;
    createReadStream(): NodeJS.ReadableStream;
}

export interface EvidenceLink {
    id: string;
    channelId: string;
    customerId: string;
    host: string;
    expiresAt: number;
}

@Injectable()
export class AfterSalesEvidenceStorageService {
    private readonly root: string;
    private readonly secret?: string;
    private readonly objects?: AfterSalesEvidenceStorageOptions['blobStore'];

    constructor(
        @Optional() @Inject(AFTER_SALES_EVIDENCE_STORAGE) options: AfterSalesEvidenceStorageOptions = {},
    ) {
        const production = options.production ?? process.env.NODE_ENV === 'production';
        const root = options.rootDirectory ?? process.env.IMAGE_GENERATION_STORAGE_ROOT;
        if (production && (!root || !path.isAbsolute(root)))
            throw new Error('Private evidence storage needs an absolute private image root');
        this.root = path.resolve(root || path.join(process.cwd(), '.vendure/image-generation-private'));
        const secret = options.signingSecret ?? process.env.IMAGE_GENERATION_DOWNLOAD_SECRET;
        this.secret =
            secret &&
            secret.trim().length >= 32 &&
            !/(?:replace|example|change[-_ ]?me|development)/iu.test(secret)
                ? secret.trim()
                : production
                  ? undefined
                  : randomBytes(32).toString('base64url');
        this.objects = options.blobStore;
    }

    async prepare(
        upload: EvidenceUpload,
    ): Promise<{ bytes: Buffer; storageKey: string; mimeType: string; sha256: string }> {
        if (!this.secret) throw new UserInputError('售后图片服务暂不可用，请联系客服');
        const stream = upload.createReadStream();
        const chunks: Buffer[] = [];
        let size = 0;
        const deadline = setTimeout(
            () =>
                (stream as NodeJS.ReadableStream & { destroy(error: Error): void }).destroy(
                    new Error('Upload timeout'),
                ),
            30_000,
        );
        try {
            for await (const part of stream) {
                const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
                size += chunk.length;
                if (size > MAX_EVIDENCE_BYTES) throw new UserInputError('每张凭证图片不能超过 5MB');
                chunks.push(chunk);
            }
        } finally {
            clearTimeout(deadline);
        }
        // Reuse the existing restricted image decoder and metadata stripping.
        const bytes = await processCustomerImage(Buffer.concat(chunks), 'reference');
        if (bytes.length > MAX_EVIDENCE_BYTES) throw new UserInputError('每张凭证图片不能超过 5MB');
        const extension = bytes[0] === 0xff ? 'jpg' : bytes[0] === 0x89 ? 'png' : 'webp';
        return {
            bytes,
            storageKey: `${this.objects ? EVIDENCE_STORAGE_PREFIX : 'after-sales/'}${randomUUID()}.${extension}`,
            mimeType: extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
            sha256: createHash('sha256').update(bytes).digest('hex'),
        };
    }

    async write(key: string, bytes: Buffer): Promise<void> {
        this.checkKey(key);
        if (key.startsWith(EVIDENCE_STORAGE_PREFIX)) {
            if (!this.objects) throw new Error('Private object storage unavailable');
            await this.objects.put(key, bytes);
            return;
        }
        const directory = path.join(this.root, 'after-sales');
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if ((await realpath(directory)) !== directory)
            throw new Error('Evidence directory cannot be a symlink');
        const file = await open(
            path.join(this.root, key),
            // File-open flags are a bit mask; exclusive creation and no-follow are required here.
            // eslint-disable-next-line no-bitwise
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            0o600,
        );
        try {
            await file.writeFile(bytes);
        } finally {
            await file.close();
        }
    }

    async read(key: string, byteSize: number, sha256: string): Promise<Buffer> {
        this.checkKey(key);
        let bytes: Buffer;
        if (key.startsWith(EVIDENCE_STORAGE_PREFIX)) {
            if (!this.objects) throw new Error('Private object storage unavailable');
            bytes = await this.objects.get(key);
        } else {
            const filePath = path.join(this.root, key);
            if ((await realpath(filePath)) !== filePath) throw new Error('Evidence path cannot be a symlink');
            // eslint-disable-next-line no-bitwise
            const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const details = await file.stat();
                if (!details.isFile() || details.size !== byteSize || details.size > MAX_EVIDENCE_BYTES)
                    throw new Error('Evidence size mismatch');
                bytes = await file.readFile();
            } finally {
                await file.close();
            }
        }
        if (bytes.length !== byteSize || createHash('sha256').update(bytes).digest('hex') !== sha256)
            throw new Error('Evidence integrity check failed');
        return bytes;
    }

    async remove(key: string): Promise<void> {
        this.checkKey(key);
        if (key.startsWith(EVIDENCE_STORAGE_PREFIX)) {
            if (!this.objects) throw new Error('Private object storage unavailable');
            await this.objects.delete(key);
        } else {
            const filePath = path.join(this.root, key);
            try {
                if ((await realpath(filePath)) !== filePath)
                    throw new Error('Evidence path cannot be a symlink');
                await unlink(filePath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
    }

    sign(input: Omit<EvidenceLink, 'expiresAt'>): string | null {
        if (!this.secret || !normalizeDigitalDeliveryHost(input.host)) return null;
        const encoded = Buffer.from(
            JSON.stringify({ ...input, expiresAt: Math.floor(Date.now() / 1000) + 300 }),
        ).toString('base64url');
        return `/after-sales/evidence/${encoded}.${this.signature(encoded)}`;
    }

    verify(token: string, host: unknown): EvidenceLink | undefined {
        if (!this.secret || token.length > 2048) return;
        const [encoded, signature, extra] = token.split('.');
        if (!encoded || !signature || extra) return;
        const expected = Buffer.from(this.signature(encoded));
        const supplied = Buffer.from(signature);
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return;
        try {
            const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as EvidenceLink;
            if (
                ![value.id, value.channelId, value.customerId, value.host].every(
                    item => typeof item === 'string' && item.length > 0,
                ) ||
                normalizeDigitalDeliveryHost(host) !== value.host ||
                !Number.isInteger(value.expiresAt) ||
                value.expiresAt <= Date.now() / 1000
            )
                return;
            return value;
        } catch {
            return;
        }
    }

    private signature(encoded: string): string {
        if (!this.secret) throw new Error('Evidence signing is unavailable');
        return createHmac('sha256', this.secret)
            .update(`after-sales-evidence:v1:${encoded}`)
            .digest('base64url');
    }

    private checkKey(key: string): void {
        if (!/^(?:private\/v1\/)?after-sales\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(key))
            throw new Error('Invalid evidence storage key');
    }
}
