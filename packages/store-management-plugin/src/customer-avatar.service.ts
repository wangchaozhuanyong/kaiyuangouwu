import { Injectable } from '@nestjs/common';
import { LogicalOperator, SortOrder } from '@vendure/common/lib/generated-types';
import {
    Asset,
    AssetService,
    Channel,
    Customer,
    CustomerService,
    isGraphQlErrorResult,
    normalizeAvatarImage,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { CustomerAvatarHistoryEntry, DataRetentionService } from './data-retention.service';

export const CUSTOMER_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const CUSTOMER_AVATAR_TAG = 'customer-avatar';
const CUSTOMER_AVATAR_OWNER_TAG_PREFIX = 'customer-avatar-owner:';
const AVATAR_CUSTOMER_MAX_STORED = 32;
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
        private readonly dataRetention: DataRetentionService,
    ) {}

    async findMine(ctx: RequestContext): Promise<Asset | null> {
        if (!ctx.activeUserId) return null;
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) return null;
        const avatars = await this.ownerAvatars(ctx, customer);
        const retired = await this.dataRetention.retiredAvatarIds(ctx, customer.id);
        return avatars.items.find(avatar => !retired.has(String(avatar.id))) ?? null;
    }

    async historyMine(ctx: RequestContext): Promise<CustomerAvatarHistoryEntry[]> {
        const customer = await this.activeCustomerOrThrow(ctx);
        return this.dataRetention.avatarHistory(ctx, customer.id);
    }

    async restoreMine(ctx: RequestContext, retentionId: string): Promise<Asset> {
        const customer = await this.activeCustomerOrThrow(ctx);
        return this.connection.withTransaction(ctx, async txCtx => {
            await this.lockChannel(txCtx);
            const record = await this.dataRetention.ownedAvatarRecordForRestore(
                txCtx,
                retentionId,
                customer.id,
            );
            const asset = await this.connection.getRepository(txCtx, Asset).findOne({
                where: { id: record.resourceKey },
                relations: ['channels', 'tags'],
            });
            if (
                !asset ||
                !asset.tags.some(tag => tag.value === CUSTOMER_AVATAR_TAG) ||
                !asset.tags.some(tag => tag.value === this.ownerTag(customer)) ||
                !asset.channels.some(channel => String(channel.id) === String(txCtx.channelId))
            ) {
                throw new UserInputError('历史头像文件已不可用');
            }
            const avatars = await this.ownerAvatars(txCtx, customer);
            const retired = await this.dataRetention.retiredAvatarIds(txCtx, customer.id);
            for (const current of avatars.items.filter(
                item => !retired.has(String(item.id)) && String(item.id) !== String(asset.id),
            )) {
                await this.dataRetention.quarantineAvatar(txCtx, current, customer.id, 'RESTORE_REPLACEMENT');
            }
            await this.dataRetention.restoreAvatarRecord(txCtx, record);
            return asset;
        });
    }

    async removeMine(ctx: RequestContext): Promise<boolean> {
        const customer = await this.activeCustomerOrThrow(ctx);
        return this.connection.withTransaction(ctx, async txCtx => {
            await this.lockChannel(txCtx);
            const avatars = await this.ownerAvatars(txCtx, customer);
            const retired = await this.dataRetention.retiredAvatarIds(txCtx, customer.id);
            const active = avatars.items.filter(avatar => !retired.has(String(avatar.id)));
            for (const avatar of active) {
                await this.dataRetention.quarantineAvatar(txCtx, avatar, customer.id, 'REMOVED');
            }
            return active.length > 0;
        });
    }

    private ownerAvatars(ctx: RequestContext, customer: Customer) {
        return this.assetService.findAll(ctx, {
            take: AVATAR_CUSTOMER_MAX_STORED,
            tags: [CUSTOMER_AVATAR_TAG, this.ownerTag(customer)],
            tagsOperator: LogicalOperator.AND,
            sort: { createdAt: SortOrder.DESC },
        });
    }

    async uploadMine(ctx: RequestContext, file: Promise<CustomerAvatarUpload>): Promise<Asset> {
        const customer = await this.activeCustomerOrThrow(ctx);
        const uploaded = await file;
        const mimeType = uploaded.mimetype.trim().toLowerCase();
        if (!isCustomerAvatarMimeType(mimeType)) {
            throw new UserInputError('头像仅支持 JPG、PNG 或 WebP 图片');
        }

        const bytes = await normalizeAvatarImage(await readAvatarUpload(uploaded));
        const asset = await this.connection.withTransaction(ctx, async txCtx => {
            // The channel row serializes quota checks across server processes. The
            // transaction owns the upload, so failures roll back both row and quota.
            await this.lockChannel(txCtx);
            const avatars = await this.ownerAvatars(txCtx, customer);
            if (avatars.totalItems >= AVATAR_CUSTOMER_MAX_STORED)
                throw new UserInputError('头像恢复区已满，请联系管理员检查保留或引用记录');
            const retired = await this.dataRetention.retiredAvatarIds(txCtx, customer.id);
            const activeAvatars = avatars.items.filter(avatar => !retired.has(String(avatar.id)));
            // Compare timestamps inside the database: timestamp columns can otherwise
            // be decoded in a different timezone by API processes.
            const recentlyChanged =
                activeAvatars[0] &&
                (await this.connection
                    .getRepository(txCtx, Asset)
                    .createQueryBuilder('avatar')
                    .where('avatar.id = :id', { id: activeAvatars[0].id })
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
            const created = await this.assetService.create(txCtx, {
                file: Promise.resolve({
                    filename: `customer-avatar-${randomUUID()}.webp`,
                    mimetype: 'image/webp',
                    encoding: uploaded.encoding ?? '7bit',
                    createReadStream: () => Readable.from(bytes),
                }),
                tags: [CUSTOMER_AVATAR_TAG, this.ownerTag(customer)],
            });
            if (isGraphQlErrorResult(created)) throw new UserInputError(created.message);
            for (const old of activeAvatars) {
                await this.dataRetention.quarantineAvatar(txCtx, old, customer.id, 'REPLACED');
            }
            return created;
        });
        return asset;
    }

    private async lockChannel(ctx: RequestContext): Promise<void> {
        const channel = this.connection
            .getRepository(ctx, Channel)
            .createQueryBuilder('channel')
            .where('channel.id = :id', { id: ctx.channelId });
        if (
            !['sqljs', 'sqlite', 'better-sqlite3'].includes(
                String(this.connection.rawConnection.options.type),
            )
        ) {
            channel.setLock('pessimistic_write');
        }
        await channel.getOneOrFail();
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
