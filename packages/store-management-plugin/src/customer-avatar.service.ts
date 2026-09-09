import { Injectable } from '@nestjs/common';
import { LogicalOperator, SortOrder } from '@vendure/common/lib/generated-types';
import {
    Asset,
    AssetService,
    Channel,
    ChannelService,
    ConfigService,
    Customer,
    CustomerService,
    isGraphQlErrorResult,
    Logger,
    normalizeAvatarImage,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

export const CUSTOMER_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const CUSTOMER_AVATAR_TAG = 'customer-avatar';
const CUSTOMER_AVATAR_OWNER_TAG_PREFIX = 'customer-avatar-owner:';
const AVATAR_CUSTOMER_LIMIT = 5;
const AVATAR_CHANNEL_MAX_BYTES = 1024 * 1024 * 1024;
const AVATAR_CHANNEL_MAX_FILES = 10_000;

export interface CustomerAvatarUpload {
    filename: string;
    mimetype: string;
    encoding?: string;
    createReadStream(): NodeJS.ReadableStream;
}

@Injectable()
export class CustomerAvatarService {
    constructor(
        private readonly assetService: AssetService,
        private readonly customerService: CustomerService,
        private readonly connection: TransactionalConnection,
        private readonly config: ConfigService,
        private readonly channelService: ChannelService,
    ) {}

    async findMine(ctx: RequestContext): Promise<Asset | null> {
        if (!ctx.activeUserId) return null;
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) return null;
        const avatars = await this.assetService.findAll(ctx, {
            take: 1,
            tags: [CUSTOMER_AVATAR_TAG, this.ownerTag(customer)],
            tagsOperator: LogicalOperator.AND,
            sort: { createdAt: SortOrder.DESC },
        });
        return avatars.items[0] ?? null;
    }

    async uploadMine(ctx: RequestContext, file: Promise<CustomerAvatarUpload>): Promise<Asset> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const uploaded = await file;
        const mimeType = uploaded.mimetype.trim().toLowerCase();
        if (!isCustomerAvatarMimeType(mimeType)) {
            throw new UserInputError('头像仅支持 JPG、PNG 或 WebP 图片');
        }

        const bytes = await normalizeAvatarImage(await readAvatarUpload(uploaded));
        let previous: Asset[] = [];
        const asset = await this.connection.withTransaction(ctx, async txCtx => {
            // The channel row serializes quota checks across server processes. The
            // transaction owns the upload, so failures roll back both row and quota.
            const channel = this.connection
                .getRepository(txCtx, Channel)
                .createQueryBuilder('channel')
                .where('channel.id = :id', { id: txCtx.channelId });
            if (
                !['sqljs', 'sqlite', 'better-sqlite3'].includes(
                    String(this.connection.rawConnection.options.type),
                )
            ) {
                channel.setLock('pessimistic_write');
            }
            await channel.getOneOrFail();
            const avatars = await this.assetService.findAll(txCtx, {
                take: AVATAR_CUSTOMER_LIMIT,
                tags: [CUSTOMER_AVATAR_TAG, this.ownerTag(customer)],
                tagsOperator: LogicalOperator.AND,
                sort: { createdAt: SortOrder.DESC },
            });
            if (avatars.totalItems >= AVATAR_CUSTOMER_LIMIT)
                throw new UserInputError('头像存储配额已满，请联系管理员清理被引用的旧头像');
            // Compare timestamps inside the database: timestamp columns can otherwise
            // be decoded in a different timezone by API processes.
            const recentlyChanged =
                avatars.items[0] &&
                (await this.connection
                    .getRepository(txCtx, Asset)
                    .createQueryBuilder('avatar')
                    .where('avatar.id = :id', { id: avatars.items[0].id })
                    .andWhere(
                        `avatar.createdAt > ${recentAvatarCutoff(this.connection.rawConnection.options.type)}`,
                    )
                    .getExists());
            if (recentlyChanged) {
                throw new UserInputError('更换头像过于频繁，请一分钟后重试');
            }
            const usage = await this.connection
                .getRepository(txCtx, Asset)
                .createQueryBuilder('asset')
                .innerJoin('asset.channels', 'channel', 'channel.id = :channelId', {
                    channelId: txCtx.channelId,
                })
                .innerJoin('asset.tags', 'tag', 'tag.value = :tag', { tag: CUSTOMER_AVATAR_TAG })
                .select('COALESCE(SUM(asset.fileSize), 0)', 'bytes')
                .addSelect('COUNT(DISTINCT asset.id)', 'count')
                .getRawOne<{ bytes: string; count: string }>();
            if (
                Number(usage?.bytes ?? 0) + bytes.length > AVATAR_CHANNEL_MAX_BYTES ||
                Number(usage?.count ?? 0) >= AVATAR_CHANNEL_MAX_FILES
            )
                throw new UserInputError('店铺头像存储配额已满');
            previous = avatars.items;
            const created = await this.assetService.create(txCtx, {
                file: Promise.resolve({
                    filename: `customer-avatar-${String(customer.id)}-${randomUUID()}.webp`,
                    mimetype: 'image/webp',
                    encoding: uploaded.encoding ?? '7bit',
                    createReadStream: () => Readable.from(bytes),
                }),
                tags: [CUSTOMER_AVATAR_TAG, this.ownerTag(customer)],
            });
            if (isGraphQlErrorResult(created)) throw new UserInputError(created.message);
            return created;
        });
        // Cleanup happens after the replacement commits; a failed replacement never
        // removes the previous avatar. Shared/referenced assets retain their quota.
        for (const old of previous) {
            try {
                await this.removeUnusedAvatar(ctx, old, customer);
            } catch {
                Logger.warn('Old customer avatar retained after cleanup failure', 'CustomerAvatarService');
            }
        }
        return asset;
    }

    private async removeUnusedAvatar(ctx: RequestContext, old: Asset, customer: Customer): Promise<void> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const removed = await this.connection.withTransaction(ctx, async txCtx => {
            if (
                !['sqljs', 'sqlite', 'better-sqlite3'].includes(
                    String(this.connection.rawConnection.options.type),
                )
            ) {
                await this.connection
                    .getRepository(txCtx, Asset)
                    .createQueryBuilder('avatar')
                    .where('avatar.id = :id', { id: old.id })
                    .setLock('pessimistic_write')
                    .getOneOrFail();
            }
            const asset = await this.connection.getRepository(txCtx, Asset).findOne({
                where: { id: old.id },
                relations: ['channels', 'tags'],
            });
            if (
                !asset ||
                asset.tags.length !== 2 ||
                !asset.channels.some(channel => String(channel.id) === String(ctx.channelId)) ||
                !asset.tags.some(tag => tag.value === this.ownerTag(customer)) ||
                !asset.tags.some(tag => tag.value === CUSTOMER_AVATAR_TAG) ||
                asset.channels.some(
                    channel =>
                        ![String(ctx.channelId), String(defaultChannel.id)].includes(String(channel.id)),
                )
            )
                return;
            // Inspect registered relations, including plugin/custom-field references.
            for (const metadata of this.connection.rawConnection.entityMetadatas) {
                if (
                    ['Asset', 'AssetTranslation', 'Channel', 'Tag'].includes(metadata.name) ||
                    metadata.isJunction
                )
                    continue;
                for (const relation of metadata.relations.filter(
                    item => item.inverseEntityMetadata.target === Asset,
                )) {
                    const referenced = await this.connection
                        .getRepository(txCtx, metadata.target)
                        .createQueryBuilder('owner')
                        .innerJoin(`owner.${relation.propertyPath}`, 'avatar')
                        .where('avatar.id = :id', { id: asset.id })
                        .getExists();
                    if (referenced) return;
                }
                // Manual delivery packages store attachment IDs in JSON rather than a foreign key.
                if (metadata.findColumnWithPropertyName('attachmentAssetIdsJson')) {
                    const referenced = await this.connection
                        .getRepository(txCtx, metadata.target)
                        .createQueryBuilder('owner')
                        .where('owner.attachmentAssetIdsJson LIKE :id', {
                            id: `%${JSON.stringify(String(asset.id))}%`,
                        })
                        .getExists();
                    if (referenced) return;
                }
            }
            await this.connection.getRepository(txCtx, Asset).remove(asset);
            return asset;
        });
        if (removed) {
            const storage = this.config.assetOptions.assetStorageStrategy;
            await storage.deleteFile(removed.source);
            await storage.deleteFile(removed.preview);
        }
    }

    private async activeCustomerOrThrow(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) throw new UserInputError('请先登录后再更换头像');
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new UserInputError('当前账号没有客户资料');
        return customer;
    }

    private ownerTag(customer: Customer): string {
        return `${CUSTOMER_AVATAR_OWNER_TAG_PREFIX}${String(customer.id)}`;
    }
}

