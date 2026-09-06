import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { EntityMetadata, ObjectLiteral } from 'typeorm';

import { ContentTranslationService } from './content-translation.service.js';
import { customerFacingContentRegistry } from './customer-facing-content-registry.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import {
    NativeContentBackfillResult,
    NativeContentTranslationService,
} from './native-content-translation.service.js';
import { TranslationContentAdapter } from './translation-content-adapter.js';
import { LocalizedContentFieldInput } from './types.js';

/** Bounded, restartable discovery. Scanning only registers work in the business transaction. */
@Injectable()
export class ContentTranslationBackfillService {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly native: NativeContentTranslationService,
        private readonly translations: ContentTranslationService,
        private readonly adapter: TranslationContentAdapter,
    ) {}

    async backfill(
        ctx: RequestContext,
        entityType?: string | null,
        limit = 100,
        offset = 0,
    ): Promise<NativeContentBackfillResult> {
        if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) {
            throw new UserInputError('补译每页须为 1 至 500 条，偏移量须为非负整数');
        }
        const entries = Object.entries(customerFacingContentRegistry).flatMap(([name, definition]) => {
            const metadata = this.connection.rawConnection.entityMetadatas.find(item => item.name === name);
            return metadata && (!entityType || name === entityType) ? [{ name, definition, metadata }] : [];
        });
        if (entityType && !entries.length) throw new UserInputError('此内容类型未启用或不支持补译');
        const counts = await Promise.all(
            entries.map(({ metadata }) =>
                this.connection
                    .getRepository(ctx, metadata.target)
                    .count({ where: this.adapter.scopeWhere(metadata, ctx.channelId) }),
            ),
        );
        const total = counts.reduce((sum, count) => sum + count, 0);
        const result: NativeContentBackfillResult = {
            total,
            scanned: 0,
            processed: 0,
            queued: 0,
            skipped: 0,
            failed: 0,
            nextOffset: Math.min(offset, total),
            hasMore: false,
            errors: [],
            skippedRecords: [],
        };
        let skip = offset;
        for (let i = 0; i < entries.length && result.scanned < limit; i++) {
            if (skip >= counts[i]) {
                skip -= counts[i];
                continue;
            }
            const { name, metadata, definition } = entries[i];
            const take = limit - result.scanned;
            if (definition.storage === 'VENDURE_TRANSLATIONS') {
                const page = await this.native.backfill(ctx, name, take, skip);
                for (const key of ['scanned', 'processed', 'queued', 'skipped', 'failed'] as const)
                    result[key] += page[key];
                result.errors.push(...page.errors);
                result.skippedRecords.push(...page.skippedRecords);
            } else {
                const rows = await this.connection.getRepository(ctx, metadata.target).find({
                    where: this.adapter.scopeWhere(metadata, ctx.channelId),
                    order: { id: 'ASC' },
                    take,
                    skip,
                });
                for (const row of rows) {
                    result.scanned++;
                    try {
                        const status = await this.connection.withTransaction(ctx, tx =>
                            this.enqueueCustom(tx, metadata, row),
                        );
                        result[status]++;
                    } catch {
                        result.failed++;
                        result.errors.push(`${name}#${row.id}: 登记失败，请检查该记录的数据格式`);
                    }
                }
            }
            skip = 0;
        }
        result.errors = result.errors.slice(0, 50);
        result.skippedRecords = result.skippedRecords.slice(0, 50);
        result.nextOffset = Math.min(offset + result.scanned, total);
        result.hasMore = result.nextOffset < total;
        return result;
    }

    private async enqueueCustom(
        ctx: RequestContext,
        metadata: EntityMetadata,
        row: ObjectLiteral,
    ): Promise<'queued' | 'processed' | 'skipped'> {
        const manager = this.connection.getRepository(ctx, metadata.target).manager;
        // Reload under the same entity lock used by worker writeback before registering snapshots.
        const identity = {
            entityType: metadata.name,
            entityId: String(row.id),
            channelId: metadata.name === 'SystemAnnouncement' ? null : String(ctx.channelId),
        };
        const relation = metadata.relations.find(item => item.propertyName === 'translations');
        const definition =
            customerFacingContentRegistry[metadata.name as keyof typeof customerFacingContentRegistry];
        if (relation) {
            const repository = manager.getRepository(relation.inverseEntityMetadata.target);
            const source = await repository.findOne({
                where: { base: { id: row.id }, languageCode: 'zh_Hans' },
            });
            if (!source) return 'skipped';
            if (!(await repository.findOne({ where: { base: { id: row.id }, languageCode: 'en' } }))) {
                await repository.save(
                    repository.create({
                        languageCode: 'en',
                        base: { id: row.id },
                        ...Object.fromEntries(definition.fields.map(field => [field.path, ''])),
                    }),
                );
            }
        }
        const current = await manager.getRepository(metadata.target).findOneByOrFail({ id: row.id });
        const paths: string[] = definition.fields.map(field => field.path);
        if (metadata.name === 'AutoCardConfig') {
            paths.splice(
                paths.indexOf('fieldLabels'),
                1,
                ...JSON.parse(current.fieldsJson).map(
                    (field: { key: string }) => `fields.${field.key}.label`,
                ),
            );
        }
        const fields: LocalizedContentFieldInput[] = [];
        for (const fieldPath of paths) {
            const snapshot = await this.adapter.load(
                manager,
                { ...identity, fieldPath } as ContentTranslationState,
                true,
            );
            if (!snapshot) continue;
            fields.push({
                path: fieldPath,
                sourceText: snapshot.source,
                existingTargetText: snapshot.target,
                existingSourceText: snapshot.source,
                format: snapshot.format,
            });
        }
        if (!fields.length) return 'skipped';
        const existing = await this.translations.findStates(ctx, identity);
        const prepared = await this.translations.prepareLocalizedFields(
            fields.map(field => {
                const state = existing.find(item => item.fieldPath === field.path);
                return state && !state.locked && ['MISSING', 'STALE'].includes(state.status)
                    ? { ...field, manualLock: false }
                    : field;
            }),
        );
        // History scanning must not reset retries, leases or an existing review decision.
        const missing = prepared
            .filter(field => {
                const state = existing.find(item => item.fieldPath === field.path);
                return !state || (!state.locked && ['MISSING', 'STALE'].includes(state.status));
            })
            .map(field =>
                field.status === 'PENDING'
                    ? {
                          ...field,
                          translatedText:
                              fields.find(item => item.path === field.path)?.existingTargetText ?? '',
                      }
                    : field,
            );
        for (const field of missing) {
            await this.translations.recordState(ctx, {
                ...identity,
                fieldPath: field.path,
                sourceText: fields.find(item => item.path === field.path)?.sourceText ?? field.sourceText,
                translatedText: field.translatedText,
                status: field.status,
                origin: field.origin,
                locked: field.locked,
            });
        }
        const states = await this.translations.findStates(ctx, identity);
        return states.some(state => ['PENDING', 'TRANSLATING', 'NOTIFY_PENDING'].includes(state.status))
            ? 'queued'
            : 'processed';
    }
}
