import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { In, IsNull } from 'typeorm';

import {
    ContentTranslationService,
    contentTranslationInternals,
    isUsableEnglishTranslation,
} from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationContentAdapter, TranslationFieldSnapshot } from './translation-content-adapter.js';
import { TranslationProviderError } from './translation-provider-error.js';

export interface RecoverCustomerContentTranslationInput {
    id: string;
    revision: number;
    sourceHash: string;
    translatedHash: string | null;
}

export interface ContentTranslationRecoveryRecord extends RecoverCustomerContentTranslationInput {
    entityId: string;
    fieldPath: string;
    eligible: boolean;
    reason: string;
}

/** Explicit, bounded recovery for the historical global-announcement ownership defect. */
@Injectable()
export class ContentTranslationRecoveryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly adapter: TranslationContentAdapter,
        private readonly translations: ContentTranslationService,
    ) {}

    async preview(ctx: RequestContext, limit = 100, offset = 0) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0)
            throw new UserInputError('恢复预览每页须为 1 至 100 条，偏移量须为非负整数');
        const metadata = this.connection.rawConnection.entityMetadatas.find(
            entity => entity.name === 'SystemAnnouncement',
        );
        if (!metadata) return { total: 0, records: [] as ContentTranslationRecoveryRecord[] };
        // Discover IDs inside this Channel before reading cancellation records. Other stores' targeted
        // announcements must not leak into the candidate list or its total.
        const announcements = await this.connection.getRepository(ctx, metadata.target).find({
            where: this.adapter.scopeWhere(metadata, ctx.channelId),
            select: { id: true },
        });
        if (!announcements.length) return { total: 0, records: [] as ContentTranslationRecoveryRecord[] };
        const repository = this.connection.getRepository(ctx, ContentTranslationState);
        const where = {
            ...this.candidateWhere(),
            entityId: In(announcements.map(entity => String(entity.id))),
        };
        const total = await repository.count({ where });
        const states = await repository.find({ where, order: { id: 'ASC' }, take: limit, skip: offset });
        const records: ContentTranslationRecoveryRecord[] = [];
        for (const state of states) {
            const checked = await this.checkSnapshot(repository.manager, state, ctx.channelId);
            records.push({
                id: String(state.id),
                entityId: state.entityId,
                fieldPath: state.fieldPath,
                revision: state.revision,
                sourceHash: state.sourceHash,
                translatedHash: state.translatedHash,
                eligible: checked.snapshot != null,
                reason: checked.reason,
            });
        }
        return { total, records };
    }

    async recover(ctx: RequestContext, inputs: RecoverCustomerContentTranslationInput[]) {
        this.validateInputs(inputs);
        const records: Array<{ id: string; reason: string }> = [];
        let queued = 0;
        for (const input of inputs) {
            const result = await this.connection.withTransaction(ctx, async tx => {
                const repository = this.connection.getRepository(tx, ContentTranslationState);
                const initial = await repository.findOne({
                    where: { ...this.candidateWhere(), id: input.id },
                });
                if (!initial) return { queued: false, reason: 'NOT_RECOVERABLE' };
                // Match worker/editor lock order: business entity first, state CAS second.
                const checked = await this.checkSnapshot(repository.manager, initial, ctx.channelId, true);
                if (!checked.snapshot) return { queued: false, reason: checked.reason };
                const current = await repository.findOne({ where: { id: initial.id } });
                if (!current || !this.isCandidate(current) || !this.matchesInput(current, input))
                    return { queued: false, reason: 'STATE_CHANGED' };
                if (!this.matchesSnapshot(current, checked.snapshot))
                    return { queued: false, reason: 'CONTENT_CHANGED' };
                if (current.leaseToken || current.leaseUntil)
                    return { queued: false, reason: 'ACTIVE_LEASE' };
                const targetReady = await this.hasProvenTarget(checked.snapshot);
                const updated = await repository.update(
                    {
                        ...this.candidateWhere(),
                        id: current.id,
                        revision: input.revision,
                        sourceHash: input.sourceHash,
                        translatedHash: input.translatedHash == null ? IsNull() : input.translatedHash,
                        leaseToken: IsNull(),
                        leaseUntil: IsNull(),
                    },
                    {
                        revision: current.revision + 1,
                        translatedHash: contentTranslationInternals.hash(checked.snapshot.target),
                        status: targetReady ? 'NOTIFY_PENDING' : 'PENDING',
                        attempts: 0,
                        nextAttemptAt: new Date(Date.now()),
                        leaseToken: null,
                        leaseUntil: null,
                        error: null,
                        lastErrorCode: null,
                    },
                );
                return updated.affected
                    ? {
                          queued: true,
                          reason: targetReady ? 'QUEUED_FOR_NOTIFICATION' : 'QUEUED_FOR_TRANSLATION',
                      }
                    : { queued: false, reason: 'STATE_CHANGED' };
            });
            if (result.queued) queued++;
            records.push({ id: input.id, reason: result.reason });
        }
        return { queued, skipped: inputs.length - queued, records };
    }

    private candidateWhere() {
        return {
            entityType: 'SystemAnnouncement',
            channelId: IsNull(),
            status: 'CANCELLED' as const,
            lastErrorCode: 'SOURCE_UNAVAILABLE',
            origin: 'AUTO' as const,
            locked: false,
        };
    }

    private isCandidate(state: ContentTranslationState) {
        return (
            state.entityType === 'SystemAnnouncement' &&
            state.channelId == null &&
            state.status === 'CANCELLED' &&
            state.lastErrorCode === 'SOURCE_UNAVAILABLE' &&
            state.origin === 'AUTO' &&
            !state.locked
        );
    }

    private matchesInput(state: ContentTranslationState, input: RecoverCustomerContentTranslationInput) {
        return (
            state.revision === input.revision &&
            state.sourceHash === input.sourceHash &&
            state.translatedHash === input.translatedHash
        );
    }

    private matchesSnapshot(state: ContentTranslationState, snapshot: TranslationFieldSnapshot) {
        return (
            contentTranslationInternals.hash(snapshot.source) === state.sourceHash &&
            (state.translatedHash == null
                ? snapshot.target === ''
                : contentTranslationInternals.hash(snapshot.target) === state.translatedHash)
        );
    }

    private async checkSnapshot(
        manager: Parameters<TranslationContentAdapter['load']>[0],
        state: ContentTranslationState,
        channelId: string | number,
        lock = false,
    ): Promise<{ snapshot?: TranslationFieldSnapshot; reason: string }> {
        try {
            const snapshot = await this.adapter.load(manager, state, lock);
            if (!snapshot) return { reason: 'SOURCE_UNAVAILABLE' };
            if (!(await this.adapter.isVisibleInChannel(manager, state, channelId)))
                return { reason: 'OUT_OF_SCOPE' };
            if (!this.matchesSnapshot(state, snapshot)) return { reason: 'CONTENT_CHANGED' };
            if (state.leaseToken || state.leaseUntil) return { reason: 'ACTIVE_LEASE' };
            return { snapshot, reason: 'READY_TO_RECOVER' };
        } catch (error) {
            if (error instanceof TranslationProviderError)
                return { reason: error.code === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW' : 'SOURCE_UNAVAILABLE' };
            throw error;
        }
    }

    private async hasProvenTarget(snapshot: TranslationFieldSnapshot) {
        if (!snapshot.source.trim() && !snapshot.target) return true;
        if (!isUsableEnglishTranslation(snapshot.target)) return false;
        // CANCELLED no longer tells us whether the preceding state was TRANSLATING or NOTIFY_PENDING.
        // An old English value preserved by PENDING is not proof that the current Chinese was translated.
        // Only an exact current-source cache hit may bypass translation. This method never calls a provider.
        try {
            const cached = await this.translations.cachedTranslations({
                segments: [{ key: 'recovery', text: snapshot.source, format: snapshot.format }],
            });
            return cached.some(item => item.key === 'recovery' && item.text === snapshot.target);
        } catch {
            // A cache outage must not falsely promote an old English value to completed translation.
            return false;
        }
    }

    private validateInputs(inputs: RecoverCustomerContentTranslationInput[]) {
        if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100)
            throw new UserInputError('请选择 1 至 100 个待恢复翻译字段');
        const hash = /^[a-f\d]{64}$/;
        if (
            inputs.some(
                input =>
                    !input ||
                    typeof input.id !== 'string' ||
                    !input.id.trim() ||
                    !Number.isInteger(input.revision) ||
                    input.revision < 1 ||
                    !hash.test(input.sourceHash) ||
                    (input.translatedHash !== null && !hash.test(input.translatedHash)),
            )
        )
            throw new UserInputError('恢复记录的编号、版本或内容指纹不完整，请重新预览');
        if (new Set(inputs.map(input => input.id)).size !== inputs.length)
            throw new UserInputError('请勿重复选择同一翻译字段');
    }
}
