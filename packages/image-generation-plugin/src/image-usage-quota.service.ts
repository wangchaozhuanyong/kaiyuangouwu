import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';

import { ImageUsageQuotaBucket } from './entities/image-usage-quota-bucket.entity';
import { ImageUsageQuotaEvent } from './entities/image-usage-quota-event.entity';

export type ImageQuotaType =
    'PROMPT_MINUTE' | 'PROMPT_DAILY_FREE' | 'IMAGE_DAILY_FREE' | 'IMAGE_DAILY_SAFETY';

export interface ImageQuotaStatus {
    limit: number;
    unlimited: boolean;
    reserved: number;
    consumed: number;
    remaining: number;
    windowEndsAt: Date;
}

interface ReserveQuotaInput {
    customerId: ID;
    quotaType: ImageQuotaType;
    modelCode?: string;
    limit: number;
    unlimited?: boolean;
    requestedAmount: number;
    allowPartial?: boolean;
    idempotencyKey: string;
    resourceType: string;
    resourceId: string;
    metadata?: Record<string, any>;
}

@Injectable()
export class ImageUsageQuotaService {
    constructor(private readonly connection: TransactionalConnection) {}

    async status(
        ctx: RequestContext,
        customerId: ID,
        quotaType: ImageQuotaType,
        limit: number,
        unlimited = false,
        modelCode = '',
    ): Promise<ImageQuotaStatus> {
        const window = quotaWindow(quotaType, new Date());
        const bucket = await this.connection.getRepository(ctx, ImageUsageQuotaBucket).findOne({
            where: {
                channelId: ctx.channelId,
                customerId,
                quotaType,
                modelCode,
                windowKey: window.key,
            },
        });
        return quotaStatus(bucket, limit, unlimited, window.endsAt);
    }

    async reserve(ctx: RequestContext, input: ReserveQuotaInput): Promise<ImageUsageQuotaEvent | null> {
        validateLimit(input.limit, input.unlimited ?? false);
        if (!Number.isSafeInteger(input.requestedAmount) || input.requestedAmount <= 0) {
            throw new UserInputError('额度预占数量无效');
        }
        const eventRepository = this.connection.getRepository(ctx, ImageUsageQuotaEvent);
        const existing = await eventRepository.findOne({ where: { idempotencyKey: input.idempotencyKey } });
        if (existing) return existing;

        const bucket = await this.getOrCreateBucket(ctx, input);
        const available = bucket.unlimited
            ? input.requestedAmount
            : Math.max(0, bucket.limitSnapshot - bucket.reserved - bucket.consumed);
        const amount = input.allowPartial
            ? Math.min(input.requestedAmount, available)
            : input.requestedAmount;
        if (amount <= 0) return null;
        if (!bucket.unlimited && amount > available)
            throw new UserInputError(quotaExceededMessage(input.quotaType));

        bucket.reserved += amount;
        await this.connection.getRepository(ctx, ImageUsageQuotaBucket).save(bucket, { reload: false });
        return eventRepository.save(
            new ImageUsageQuotaEvent({
                bucketId: bucket.id,
                idempotencyKey: input.idempotencyKey,
                resourceType: input.resourceType,
                resourceId: input.resourceId,
                amount,
                consumedAmount: 0,
                releasedAmount: 0,
                state: 'RESERVED',
                consumedAt: null,
                releasedAt: null,
                metadata: input.metadata ?? null,
            }),
        );
    }

    async consumeAttempt(
        ctx: RequestContext,
        input: Omit<ReserveQuotaInput, 'requestedAmount' | 'allowPartial'>,
    ) {
        const event = await this.reserve(ctx, { ...input, requestedAmount: 1 });
        if (!event) throw new UserInputError(quotaExceededMessage(input.quotaType));
        return this.capture(ctx, event.id, 1);
    }

    async capture(ctx: RequestContext, eventId: ID, requestedAmount: number): Promise<ImageUsageQuotaEvent> {
        return this.mutateEvent(ctx, eventId, requestedAmount, 'CAPTURE');
    }

    async release(ctx: RequestContext, eventId: ID, requestedAmount?: number): Promise<ImageUsageQuotaEvent> {
        return this.mutateEvent(ctx, eventId, requestedAmount, 'RELEASE');
    }

    async refundConsumed(
        ctx: RequestContext,
        eventId: ID,
        requestedAmount: number,
    ): Promise<ImageUsageQuotaEvent> {
        const eventRepository = this.connection.getRepository(ctx, ImageUsageQuotaEvent);
        const eventQuery = eventRepository
            .createQueryBuilder('event')
            .where('event.id = :eventId', { eventId });
        if (supportsLock(this.connection.rawConnection.options.type)) eventQuery.setLock('pessimistic_write');
        const event = await eventQuery.getOne();
        if (!event) throw new UserInputError('找不到额度事件');
        const amount = Math.min(event.consumedAmount, requestedAmount);
        if (!Number.isSafeInteger(amount) || amount <= 0) return event;
        const bucketRepository = this.connection.getRepository(ctx, ImageUsageQuotaBucket);
        const bucketQuery = bucketRepository.createQueryBuilder('bucket').where('bucket.id = :bucketId', {
            bucketId: event.bucketId,
        });
        if (supportsLock(this.connection.rawConnection.options.type))
            bucketQuery.setLock('pessimistic_write');
        const bucket = await bucketQuery.getOne();
        if (!bucket) throw new UserInputError('找不到额度桶');
        bucket.consumed = Math.max(0, bucket.consumed - amount);
        bucket.released += amount;
        event.consumedAmount -= amount;
        event.releasedAmount += amount;
        event.releasedAt = new Date();
        event.state = event.releasedAmount === event.amount ? 'RELEASED' : 'PARTIALLY_SETTLED';
        await bucketRepository.save(bucket, { reload: false });
        return eventRepository.save(event);
    }

