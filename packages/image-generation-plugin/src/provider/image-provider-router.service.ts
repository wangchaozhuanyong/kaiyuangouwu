import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { Brackets, IsNull, SelectQueryBuilder } from 'typeorm';

import { ImageModelConfig } from '../entities/image-model-config.entity';
import { ImageProviderCredentialModel } from '../entities/image-provider-credential-model.entity';
import { ImageProviderCredential } from '../entities/image-provider-credential.entity';
import { ImageProviderScope } from '../types';

export interface ImageProviderRoute {
    credential: ImageProviderCredential;
    selectionReason: string;
}

@Injectable()
export class ImageProviderRouterService {
    constructor(private readonly connection: TransactionalConnection) {}

    async select(
        ctx: RequestContext,
        input: { scope: ImageProviderScope; purpose: 'PROMPT' | 'IMAGE'; modelConfigId?: ID },
    ): Promise<ImageProviderRoute> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, ImageProviderCredential);
            const query = repository
                .createQueryBuilder('credential')
                .where('credential.scope = :scope', { scope: input.scope })
                .andWhere('credential.enabled = :enabled', { enabled: true })
                .andWhere('credential.archivedAt IS NULL')
                .andWhere('credential.healthStatus = :health', { health: 'HEALTHY' })
                .andWhere('(credential.cooldownUntil IS NULL OR credential.cooldownUntil <= :now)', {
                    now: new Date(),
                })
                .andWhere('credential.purpose IN (:...purposes)', { purposes: [input.purpose, 'BOTH'] })
                .orderBy('credential.priority', 'ASC')
                .addOrderBy('credential.id', 'ASC');
            if (input.modelConfigId) {
                applyModelBindingPolicy(query, input.modelConfigId, txCtx.channelId);
            }
            if (supportsLock(this.connection.rawConnection.options.type)) query.setLock('pessimistic_write');
            const candidates = await query.getMany();
            if (!candidates.length) {
                throw new UserInputError(
                    input.modelConfigId
                        ? `${input.scope} 没有已启用、正常且绑定当前模型的可用 Key`
                        : `${input.scope} 没有已启用且正常的提示词 Key`,
                );
            }
            const priority = Math.min(...candidates.map(item => item.priority));
            const group = candidates.filter(item => item.priority === priority);
            const { selected, totalWeight } = selectSmoothWeightedCredential(group);
            selected.lastUsedAt = new Date();
            await repository.save(group, { reload: false });
            return {
                credential: selected,
                selectionReason: `优先级 ${priority}；同级平滑加权轮询（权重 ${selected.weight}/${totalWeight}）`,
            };
        });
    }

    async findByCode(ctx: RequestContext, code: string): Promise<ImageProviderCredential | null> {
        return this.connection.getRepository(ctx, ImageProviderCredential).findOne({
            where: { code, archivedAt: IsNull() },
        });
    }

    async hasAvailable(
        ctx: RequestContext,
        input: { scope: ImageProviderScope; purpose: 'PROMPT' | 'IMAGE'; modelConfigId?: ID },
    ): Promise<boolean> {
        const query = this.connection
            .getRepository(ctx, ImageProviderCredential)
            .createQueryBuilder('credential')
            .where('credential.scope = :scope', { scope: input.scope })
            .andWhere('credential.enabled = :enabled', { enabled: true })
            .andWhere('credential.archivedAt IS NULL')
            .andWhere('credential.healthStatus = :health', { health: 'HEALTHY' })
            .andWhere('(credential.cooldownUntil IS NULL OR credential.cooldownUntil <= :now)', {
                now: new Date(),
            })
            .andWhere('credential.purpose IN (:...purposes)', { purposes: [input.purpose, 'BOTH'] });
        if (input.modelConfigId) {
            applyModelBindingPolicy(query, input.modelConfigId, ctx.channelId);
        }
        return (await query.getCount()) > 0;
    }

    async availablePromptModelIds(ctx: RequestContext, scope: ImageProviderScope): Promise<string[]> {
        const credentials = await this.connection
            .getRepository(ctx, ImageProviderCredential)
            .createQueryBuilder('credential')
            .where('credential.scope = :scope', { scope })
            .andWhere('credential.enabled = :enabled', { enabled: true })
            .andWhere('credential.archivedAt IS NULL')
            .andWhere('credential.healthStatus = :health', { health: 'HEALTHY' })
            .andWhere('(credential.cooldownUntil IS NULL OR credential.cooldownUntil <= :now)', {
                now: new Date(),
            })
            .andWhere('credential.purpose IN (:...purposes)', { purposes: ['PROMPT', 'BOTH'] })
            .orderBy('credential.priority', 'ASC')
            .addOrderBy('credential.id', 'ASC')
            .getMany();
        return [...new Set(credentials.map(credential => credential.textModelId.trim()).filter(Boolean))];
    }

    async recordFailure(
        ctx: RequestContext,
        credential: ImageProviderCredential,
        input: { httpStatus?: number; retryAfterSeconds?: number; message: string },
    ): Promise<void> {
        const consecutiveFailures = credential.consecutiveFailures + 1;
        const values: Partial<ImageProviderCredential> = {
            consecutiveFailures,
            healthMessage: input.message.slice(0, 500),
            lastTestedAt: new Date(),
        };
        if (input.httpStatus === 401 || input.httpStatus === 403) {
            values.healthStatus = 'UNHEALTHY';
            values.enabled = false;
        } else if (input.httpStatus === 429) {
            values.cooldownUntil = new Date(Date.now() + Math.max(1, input.retryAfterSeconds ?? 60) * 1_000);
        } else if (consecutiveFailures >= 3) {
            values.healthStatus = 'UNHEALTHY';
        }
        await this.connection
            .getRepository(ctx, ImageProviderCredential)
            .update({ id: credential.id }, values);
    }

    async recordSuccess(ctx: RequestContext, credential: ImageProviderCredential): Promise<void> {
        await this.connection.getRepository(ctx, ImageProviderCredential).update(
            { id: credential.id },
            {
                consecutiveFailures: 0,
                healthStatus: 'HEALTHY',
                healthMessage: '最近一次上游调用成功',
                cooldownUntil: null,
                lastTestedAt: new Date(),
            },
        );
    }
}

