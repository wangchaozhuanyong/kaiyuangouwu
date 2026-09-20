import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import {
    Asset,
    ConfigService,
    Logger,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { createHash } from 'node:crypto';
import { In, LessThanOrEqual } from 'typeorm';

import { DataRetentionRecord, DataRetentionStatus } from './entities/data-retention-record.entity';

export const CUSTOMER_AVATAR_RETENTION_DAYS = 30;
export const CUSTOMER_AVATAR_RETENTION_POLICY = 'CUSTOMER_AVATAR_REPLACED_30D';

const CUSTOMER_AVATAR_TAG = 'customer-avatar';
const CUSTOMER_AVATAR_OWNER_TAG_PREFIX = 'customer-avatar-owner:';
const RETIRED_STATUSES: DataRetentionStatus[] = ['PENDING', 'BLOCKED_REFERENCE', 'FAILED'];
const RETRYABLE_STATUSES: DataRetentionStatus[] = ['BLOCKED_REFERENCE', 'FAILED'];
const RETENTION_BATCH_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface CustomerAvatarHistoryEntry {
    id: ID;
    status: DataRetentionStatus;
    quarantinedAt: Date;
    purgeAfter: Date;
    legalHold: boolean;
    asset: Asset | null;
}

@Injectable()
export class DataRetentionService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly config: ConfigService,
    ) {}

    async retiredAvatarIds(ctx: RequestContext, customerId: ID): Promise<Set<string>> {
        const records = await this.connection.getRepository(ctx, DataRetentionRecord).find({
            select: { resourceKey: true },
            where: {
                channelId: ctx.channelId,
                resourceType: 'CUSTOMER_AVATAR',
                subjectKeyHash: customerAvatarSubjectHash(customerId),
                status: In(RETIRED_STATUSES),
            },
        });
        return new Set(records.map(record => record.resourceKey));
    }

    async quarantineAvatar(
        ctx: RequestContext,
        asset: Asset,
        customerId: ID,
        reason: 'REPLACED' | 'REMOVED' | 'RESTORE_REPLACEMENT' | 'ACCOUNT_CLOSURE',
        channelId: ID = ctx.channelId,
    ): Promise<DataRetentionRecord> {
        const repository = this.connection.getRepository(ctx, DataRetentionRecord);
        const resourceKey = String(asset.id);
        const existing = await repository.findOne({
            where: { resourceType: 'CUSTOMER_AVATAR', resourceKey },
        });
        if (existing?.status === 'PURGED') {
            throw new UserInputError('该头像已完成清理，不能再次进入保留队列');
        }
        const now = new Date();
        const purgeAfter = new Date(now.getTime() + CUSTOMER_AVATAR_RETENTION_DAYS * DAY_MS);
        const record = existing ?? new DataRetentionRecord();
        if (!existing) {
            record.legalHold = false;
            record.legalHoldReason = null;
            record.legalHoldChangedByUserId = null;
            record.legalHoldChangedAt = null;
        }
        record.channelId = channelId;
        record.resourceType = 'CUSTOMER_AVATAR';
        record.resourceKey = resourceKey;
        record.subjectKeyHash = customerAvatarSubjectHash(customerId);
        record.policyCode = CUSTOMER_AVATAR_RETENTION_POLICY;
        record.reason = reason;
        record.status = 'PENDING';
        record.quarantinedAt = now;
        record.purgeAfter = purgeAfter;
        record.nextAttemptAt = purgeAfter;
        record.attemptCount = 0;
        record.lastAttemptAt = null;
        record.lastError = null;
        record.completedAt = null;
        return repository.save(record);
    }

    async quarantineAllCustomerAvatars(ctx: RequestContext, customerId: ID): Promise<number> {
        const ownerTag = `${CUSTOMER_AVATAR_OWNER_TAG_PREFIX}${String(customerId)}`;
        const assets = await this.connection
            .getRepository(ctx, Asset)
            .createQueryBuilder('asset')
            .innerJoin('asset.tags', 'ownerTag', 'ownerTag.value = :ownerTag', { ownerTag })
            .leftJoinAndSelect('asset.tags', 'tags')
            .leftJoinAndSelect('asset.channels', 'channels')
            .getMany();
        let quarantined = 0;
        for (const asset of assets) {
            const existing = await this.connection.getRepository(ctx, DataRetentionRecord).findOne({
                where: { resourceType: 'CUSTOMER_AVATAR', resourceKey: String(asset.id) },
            });
            if (existing && RETIRED_STATUSES.includes(existing.status)) continue;
            const businessChannel =
                asset.channels.find(channel => channel.code !== DEFAULT_CHANNEL_CODE)?.id ?? ctx.channelId;
            await this.quarantineAvatar(ctx, asset, customerId, 'ACCOUNT_CLOSURE', businessChannel);
            quarantined += 1;
        }
        return quarantined;
    }

    async avatarHistory(ctx: RequestContext, customerId: ID): Promise<CustomerAvatarHistoryEntry[]> {
        const records = await this.connection.getRepository(ctx, DataRetentionRecord).find({
            where: {
                channelId: ctx.channelId,
                resourceType: 'CUSTOMER_AVATAR',
                subjectKeyHash: customerAvatarSubjectHash(customerId),
                status: In(RETIRED_STATUSES),
            },
            order: { quarantinedAt: 'DESC' },
            take: 30,
        });
        if (!records.length) return [];
        const assets = await this.connection.getRepository(ctx, Asset).find({
            where: { id: In(records.map(record => record.resourceKey)) },
        });
        const assetsById = new Map(assets.map(asset => [String(asset.id), asset]));
        return records.map(record => ({
            id: record.id,
            status: record.status,
            quarantinedAt: record.quarantinedAt,
            purgeAfter: record.purgeAfter,
            legalHold: record.legalHold,
            asset: assetsById.get(record.resourceKey) ?? null,
        }));
    }

    async ownedAvatarRecordForRestore(
        ctx: RequestContext,
        recordId: ID,
        customerId: ID,
    ): Promise<DataRetentionRecord> {
        const query = this.connection
            .getRepository(ctx, DataRetentionRecord)
            .createQueryBuilder('record')
            .where('record.id = :id', { id: recordId })
            .andWhere('record.channelId = :channelId', { channelId: ctx.channelId })
            .andWhere('record.resourceType = :resourceType', { resourceType: 'CUSTOMER_AVATAR' })
            .andWhere('record.subjectKeyHash = :subjectKeyHash', {
                subjectKeyHash: customerAvatarSubjectHash(customerId),
            });
        if (supportsPessimisticLock(this.connection.rawConnection.options.type)) {
            query.setLock('pessimistic_write');
        }
        const record = await query.getOne();
        if (!record || !RETIRED_STATUSES.includes(record.status)) {
            throw new UserInputError('该历史头像已不可恢复');
        }
        return record;
    }

    async restoreAvatarRecord(ctx: RequestContext, record: DataRetentionRecord): Promise<void> {
        record.status = 'RESTORED';
        record.nextAttemptAt = null;
        record.lastError = null;
        record.completedAt = new Date();
        await this.connection.getRepository(ctx, DataRetentionRecord).save(record, { reload: false });
    }

    async listRecords(ctx: RequestContext): Promise<DataRetentionRecord[]> {
        return this.connection.getRepository(ctx, DataRetentionRecord).find({
            order: { createdAt: 'DESC' },
            take: 100,
        });
    }

    async setLegalHold(
        ctx: RequestContext,
        id: ID,
        enabled: boolean,
        reason?: string | null,
    ): Promise<DataRetentionRecord> {
        const repository = this.connection.getRepository(ctx, DataRetentionRecord);
        const record = await repository.findOne({ where: { id } });
        if (!record) throw new UserInputError('数据保留记录不存在');
        if (!RETIRED_STATUSES.includes(record.status)) {
            throw new UserInputError('只有等待清理、引用阻断或清理失败的数据可以设置法律保留');
        }
        const normalizedReason = reason?.trim() || null;
        if (enabled && !normalizedReason) throw new UserInputError('设置法律保留时必须填写原因');
        record.legalHold = enabled;
        record.legalHoldReason = enabled ? normalizedReason : null;
        record.legalHoldChangedByUserId = ctx.activeUserId ?? null;
        record.legalHoldChangedAt = new Date();
        if (!enabled && record.nextAttemptAt && record.nextAttemptAt <= new Date()) {
            record.nextAttemptAt = new Date();
        }
        return repository.save(record);
    }

    async retry(ctx: RequestContext, id: ID): Promise<DataRetentionRecord> {
        const repository = this.connection.getRepository(ctx, DataRetentionRecord);
        const record = await repository.findOne({ where: { id } });
        if (!record) throw new UserInputError('数据保留记录不存在');
        if (!RETRYABLE_STATUSES.includes(record.status)) throw new UserInputError('该记录当前不能重试');
        record.nextAttemptAt = new Date(Math.max(Date.now(), record.purgeAfter.getTime()));
        record.lastError = null;
        return repository.save(record);
    }

    async purgeDue(
        ctx: RequestContext,
    ): Promise<{ processed: number; purged: number; blocked: number; failed: number }> {
        const due = await this.connection.getRepository(ctx, DataRetentionRecord).find({
            where: {
                status: In(RETIRED_STATUSES),
                legalHold: false,
                nextAttemptAt: LessThanOrEqual(new Date()),
            },
            order: { nextAttemptAt: 'ASC' },
            take: RETENTION_BATCH_SIZE,
        });
        const result = { processed: 0, purged: 0, blocked: 0, failed: 0 };
        for (const candidate of due) {
            result.processed += 1;
            try {
                const status = await this.purgeRecord(ctx, candidate.id);
                if (status === 'PURGED') result.purged += 1;
                else if (status === 'FAILED') result.failed += 1;
                else result.blocked += 1;
            } catch (error) {
                result.failed += 1;
                Logger.error(
                    `Data retention purge failed for record ${String(candidate.id)}: ${errorMessage(error)}`,
                    undefined,
                    'DataRetentionService',
                );
            }
        }
        return result;
    }

    private async purgeRecord(ctx: RequestContext, id: ID): Promise<DataRetentionStatus> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, DataRetentionRecord);
            const query = repository.createQueryBuilder('record').where('record.id = :id', { id });
            if (supportsPessimisticLock(this.connection.rawConnection.options.type)) {
                query.setLock('pessimistic_write');
            }
            const record = await query.getOne();
            const now = new Date();
            if (
                !record ||
                !RETIRED_STATUSES.includes(record.status) ||
                record.legalHold ||
                !record.nextAttemptAt ||
                record.nextAttemptAt > now
            ) {
                return record?.status ?? 'PURGED';
            }
            record.attemptCount += 1;
            record.lastAttemptAt = now;
            try {
                const blockedReason = await this.purgeCustomerAvatar(txCtx, record);
                if (blockedReason) {
                    record.status = 'BLOCKED_REFERENCE';
                    record.lastError = blockedReason;
                    record.nextAttemptAt = new Date(now.getTime() + DAY_MS);
                } else {
                    record.status = 'PURGED';
                    record.lastError = null;
                    record.nextAttemptAt = null;
                    record.completedAt = now;
                }
            } catch (error) {
                record.status = 'FAILED';
                record.lastError = errorMessage(error).slice(0, 500);
                record.nextAttemptAt = new Date(now.getTime() + HOUR_MS);
            }
            await repository.save(record, { reload: false });
            return record.status;
        });
    }

    private async purgeCustomerAvatar(
        ctx: RequestContext,
        record: DataRetentionRecord,
    ): Promise<string | null> {
        const resourceType = String((record as { resourceType: unknown }).resourceType);
        if (resourceType !== 'CUSTOMER_AVATAR') {
            throw new Error(`Unsupported retention resource type: ${resourceType}`);
        }
        const assetRepository = this.connection.getRepository(ctx, Asset);
        const asset = await assetRepository.findOne({
            where: { id: record.resourceKey },
            relations: ['channels', 'tags'],
        });
        if (!asset) return null;
        const ownerTag = asset.tags.find(tag => tag.value.startsWith(CUSTOMER_AVATAR_OWNER_TAG_PREFIX));
        if (
            !ownerTag ||
            !asset.tags.some(tag => tag.value === CUSTOMER_AVATAR_TAG) ||
            hashKey(ownerTag.value) !== record.subjectKeyHash ||
            !asset.channels.some(channel => String(channel.id) === String(record.channelId)) ||
            asset.channels.some(
                channel =>
                    String(channel.id) !== String(record.channelId) && channel.code !== DEFAULT_CHANNEL_CODE,
            )
        ) {
            return '资产所有权或店铺边界与保留记录不一致';
        }
        if (await this.hasExternalAssetReference(ctx, asset.id)) {
            return '资产仍被商品、订单或其他业务记录引用';
        }
        const storage = this.config.assetOptions.assetStorageStrategy;
        for (const path of new Set([asset.source, asset.preview])) {
            await storage.deleteFile(path);
        }
        await assetRepository.remove(asset);
        return null;
    }

    private async hasExternalAssetReference(ctx: RequestContext, assetId: ID): Promise<boolean> {
        for (const metadata of this.connection.rawConnection.entityMetadatas) {
            if (
                ['Asset', 'AssetTranslation', 'Channel', 'Tag'].includes(metadata.name) ||
                metadata.isJunction
            ) {
                continue;
            }
            for (const relation of metadata.relations.filter(
                item => item.inverseEntityMetadata.target === Asset,
            )) {
                const referenced = await this.connection
                    .getRepository(ctx, metadata.target)
                    .createQueryBuilder('owner')
                    .innerJoin(`owner.${relation.propertyPath}`, 'retainedAsset')
                    .where('retainedAsset.id = :id', { id: assetId })
                    .getExists();
                if (referenced) return true;
            }
            if (metadata.findColumnWithPropertyName('attachmentAssetIdsJson')) {
                const referenced = await this.connection
                    .getRepository(ctx, metadata.target)
                    .createQueryBuilder('owner')
                    .where('owner.attachmentAssetIdsJson LIKE :id', {
                        id: `%${JSON.stringify(String(assetId))}%`,
                    })
                    .getExists();
                if (referenced) return true;
            }
        }
        return false;
    }
}

export function customerAvatarSubjectHash(customerId: ID): string {
    return hashKey(`${CUSTOMER_AVATAR_OWNER_TAG_PREFIX}${String(customerId)}`);
}

function hashKey(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function supportsPessimisticLock(driver: unknown): boolean {
    return !['sqljs', 'sqlite', 'better-sqlite3'].includes(String(driver));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
