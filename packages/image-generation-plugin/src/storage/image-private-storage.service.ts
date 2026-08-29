import { Inject, Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { fileTypeFromBuffer } from 'file-type';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { In, LessThan } from 'typeorm';

import { IMAGE_GENERATION_OPTIONS, MAX_REFERENCE_BYTES, MAX_REFERENCE_PIXELS } from '../constants';
import { ImagePrivateAsset } from '../entities/image-private-asset.entity';
import { ImageGenerationPluginOptions, ProviderGenerationResult } from '../types';

const DEVELOPMENT_SECRET = 'vendure-development-image-download-signing-secret-do-not-use';
const OUTPUT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const REFERENCE_RETENTION_MS = 24 * 60 * 60 * 1_000;
const LINK_TTL_SECONDS = 300;
const MAX_GENERATED_BYTES = 25 * 1024 * 1024;

export interface UploadedImageFile {
    filename: string;
    mimetype: string;
    createReadStream(): NodeJS.ReadableStream;
}

@Injectable()
export class ImagePrivateStorageService {
    private readonly root: string;
    private readonly signingSecret: string;

    constructor(
        private readonly connection: TransactionalConnection,
        @Inject(IMAGE_GENERATION_OPTIONS) options: ImageGenerationPluginOptions,
    ) {
        const production = options.production ?? process.env.NODE_ENV === 'production';
        const configuredRoot = options.storageRoot ?? process.env.IMAGE_GENERATION_STORAGE_ROOT;
        if (production && (!configuredRoot || !path.isAbsolute(configuredRoot))) {
            throw new Error('IMAGE_GENERATION_STORAGE_ROOT must be an absolute path in production');
        }
        this.root = path.resolve(
            configuredRoot?.trim() || path.join(process.cwd(), '.vendure/image-generation-private'),
        );
        const configuredSecret =
            options.downloadSigningSecret ?? process.env.IMAGE_GENERATION_DOWNLOAD_SECRET;
        if (production && (!configuredSecret || !acceptableSecret(configuredSecret))) {
            throw new Error(
                'IMAGE_GENERATION_DOWNLOAD_SECRET must be a non-placeholder secret of at least 32 characters',
            );
        }
        this.signingSecret =
            configuredSecret && acceptableSecret(configuredSecret)
                ? configuredSecret.trim()
                : DEVELOPMENT_SECRET;
    }

    async storeReference(
        ctx: RequestContext,
        customerId: ID,
        upload: UploadedImageFile,
        maxBytes = MAX_REFERENCE_BYTES,
    ): Promise<ImagePrivateAsset> {
        const uploaded = await readUpload(upload, Math.min(MAX_REFERENCE_BYTES, maxBytes));
        const bytes = await normalizeReferenceImage(uploaded);
        if (bytes.length > maxBytes) throw new UserInputError('参考图总容量不足，请删除旧参考图后重试');
        return this.store(ctx, customerId, 'REFERENCE', bytes, upload.filename, null, REFERENCE_RETENTION_MS);
    }

    storeGenerated(
        ctx: RequestContext,
        customerId: ID,
        result: ProviderGenerationResult,
        outputName: string,
    ): Promise<ImagePrivateAsset> {
        if (result.bytes.length > MAX_GENERATED_BYTES) throw new UserInputError('生成图片超过 25MB');
        return this.store(
            ctx,
            customerId,
            'OUTPUT',
            result.bytes,
            outputName,
            result.metadata ?? null,
            OUTPUT_RETENTION_MS,
        );
    }

    async read(asset: ImagePrivateAsset): Promise<Buffer> {
        if (asset.deletedAt || asset.expiresAt.getTime() <= Date.now())
            throw new UserInputError('图片已删除或过期');
        return readFile(this.absolutePath(asset.storageKey));
    }

    signedUrl(asset: ImagePrivateAsset, customerId: ID, download = false): string | null {
        if (asset.deletedAt || asset.expiresAt.getTime() <= Date.now()) return null;
        const payload = {
            assetId: String(asset.id),
            customerId: String(customerId),
            expiresAt: Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS,
            download,
        };
        const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
        return `/image-generation/private/${encoded}.${this.signature(encoded)}`;
    }

    async authorize(
        token: string,
    ): Promise<{ asset: ImagePrivateAsset; path: string; download: boolean } | undefined> {
        const [encoded, suppliedSignature, extra] = token.split('.');
        if (!encoded || !suppliedSignature || extra) return;
        const expectedSignature = this.signature(encoded);
        const supplied = Buffer.from(suppliedSignature);
        const expected = Buffer.from(expectedSignature);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return;
        try {
            const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
                assetId?: string;
                customerId?: string;
                expiresAt?: number;
                download?: boolean;
            };
            if (
                !payload.assetId ||
                !payload.customerId ||
                !Number.isInteger(payload.expiresAt) ||
                (payload.expiresAt ?? 0) <= Date.now() / 1000
            )
                return;
            const asset = await this.connection.rawConnection.getRepository(ImagePrivateAsset).findOne({
                where: { id: payload.assetId as ID, customerId: payload.customerId as ID },
            });
            if (!asset || asset.deletedAt || asset.expiresAt.getTime() <= Date.now()) return;
            const filePath = this.absolutePath(asset.storageKey);
            if (!existsSync(filePath)) return;
            return { asset, path: filePath, download: payload.download === true };
        } catch {
            return;
        }
    }

    async deleteOwned(ctx: RequestContext, assetId: ID, customerId: ID): Promise<boolean> {
        const repository = this.connection.getRepository(ctx, ImagePrivateAsset);
        const asset = await repository.findOne({
            where: { id: assetId, channelId: ctx.channelId, customerId },
        });
        if (!asset || asset.deletedAt) return false;
        asset.deletedAt = new Date();
        asset.originalName = 'deleted';
        asset.providerMetadata = null;
        await repository.save(asset, { reload: false });
        await unlink(this.absolutePath(asset.storageKey)).catch(() => undefined);
        return true;
    }

    async expireReferenceAfterTerminal(ctx: RequestContext, assetId: ID): Promise<void> {
        const repository = this.connection.getRepository(ctx, ImagePrivateAsset);
        const asset = await repository.findOne({
            where: { id: assetId, channelId: ctx.channelId, kind: 'REFERENCE' },
        });
        if (!asset) return;
        const terminalExpiry = new Date(Date.now() + REFERENCE_RETENTION_MS);
        if (asset.expiresAt.getTime() > terminalExpiry.getTime()) {
            asset.expiresAt = terminalExpiry;
            await repository.save(asset, { reload: false });
        }
    }

    async retainReferenceWhileActive(ctx: RequestContext, assetId: ID): Promise<void> {
        const repository = this.connection.getRepository(ctx, ImagePrivateAsset);
        if (supportsPrivateAssetLock(this.connection.rawConnection.options.type)) {
            await repository
                .createQueryBuilder('asset')
                .setLock('pessimistic_write')
                .where('asset.id = :id', { id: assetId })
                .getOne();
        }
        const asset = await repository.findOne({
            where: { id: assetId, channelId: ctx.channelId, kind: 'REFERENCE' },
        });
        if (!asset || asset.deletedAt || asset.expiresAt.getTime() <= Date.now()) {
            throw new UserInputError('参考图不存在或已过期');
        }
        const activeTaskExpiry = new Date(Date.now() + OUTPUT_RETENTION_MS);
        if (asset.expiresAt.getTime() < activeTaskExpiry.getTime()) {
            asset.expiresAt = activeTaskExpiry;
            await repository.save(asset, { reload: false });
        }
    }

    async purgeExpired(): Promise<number> {
        const repository = this.connection.rawConnection.getRepository(ImagePrivateAsset);
        const expired = await repository
            .createQueryBuilder('asset')
            .where('asset.expiresAt <= :now', { now: new Date() })
            .andWhere('asset.deletedAt IS NULL')
            .take(200)
            .getMany();
        for (const asset of expired) {
            await unlink(this.absolutePath(asset.storageKey)).catch(() => undefined);
            await repository.remove(asset);
        }
        const tombstoneLimit = Math.max(0, 200 - expired.length);
        const staleTombstones = tombstoneLimit
            ? await repository.find({
                  where: { deletedAt: LessThan(new Date(Date.now() - 31 * 24 * 60 * 60_000)) },
                  take: tombstoneLimit,
              })
            : [];
        if (staleTombstones.length) await repository.remove(staleTombstones);
        return (
            expired.length +
            staleTombstones.length +
            (await this.purgeOrphans(Math.max(0, 200 - expired.length - staleTombstones.length)))
        );
    }

    private async store(
        ctx: RequestContext,
        customerId: ID,
        kind: 'REFERENCE' | 'OUTPUT',
        bytes: Buffer,
        originalName: string,
        providerMetadata: Record<string, any> | null,
        retentionMs: number,
    ): Promise<ImagePrivateAsset> {
        const detected = await fileTypeFromBuffer(bytes);
        if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
            throw new UserInputError('仅支持 JPEG、PNG 或 WebP 图片');
        }
        let metadata: sharp.Metadata;
        try {
            metadata = await sharp(bytes, {
                failOn: 'error',
                limitInputPixels: MAX_REFERENCE_PIXELS,
            }).metadata();
        } catch {
            throw new UserInputError('图片文件损坏或像素过大');
        }
        if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_REFERENCE_PIXELS) {
            throw new UserInputError('图片不能超过 4000 万像素');
        }
        const now = new Date();
        const dateSegment = now.toISOString().slice(0, 7);
        const storageKey = `${kind.toLowerCase()}/${dateSegment}/${randomUUID()}.${detected.ext}`;
        const outputPath = this.absolutePath(storageKey);
        await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
        await writeFile(outputPath, bytes, { mode: 0o600, flag: 'wx' });
        try {
            return await this.connection.getRepository(ctx, ImagePrivateAsset).save(
                new ImagePrivateAsset({
                    channelId: ctx.channelId,
                    customerId,
                    kind,
                    storageKey,
                    originalName: safeFileName(originalName),
                    mimeType: detected.mime,
                    byteSize: bytes.length,
                    width: metadata.width,
                    height: metadata.height,
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                    expiresAt: new Date(now.getTime() + retentionMs),
                    deletedAt: null,
                    providerMetadata,
                }),
            );
        } catch (error) {
            await unlink(outputPath).catch(() => undefined);
            throw error;
        }
    }

    private absolutePath(storageKey: string): string {
        const candidate = path.resolve(this.root, storageKey);
        if (!candidate.startsWith(`${this.root}${path.sep}`)) throw new Error('非法图片存储路径');
        return candidate;
    }

    private signature(encoded: string): string {
        return createHmac('sha256', this.signingSecret).update(encoded).digest('base64url');
    }

    private async purgeOrphans(limit: number): Promise<number> {
        if (limit <= 0 || !existsSync(this.root)) return 0;
        const files = await storageFiles(this.root, this.root, Math.max(limit * 4, 200));
        const cutoff = Date.now() - 60 * 60_000;
        const candidates = files.filter(file => file.mtimeMs <= cutoff).slice(0, limit);
        if (!candidates.length) return 0;
        const existing = await this.connection.rawConnection.getRepository(ImagePrivateAsset).find({
            where: { storageKey: In(candidates.map(file => file.storageKey)) },
            select: { storageKey: true },
        });
        const known = new Set(existing.map(asset => asset.storageKey));
        let removed = 0;
        for (const candidate of candidates) {
            if (known.has(candidate.storageKey)) continue;
            if (
                await unlink(candidate.path)
                    .then(() => true)
                    .catch(() => false)
            )
                removed += 1;
        }
        return removed;
    }
}

