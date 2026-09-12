import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

/** Pre-provisioned private bucket, role credentials, bounded objects; never creates infrastructure. */
export class PrivateImageObjectStore {
    private ready?: Promise<void>;
    constructor(
        private readonly bucket: string,
        private readonly prefix: 'avatars/v2/' | 'private/v1/',
        private readonly client = new S3Client({ region: process.env.AWS_REGION, maxAttempts: 2 }),
    ) {
        if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid image bucket');
    }

    destroy(): void {
        this.client.destroy();
    }

    private async withClient<T>(
        operation: (client: S3Client, signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        this.ready ??= this.client
            .send(new HeadBucketCommand({ Bucket: this.bucket }), {
                abortSignal: AbortSignal.timeout(10_000),
            })
            .then(() => undefined)
            .catch(error => {
                this.ready = undefined;
                throw error;
            });
        await this.ready;
        return operation(this.client, AbortSignal.timeout(15_000));
    }

    private key(value: string): string {
        if (
            !value.startsWith(this.prefix) ||
            value.length > 255 ||
            !/^[a-zA-Z0-9/_.,=-]+$/.test(value) ||
            value.split('/').some(part => !part || part === '.' || part === '..')
        ) {
            throw new Error('Invalid image object key');
        }
        return value;
    }

    async put(key: string, bytes: Buffer): Promise<void> {
        this.key(key);
        const maximum = this.prefix === 'avatars/v2/' ? 5 * 1024 * 1024 : 25 * 1024 * 1024;
        if (!bytes.length || bytes.length > maximum) throw new Error('Image object too large');
        const { fileTypeFromBuffer } = await import('file-type');
        const type = await fileTypeFromBuffer(bytes);
        if (!type || !['image/jpeg', 'image/png', 'image/webp'].includes(type.mime))
            throw new Error('Invalid image object');
        const digest = createHash('sha256').update(bytes).digest();
        try {
            await this.withClient((client, abortSignal) =>
                client.send(
                    new PutObjectCommand({
                        Bucket: this.bucket,
                        Key: key,
                        Body: bytes,
                        ContentLength: bytes.length,
                        ContentType: type.mime,
                        CacheControl:
                            this.prefix === 'avatars/v2/' ? 'public, max-age=300' : 'private, no-store',
                        ServerSideEncryption: 'AES256',
                        ChecksumSHA256: digest.toString('base64'),
                        Metadata: { sha256: digest.toString('hex') },
                        IfNoneMatch: '*',
                    }),
                    { abortSignal },
                ),
            );
        } catch (error) {
            if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412)
                throw error;
            const existing = await this.withClient((client, abortSignal) =>
                client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal }),
            );
            if (
                existing.Metadata?.sha256 !== digest.toString('hex') ||
                existing.ContentLength !== bytes.length
            ) {
                throw new Error('Image object already exists with different content');
            }
        }
    }

    async get(key: string): Promise<Buffer> {
        this.key(key);
        const response = await this.withClient((client, abortSignal) =>
            client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }), { abortSignal }),
        );
        const limit = this.prefix === 'avatars/v2/' ? 5 * 1024 * 1024 : 25 * 1024 * 1024;
        const body = response.Body;
        if (!(body instanceof Readable)) throw new Error('Invalid image response');
        if (typeof response.ContentLength !== 'number' || response.ContentLength > limit) {
            body.destroy();
            throw new Error('Invalid image response');
        }
        let size = 0;
        const chunks: Buffer[] = [];
        const deadline = setTimeout(() => body.destroy(new Error('Image read timeout')), 15_000);
        try {
            for await (const chunk of body) {
                size += chunk.length;
                if (size > limit) throw new Error('Image read exceeded limit');
                chunks.push(Buffer.from(chunk));
            }
            const bytes = Buffer.concat(chunks);
            if (
                !size ||
                size !== response.ContentLength ||
                createHash('sha256').update(bytes).digest('hex') !== response.Metadata?.sha256
            ) {
                throw new Error('Image integrity check failed');
            }
            return bytes;
        } finally {
            clearTimeout(deadline);
            body.destroy();
        }
    }

    async has(key: string): Promise<boolean> {
        this.key(key);
        try {
            await this.withClient((client, abortSignal) =>
                client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }), {
                    abortSignal,
                }),
            );
            return true;
        } catch (error) {
            if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
                return false;
            throw error;
        }
    }

    async delete(key: string): Promise<void> {
        this.key(key);
        await this.withClient((client, abortSignal) =>
            client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }), {
                abortSignal,
            }),
        );
    }

    async list(
        limit: number,
        cursor?: string,
    ): Promise<{ items: Array<{ key: string; modifiedAt: Date }>; cursor?: string }> {
        const result = await this.withClient((client, abortSignal) =>
            client.send(
                new ListObjectsV2Command({
                    Bucket: this.bucket,
                    Prefix: this.prefix,
                    MaxKeys: Math.min(200, Math.max(1, limit)),
                    ContinuationToken: cursor,
                }),
                { abortSignal },
            ),
        );
        return {
            items: (result.Contents ?? []).flatMap(item =>
                item.Key && item.LastModified
                    ? [{ key: this.key(item.Key), modifiedAt: item.LastModified }]
                    : [],
            ),
            cursor: result.IsTruncated ? result.NextContinuationToken : undefined,
        };
    }
}
