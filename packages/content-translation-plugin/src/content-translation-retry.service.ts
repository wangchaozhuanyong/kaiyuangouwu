import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { In, IsNull, LessThanOrEqual, MoreThan } from 'typeorm';

import {
    ContentTranslationService,
    contentTranslationInternals,
    isUsableEnglishTranslation,
} from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationProviderState } from './entities/translation-provider-state.entity.js';
import {
    TranslationContentAdapter,
    TranslationDependencyPending,
    TranslationFieldSnapshot,
} from './translation-content-adapter.js';
import { translationBackoff } from './translation-execution.service.js';
import { TranslationProviderError } from './translation-provider-error.js';

interface ClaimedField {
    state: ContentTranslationState;
    snapshot: TranslationFieldSnapshot;
}

/** Durable outbox consumer. No business transaction stays open during a network request. */
@Injectable()
export class ContentTranslationRetryService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly translations: ContentTranslationService,
        private readonly adapter: TranslationContentAdapter = new TranslationContentAdapter(connection),
    ) {}

    async retryPending() {
        const repository = this.connection.rawConnection.getRepository(ContentTranslationState);
        const now = new Date(Date.now());
        const due = [IsNull(), LessThanOrEqual(now)].flatMap(nextAttemptAt =>
            [IsNull(), LessThanOrEqual(now)].map(leaseUntil => ({
                status: In(['PENDING', 'TRANSLATING', 'NOTIFY_PENDING']),
                origin: 'AUTO' as const,
                locked: false,
                nextAttemptAt,
                leaseUntil,
            })),
        );
        const pending = await repository.find({
            where: due,
            order: { nextAttemptAt: 'ASC', id: 'ASC' },
            take: 100,
        });
        const result = { scanned: 0, translated: 0, deferred: 0 };
        const batches: ClaimedField[][] = [];
        const deadline = Date.now() + 40_000;
        for (const row of pending) {
            if (Date.now() >= deadline) break;
            const token = randomUUID();
            const claimed = await repository.update(
                due.map(condition => ({
                    ...condition,
                    id: row.id,
                    revision: row.revision,
                    status: row.status,
                })),
                {
                    leaseToken: token,
                    leaseUntil: new Date(Date.now() + 60_000),
                    status: row.status === 'NOTIFY_PENDING' ? row.status : 'TRANSLATING',
                },
            );
            if (!claimed.affected) continue;
            const state = { ...row, leaseToken: token } as ContentTranslationState;
            result.scanned++;
            try {
                if (row.status === 'NOTIFY_PENDING') {
                    await this.finishNotification(state);
                    result.translated++;
                    continue;
                }
                const snapshot = await this.adapter.load(this.connection.rawConnection.manager, state);
                if (!snapshot) {
                    await repository.update(this.criteria(state), {
                        status: 'CANCELLED',
                        leaseToken: null,
                        leaseUntil: null,
                        nextAttemptAt: null,
                        error: '源内容已删除或不属于此店铺',
                        lastErrorCode: 'SOURCE_UNAVAILABLE',
                    });
                    result.deferred++;
                    continue;
                }
                if (
                    snapshot.reusableTarget &&
                    contentTranslationInternals.hash(snapshot.source) === row.sourceHash
                ) {
                    if (await this.apply({ state, snapshot }, snapshot.target)) result.translated++;
                    else result.deferred++;
                    continue;
                }
                if (
                    contentTranslationInternals.hash(snapshot.source) !== row.sourceHash ||
                    contentTranslationInternals.hash(snapshot.target) !== row.translatedHash
                ) {
                    await repository.update(this.criteria(state), {
                        status: 'FAILED',
                        leaseToken: null,
                        leaseUntil: null,
                        nextAttemptAt: null,
                        lastErrorCode: 'CONTENT_CHANGED',
                        error: '源内容或英文已变更，请重新保存后补译',
                    });
                    result.deferred++;
                    continue;
                }
                if (snapshot.derivedTarget != null || !snapshot.source.trim()) {
                    if (await this.apply({ state, snapshot }, snapshot.derivedTarget ?? ''))
                        result.translated++;
                    else result.deferred++;
                    continue;
                }
                // Batch only compatible formats. Keep oversized single fields isolated so other content progresses.
                const batch = batches.find(
                    items =>
                        items[0].snapshot.format === snapshot.format &&
                        items.length < 50 &&
                        items.reduce((sum, item) => sum + [...item.snapshot.source].length, 0) +
                            [...snapshot.source].length <=
                            5000,
                );
                if (batch) batch.push({ state, snapshot });
                else batches.push([{ state, snapshot }]);
            } catch (error) {
                await this.defer(state, error);
                result.deferred++;
            }
        }
        let providerStopped = false;
        for (const batch of batches) {
            if (Date.now() >= deadline || providerStopped) {
                for (const item of batch)
                    await this.defer(item.state, new TranslationProviderError('BUSY', 60_000));
                result.deferred += batch.length;
                continue;
            }
            try {
                // Repeated text in this batch shares a single provider segment, never a cross-shop text cache.
                const unique = new Map<string, string>();
                for (const item of batch)
                    if (!unique.has(item.snapshot.source))
                        unique.set(item.snapshot.source, String(item.state.id));
                const response = await this.translations.translate({
                    segments: [...unique].map(([text, key]) => ({
                        key,
                        text,
                        format: batch[0].snapshot.format,
                    })),
                });
                for (const item of batch) {
                    try {
                        const translated = response.translations.find(
                            value => value.key === unique.get(item.snapshot.source),
                        )?.text;
                        if (!isUsableEnglishTranslation(translated))
                            throw new TranslationProviderError('INVALID_RESPONSE');
                        if (
                            item.snapshot.maxTargetLength &&
                            translated.trim().length > item.snapshot.maxTargetLength
                        )
                            throw new TranslationProviderError('TEXT_TOO_LONG');
                        if (await this.apply(item, translated.trim())) result.translated++;
                        else result.deferred++;
                    } catch (error) {
                        await this.defer(item.state, error);
                        result.deferred++;
                    }
                }
            } catch (error) {
                for (const item of batch) await this.defer(item.state, error);
                result.deferred += batch.length;
                providerStopped =
                    !(error instanceof TranslationProviderError) ||
                    ['RATE_LIMIT', 'QUOTA', 'UNAVAILABLE', 'CONFIGURATION', 'BUSY'].includes(error.code);
            }
        }
        return result;
    }

    async requestRetry(ctx: RequestContext, ids: string[]) {
        if (!ids.length || ids.length > 100) throw new UserInputError('请选择 1 至 100 个翻译字段');
        return this.connection.withTransaction(ctx, async txCtx => {
            const repository = this.connection.getRepository(txCtx, ContentTranslationState);
            const states = await repository.find({
                where: [
                    { id: In(ids), channelId: String(ctx.channelId), locked: false, origin: 'AUTO' },
                    { id: In(ids), channelId: IsNull(), locked: false, origin: 'AUTO' },
                ],
            });
            if (states.length !== new Set(ids).size)
                throw new UserInputError('翻译字段不存在、不属于此店铺或已人工锁定');
            let queued = 0;
            for (const state of states) {
                if (!['FAILED', 'PENDING', 'NOTIFY_PENDING'].includes(state.status)) continue;
                const snapshot = await this.adapter.load(repository.manager, state).catch(() => undefined);
                if (!snapshot) continue;
                const updated = await repository.update(
                    { id: state.id, revision: state.revision },
                    {
                        revision: state.revision + 1,
                        sourceHash: contentTranslationInternals.hash(snapshot.source),
                        translatedHash: contentTranslationInternals.hash(snapshot.target),
                        status: state.status === 'NOTIFY_PENDING' ? 'NOTIFY_PENDING' : 'PENDING',
                        attempts: 0,
                        nextAttemptAt: new Date(Date.now()),
                        leaseToken: null,
                        leaseUntil: null,
                        error: null,
                        lastErrorCode: null,
                    },
                );
                queued += updated.affected ?? 0;
            }
            return { queued };
        });
    }

    private criteria(state: ContentTranslationState) {
        return {
            id: state.id,
            revision: state.revision,
            leaseToken: state.leaseToken ?? '',
            leaseUntil: MoreThan(new Date(Date.now())),
        };
    }

    private async apply(item: ClaimedField, translated: string) {
        const { state, snapshot } = item;
        const applied = await this.connection.rawConnection.transaction(async manager => {
            const current = await this.adapter.load(manager, state, true);
            const states = manager.getRepository(ContentTranslationState);
            const currentState = await states.findOne({ where: this.criteria(state) });
            if (
                !current ||
                !currentState ||
                currentState.locked ||
                currentState.origin !== 'AUTO' ||
                currentState.status !== 'TRANSLATING' ||
                current.source !== snapshot.source ||
                current.target !== snapshot.target
            )
                return false;
            // Fence the state before updating its business row; this locks the state against a concurrent editor.
            const changed = await states.update(this.criteria(state), {
                status: 'NOTIFY_PENDING',
                translatedHash: contentTranslationInternals.hash(translated),
                error: null,
                lastErrorCode: null,
            });
            if (!changed.affected) return false;
            await current.save(translated);
            const notifications = manager.getRepository(TranslationProviderState);
            const provider = this.translations.providerName();
            await notifications.createQueryBuilder().insert().values({ provider }).orIgnore().execute();
            await notifications.increment({ provider }, 'notificationVersion', 1);
            return true;
        });
        if (!applied) return false;
        await this.finishNotification(state);
        return true;
    }

    private async finishNotification(state: ContentTranslationState) {
        const repository = this.connection.rawConnection.getRepository(ContentTranslationState);
        const current = await repository.findOne({
            where: { ...this.criteria(state), status: 'NOTIFY_PENDING' },
        });
        if (!current) return;
        try {
            const snapshot = await this.adapter.load(this.connection.rawConnection.manager, current);
            if (
                !snapshot ||
                contentTranslationInternals.hash(snapshot.source) !== current.sourceHash ||
                contentTranslationInternals.hash(snapshot.target) !== current.translatedHash
            ) {
                await repository.update(this.criteria(state), {
                    status: snapshot ? 'FAILED' : 'CANCELLED',
                    leaseToken: null,
                    leaseUntil: null,
                    nextAttemptAt: null,
                    lastErrorCode: snapshot ? 'CONTENT_CHANGED' : 'SOURCE_UNAVAILABLE',
                    error: snapshot ? '内容已变更，请检查后重新登记' : '源内容已删除或不属于此店铺',
                });
                return;
            }
            await this.adapter.notify(current);
            await repository.update(this.criteria(state), {
                status: 'AUTO_TRANSLATED',
                attempts: 0,
                nextAttemptAt: null,
                leaseToken: null,
                leaseUntil: null,
                error: null,
                lastErrorCode: null,
            });
        } catch (error) {
            if (error instanceof TranslationProviderError && error.code === 'MANUAL_REVIEW') {
                await repository.update(this.criteria(state), {
                    status: 'CANCELLED',
                    leaseToken: null,
                    leaseUntil: null,
                    nextAttemptAt: null,
                    lastErrorCode: 'MANUAL_REVIEW',
                    error: '英文已由管理员审核，旧通知已取消',
                });
                return;
            }
            await repository.update(this.criteria(state), {
                status: 'NOTIFY_PENDING',
                attempts: current.attempts + 1,
                nextAttemptAt: new Date(Date.now() + translationBackoff(current.attempts + 1)),
                leaseToken: null,
                leaseUntil: null,
                lastErrorCode: 'NOTIFICATION_FAILED',
                error: '英文已保存，等待刷新搜索与前台缓存',
            });
        }
    }

    private async defer(state: ContentTranslationState, error: unknown) {
        const failure = error instanceof TranslationProviderError ? error : undefined;
        const dependency = error instanceof TranslationDependencyPending;
        const permanent =
            failure &&
            [
                'MANUAL_REVIEW',
                'CONFIGURATION',
                'TEXT_TOO_LONG',
                'INVALID_CONTENT',
                'INVALID_RESPONSE',
            ].includes(failure.code);
        const attempts = state.attempts + (failure?.code === 'BUSY' || dependency ? 0 : 1);
        await this.connection.rawConnection
            .getRepository(ContentTranslationState)
            .update(this.criteria(state), {
                status: permanent ? 'FAILED' : 'PENDING',
                attempts,
                nextAttemptAt: permanent
                    ? null
                    : new Date(
                          Date.now() + Math.max(translationBackoff(attempts), failure?.retryAfterMs ?? 0),
                      ),
                leaseToken: null,
                leaseUntil: null,
                lastErrorCode: dependency ? 'DEPENDENCY_PENDING' : (failure?.code ?? 'WORKER_ERROR'),
                error: dependency
                    ? '等待名称翻译后生成英文链接'
                    : (failure?.message ?? '补译暂时失败，系统将自动重试'),
            });
    }
}