function applyModelBindingPolicy(
    query: SelectQueryBuilder<ImageProviderCredential>,
    modelConfigId: ID,
    channelId: ID,
): void {
    const selectedBinding = query
        .subQuery()
        .select('1')
        .from(ImageProviderCredentialModel, 'selected_binding')
        .where('selected_binding.credentialId = credential.id')
        .andWhere('selected_binding.modelConfigId = :modelConfigId')
        .getQuery();
    const currentChannelBinding = query
        .subQuery()
        .select('1')
        .from(ImageProviderCredentialModel, 'channel_binding')
        .innerJoin(ImageModelConfig, 'channel_model', 'channel_model.id = channel_binding.modelConfigId')
        .where('channel_binding.credentialId = credential.id')
        .andWhere('channel_model.channelId = :routeChannelId')
        .getQuery();

    query
        .andWhere(
            new Brackets(where =>
                where.where(`EXISTS ${selectedBinding}`).orWhere(`NOT EXISTS ${currentChannelBinding}`),
            ),
        )
        .setParameters({ modelConfigId, routeChannelId: channelId });
}

export function selectSmoothWeightedCredential<T extends { id: ID; weight: number; currentWeight: number }>(
    group: T[],
): { selected: T; totalWeight: number } {
    if (!group.length) throw new UserInputError('同优先级 Key 组不能为空');
    const totalWeight = group.reduce((sum, item) => sum + Math.max(1, item.weight), 0);
    for (const item of group) item.currentWeight += Math.max(1, item.weight);
    group.sort(
        (left, right) => right.currentWeight - left.currentWeight || Number(left.id) - Number(right.id),
    );
    const selected = group[0];
    selected.currentWeight -= totalWeight;
    return { selected, totalWeight };
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
