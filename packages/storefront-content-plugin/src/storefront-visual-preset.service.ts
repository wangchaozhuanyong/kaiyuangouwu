import { Injectable } from '@nestjs/common';
import {
    Channel,
    EventBus,
    ID,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

import { StorefrontContentBlock } from './entities/storefront-content-block.entity';
import { StorefrontContentChangedEvent } from './storefront-content-changed.event';
import {
    isStorefrontDesktopLayout,
    isStorefrontVisualPresetId,
    normalizeStorefrontDesktopLayout,
    normalizeStorefrontVisualPreset,
    STOREFRONT_VISUAL_PRESET_CODE,
    StorefrontVisualPresetConfig,
} from './visual-presets';

export interface UpdateStorefrontVisualPresetInput {
    channelId: ID;
    presetId?: string;
    desktopLayout?: string;
    expectedRevision: string;
}

@Injectable()
export class StorefrontVisualPresetService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly eventBus: EventBus,
    ) {}

    async get(ctx: RequestContext): Promise<StorefrontVisualPresetConfig> {
        const block = await this.connection.getRepository(ctx, StorefrontContentBlock).findOne({
            where: { channelId: ctx.channelId, code: STOREFRONT_VISUAL_PRESET_CODE },
        });
        return this.config(ctx, block);
    }

    async update(
        ctx: RequestContext,
        input: UpdateStorefrontVisualPresetInput,
    ): Promise<StorefrontVisualPresetConfig> {
        if (String(ctx.channelId) !== String(input.channelId))
            throw new UserInputError('店铺已切换，请重新载入皮肤设置');
        if (input.presetId !== undefined && !isStorefrontVisualPresetId(input.presetId))
            throw new UserInputError('请选择已发布的店铺皮肤');
        if (input.desktopLayout !== undefined && !isStorefrontDesktopLayout(input.desktopLayout))
            throw new UserInputError('请选择已发布的电脑端布局');
        if (input.presetId === undefined && input.desktopLayout === undefined)
            throw new UserInputError('请提交需要修改的皮肤或布局');

        // Serialize first-time creation as well as updates for the active channel.
        try {
            await this.connection
                .getRepository(ctx, Channel)
                .createQueryBuilder('channel')
                .setLock('pessimistic_write')
                .where('channel.id = :id', { id: ctx.channelId })
                .getOne();
        } catch (error) {
            if (
                !(error instanceof LockNotSupportedOnGivenDriverError) &&
                !(error instanceof Error && error.name === 'LockNotSupportedOnGivenDriverError')
            ) {
                throw error;
            }
        }
        const repository = this.connection.getRepository(ctx, StorefrontContentBlock);
        const current = await repository.findOne({
            where: { channelId: ctx.channelId, code: STOREFRONT_VISUAL_PRESET_CODE },
        });
        if (this.config(ctx, current).revision !== input.expectedRevision) {
            throw new UserInputError('皮肤设置已被其他管理员更新，请刷新后重试');
        }
        if (
            current &&
            (input.presetId === undefined || current.settings?.presetId === input.presetId) &&
            (input.desktopLayout === undefined || current.settings?.desktopLayout === input.desktopLayout)
        ) {
            return this.config(ctx, current);
        }
        const block =
            current ??
            new StorefrontContentBlock({
                channelId: ctx.channelId,
                channel: ctx.channel,
                code: STOREFRONT_VISUAL_PRESET_CODE,
                internalName: '店铺视觉预设',
                type: 'CUSTOM',
                layoutVariant: 'CUSTOM',
                enabled: false,
                position: 0,
                targetType: 'NONE',
                translations: [],
                items: [],
            });
        block.settings = {
            ...block.settings,
            ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
            ...(input.desktopLayout !== undefined ? { desktopLayout: input.desktopLayout } : {}),
        };
        // Keep revisions strictly increasing even for two saves in the same millisecond.
        block.updatedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1));
        const saved = await repository.save(block);
        await this.eventBus.publish(new StorefrontContentChangedEvent(ctx, [saved.id]));
        return this.config(ctx, saved);
    }

    private config(ctx: RequestContext, block: StorefrontContentBlock | null): StorefrontVisualPresetConfig {
        return {
            channelId: String(ctx.channelId),
            presetId: normalizeStorefrontVisualPreset(block?.settings?.presetId),
            desktopLayout: normalizeStorefrontDesktopLayout(block?.settings?.desktopLayout),
            revision: block ? `${String(block.id)}:${block.updatedAt.toISOString()}` : 'default',
        };
    }
}