    private async mutateEvent(
        ctx: RequestContext,
        eventId: ID,
        requestedAmount: number | undefined,
        action: 'CAPTURE' | 'RELEASE',
    ): Promise<ImageUsageQuotaEvent> {
        const eventRepository = this.connection.getRepository(ctx, ImageUsageQuotaEvent);
        const eventQuery = eventRepository
            .createQueryBuilder('event')
            .where('event.id = :eventId', { eventId });
        if (supportsLock(this.connection.rawConnection.options.type)) eventQuery.setLock('pessimistic_write');
        const event = await eventQuery.getOne();
        if (!event) throw new UserInputError('找不到额度事件');
        const unsettled = event.amount - event.consumedAmount - event.releasedAmount;
        const amount = requestedAmount == null ? unsettled : Math.min(unsettled, requestedAmount);
        if (!Number.isSafeInteger(amount) || amount < 0) throw new UserInputError('额度结算数量无效');
        if (amount === 0) return event;

        const bucketRepository = this.connection.getRepository(ctx, ImageUsageQuotaBucket);
        const bucketQuery = bucketRepository.createQueryBuilder('bucket').where('bucket.id = :bucketId', {
            bucketId: event.bucketId,
        });
        if (supportsLock(this.connection.rawConnection.options.type))
            bucketQuery.setLock('pessimistic_write');
        const bucket = await bucketQuery.getOne();
        if (!bucket) throw new UserInputError('找不到额度桶');
        bucket.reserved = Math.max(0, bucket.reserved - amount);
        if (action === 'CAPTURE') {
            bucket.consumed += amount;
            event.consumedAmount += amount;
            event.consumedAt = new Date();
        } else {
            bucket.released += amount;
            event.releasedAmount += amount;
            event.releasedAt = new Date();
        }
        event.state =
            event.consumedAmount === event.amount
                ? 'CONSUMED'
                : event.releasedAmount === event.amount
                  ? 'RELEASED'
                  : 'PARTIALLY_SETTLED';
        await bucketRepository.save(bucket, { reload: false });
        return eventRepository.save(event);
    }

    private async getOrCreateBucket(ctx: RequestContext, input: ReserveQuotaInput) {
        const window = quotaWindow(input.quotaType, new Date());
        const repository = this.connection.getRepository(ctx, ImageUsageQuotaBucket);
        const where = {
            channelId: ctx.channelId,
            customerId: input.customerId,
            quotaType: input.quotaType,
            modelCode: input.modelCode ?? '',
            windowKey: window.key,
        };
        const query = repository.createQueryBuilder('bucket').where(where);
        if (supportsLock(this.connection.rawConnection.options.type)) query.setLock('pessimistic_write');
        let bucket = await query.getOne();
        if (!bucket) {
            bucket = await repository.save(
                new ImageUsageQuotaBucket({
                    ...where,
                    windowStartsAt: window.startsAt,
                    windowEndsAt: window.endsAt,
                    limitSnapshot: input.limit,
                    unlimited: input.unlimited ?? false,
                    reserved: 0,
                    consumed: 0,
                    released: 0,
                }),
            );
        } else if (bucket.limitSnapshot !== input.limit || bucket.unlimited !== Boolean(input.unlimited)) {
            bucket.limitSnapshot = input.limit;
            bucket.unlimited = Boolean(input.unlimited);
            await repository.save(bucket, { reload: false });
        }
        return bucket;
    }
}

function quotaStatus(
    bucket: ImageUsageQuotaBucket | null,
    limit: number,
    unlimited: boolean,
    windowEndsAt: Date,
): ImageQuotaStatus {
    const reserved = bucket?.reserved ?? 0;
    const consumed = bucket?.consumed ?? 0;
    return {
        limit,
        unlimited,
        reserved,
        consumed,
        remaining: unlimited ? 2_147_483_647 : Math.max(0, limit - reserved - consumed),
        windowEndsAt,
    };
}

function validateLimit(limit: number, unlimited: boolean): void {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new UserInputError('额度上限必须是非负整数');
    if (unlimited && limit !== 0) throw new UserInputError('不限次数开启时，额度数值必须为 0');
}

function quotaExceededMessage(type: ImageQuotaType): string {
    if (type === 'PROMPT_MINUTE') return '提示词优化操作过于频繁，请稍后再试';
    if (type === 'PROMPT_DAILY_FREE') return '今天的免费提示词优化额度已用完';
    if (type === 'IMAGE_DAILY_SAFETY') return '今天的生图安全额度已用完';
    return '今天的免费生图额度已用完';
}

export function quotaWindow(type: ImageQuotaType, now: Date) {
    if (type === 'PROMPT_MINUTE') {
        const minuteStartsAt = new Date(now);
        minuteStartsAt.setUTCSeconds(0, 0);
        return {
            key: minuteStartsAt.toISOString().slice(0, 16),
            startsAt: minuteStartsAt,
            endsAt: new Date(minuteStartsAt.getTime() + 60_000),
        };
    }
    const offsetMs = 8 * 60 * 60_000;
    const shifted = new Date(now.getTime() + offsetMs);
    const startsAt = new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - offsetMs,
    );
    return {
        key: shifted.toISOString().slice(0, 10),
        startsAt,
        endsAt: new Date(startsAt.getTime() + 24 * 60 * 60_000),
    };
}

function supportsLock(driverType: unknown): boolean {
    return new Set([
        'aurora-mysql',
        'aurora-postgres',
        'mariadb',
        'mssql',
        'mysql',
        'oracle',
        'postgres',
    ]).has(String(driverType));
}