function recentAvatarCutoff(driver: unknown): string {
    switch (driver) {
        case 'postgres':
        case 'aurora-postgres':
        case 'cockroachdb':
            return "CURRENT_TIMESTAMP - INTERVAL '60 seconds'";
        case 'mysql':
        case 'mariadb':
        case 'aurora-mysql':
            return 'DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 60 SECOND)';
        case 'mssql':
            return 'DATEADD(second, -60, CURRENT_TIMESTAMP)';
        case 'oracle':
            return "CURRENT_TIMESTAMP - INTERVAL '60' SECOND";
        case 'sqlite':
        case 'better-sqlite3':
        case 'sqljs':
            return "datetime('now', '-60 seconds')";
        default:
            throw new UserInputError('当前数据库不支持头像频率校验');
    }
}

function isCustomerAvatarMimeType(mimeType: string): mimeType is (typeof CUSTOMER_AVATAR_MIME_TYPES)[number] {
    return CUSTOMER_AVATAR_MIME_TYPES.includes(mimeType as (typeof CUSTOMER_AVATAR_MIME_TYPES)[number]);
}

async function readAvatarUpload(upload: CustomerAvatarUpload): Promise<Buffer> {
    const stream = upload.createReadStream();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
        for await (const chunk of stream as AsyncIterable<Buffer | string>) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > CUSTOMER_AVATAR_MAX_BYTES) {
                if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
                throw new UserInputError('头像图片不能超过 5MB');
            }
            chunks.push(buffer);
        }
    } catch (error) {
        if (error instanceof UserInputError) throw error;
        throw new UserInputError('读取头像图片失败，请重新选择');
    }
    if (size === 0) throw new UserInputError('头像图片不能为空');
    return Buffer.concat(chunks);
}