async function normalizeReferenceImage(bytes: Buffer): Promise<Buffer> {
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected || !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
        throw new UserInputError('仅支持 JPEG、PNG 或 WebP 图片');
    }
    const pipeline = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_REFERENCE_PIXELS }).rotate();
    try {
        if (detected.mime === 'image/jpeg') return await pipeline.jpeg({ quality: 95 }).toBuffer();
        if (detected.mime === 'image/webp') return await pipeline.webp({ quality: 95 }).toBuffer();
        return await pipeline.png({ compressionLevel: 9 }).toBuffer();
    } catch {
        throw new UserInputError('图片文件损坏或像素过大');
    }
}

async function storageFiles(
    root: string,
    directory: string,
    limit: number,
): Promise<Array<{ path: string; storageKey: string; mtimeMs: number }>> {
    const found: Array<{ path: string; storageKey: string; mtimeMs: number }> = [];
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (found.length >= limit) break;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...(await storageFiles(root, entryPath, limit - found.length)));
            continue;
        }
        if (!entry.isFile()) continue;
        const details = await stat(entryPath).catch(() => undefined);
        if (!details) continue;
        found.push({
            path: entryPath,
            storageKey: path.relative(root, entryPath).split(path.sep).join('/'),
            mtimeMs: details.mtimeMs,
        });
    }
    return found;
}

async function readUpload(upload: UploadedImageFile, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of upload.createReadStream() as AsyncIterable<Buffer | string>) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) throw new UserInputError('参考图不能超过 10MB');
        chunks.push(buffer);
    }
    if (!size) throw new UserInputError('参考图为空');
    return Buffer.concat(chunks);
}

function safeFileName(value: string): string {
    const normalized = path
        .basename(value || 'image')
        .replace(/[^\p{L}\p{N}._ -]/gu, '_')
        .slice(0, 80);
    return normalized || 'image';
}

function acceptableSecret(value: string): boolean {
    return (
        value.trim().length >= 32 &&
        !/(?:replace|example|change[-_ ]?me|development|test[-_ ]?secret)/iu.test(value)
    );
}

function supportsPrivateAssetLock(driverType: unknown): boolean {
    return new Set([
        'aurora-mysql',
        'aurora-postgres',
        'cockroachdb',
        'mariadb',
        'mssql',
        'mysql',
        'oracle',
        'postgres',
    ]).has(String(driverType));
}
