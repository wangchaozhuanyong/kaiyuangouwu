import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { EntityManager, IsNull } from 'typeorm';

import { contentTranslationInternals, isUsableEnglishTranslation } from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationContentAdapter } from './translation-content-adapter.js';

export interface ConfirmCustomerContentTranslationReviewInput {
    id: string;
    revision: number;
    sourceHash: string;
    translatedHash: string;
}

/** Review changes audit state only; text is still authored by its existing business editor. */
@Injectable()
export class ContentTranslationReviewService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly adapter: TranslationContentAdapter,
    ) {}

    private async scopedState(ctx: RequestContext, id: string) {
        const repository = this.connection.getRepository(ctx, ContentTranslationState);
        const state = await repository.findOne({
            where: [
                { id, channelId: String(ctx.channelId) },
                { id, channelId: IsNull() },
            ],
        });
        if (!state || !(await this.adapter.isVisibleInChannel(repository.manager, state, ctx.channelId))) {
            throw new UserInputError('翻译记录不存在或不属于当前店铺');
        }
        return { repository, state };
    }

    async review(ctx: RequestContext, id: string) {
        const { repository, state } = await this.scopedState(ctx, id);
        const snapshot = await this.adapter.load(repository.manager, state);
        if (!snapshot) throw new UserInputError('源内容已删除或暂不可读取，请刷新后重试');
        const sourceHash = contentTranslationInternals.hash(snapshot.source);
        const translatedHash = contentTranslationInternals.hash(snapshot.target);
        const matching = state.sourceHash === sourceHash && state.translatedHash === translatedHash;
        const canConfirm =
            state.status === 'STALE' &&
            state.origin === 'MANUAL' &&
            state.locked &&
            matching &&
            isUsableEnglishTranslation(snapshot.target);
        return {
            state,
            sourceText: snapshot.source,
            targetText: snapshot.target,
            sourceHash,
            translatedHash,
            format: snapshot.format,
            canConfirm,
            reason: !matching
                ? '内容版本已变化，请到原内容编辑页重新核对并保存'
                : canConfirm
                  ? null
                  : state.status === 'STALE'
                    ? '英文不完整或不是人工锁定记录，请到原内容编辑页处理'
                    : '该记录当前无需人工确认',
            editPath: await this.editPath(repository.manager, state),
        };
    }

    async confirm(ctx: RequestContext, input: ConfirmCustomerContentTranslationReviewInput) {
        if (!Number.isInteger(input.revision) || input.revision < 1) {
            throw new UserInputError('无效的复核版本');
        }
        return this.connection.withTransaction(ctx, async tx => {
            const { repository, state } = await this.scopedState(tx, input.id);
            // Business entity first, matching the outbox writeback and ordinary authoring lock order.
            const snapshot = await this.adapter.load(repository.manager, state, true);
            if (!(await this.adapter.isVisibleInChannel(repository.manager, state, ctx.channelId))) {
                throw new UserInputError('内容的店铺范围已变化，请重新查看');
            }
            if (!snapshot || !isUsableEnglishTranslation(snapshot.target)) {
                throw new UserInputError('英文不完整或内容已删除，请重新核对');
            }
            const sourceHash = contentTranslationInternals.hash(snapshot.source);
            const translatedHash = contentTranslationInternals.hash(snapshot.target);
            if (
                state.revision !== input.revision ||
                state.sourceHash !== sourceHash ||
                state.translatedHash !== translatedHash ||
                sourceHash !== input.sourceHash ||
                translatedHash !== input.translatedHash
            ) {
                throw new UserInputError('内容在复核期间已变化，请重新查看后确认');
            }
            if (state.status !== 'STALE' || state.origin !== 'MANUAL' || !state.locked) {
                throw new UserInputError('该字段当前不需要人工复核，请刷新状态');
            }
            const updated = await repository.update(
                {
                    id: state.id,
                    revision: input.revision,
                    status: 'STALE',
                    origin: 'MANUAL',
                    locked: true,
                    sourceHash,
                    translatedHash,
                },
                {
                    status: 'MANUAL_LOCKED',
                    revision: state.revision + 1,
                    attempts: 0,
                    error: null,
                    lastErrorCode: null,
                    leaseToken: null,
                    leaseUntil: null,
                    nextAttemptAt: null,
                },
            );
            if (!updated.affected) throw new UserInputError('复核状态已变化，请刷新后重新查看');
            return repository.findOneOrFail({ where: { id: state.id } });
        });
    }

    private async editPath(manager: EntityManager, state: ContentTranslationState): Promise<string | null> {
        const entityId = encodeURIComponent(String(state.entityId));
        if (state.entityType === 'Product') return `/catalog/products/${entityId}`;
        if (state.entityType === 'SystemAnnouncement') {
            return `/storefront/content?tab=announcements&announcementId=${entityId}`;
        }
        if (
            !['StorefrontContentBlock', 'StorefrontContentItem', 'ProductVariant'].includes(state.entityType)
        ) {
            return null;
        }
        const metadata = manager.connection.entityMetadatas.find(item => item.name === state.entityType);
        if (!metadata) return null;
        const relation = state.entityType === 'ProductVariant' ? 'product' : 'block';
        const entity = await manager.getRepository(metadata.target).findOne({
            where: { id: state.entityId },
            ...(state.entityType === 'StorefrontContentBlock' ? {} : { relations: { [relation]: true } }),
        });
        if (!entity) return null;
        if (state.entityType === 'ProductVariant') {
            return entity.product
                ? `/catalog/products/${encodeURIComponent(String(entity.product.id))}`
                : null;
        }
        const block = state.entityType === 'StorefrontContentItem' ? entity.block : entity;
        if (!block) return null;
        const parameters = new URLSearchParams({
            blockId: String(block.id),
            field: state.fieldPath,
            language: 'en',
            ...(state.entityType === 'StorefrontContentItem' ? { itemId: String(entity.id) } : {}),
        });
        return `/storefront/decoration?${parameters}`;
    }
}
