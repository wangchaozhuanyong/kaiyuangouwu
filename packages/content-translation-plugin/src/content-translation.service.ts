import { Inject, Injectable } from '@nestjs/common';
import { containsHanContent } from '@vendure/common/lib/translation-validation';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHash } from 'node:crypto';
import { IsNull } from 'typeorm';
export { containsHanContent, isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';

import { CONTENT_TRANSLATION_OPTIONS } from './constants.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import {
    ContentTranslationPluginOptions,
    ContentTranslationRequest,
    ContentTranslationResult,
    LocalizedContentFieldInput,
    PreparedLocalizedContentField,
    RecordTranslationStateInput,
    TranslationStateIdentity,
} from './types.js';

@Injectable()
export class ContentTranslationService {
    constructor(
        private readonly connection: TransactionalConnection,
        @Inject(CONTENT_TRANSLATION_OPTIONS)
        private readonly options: Required<ContentTranslationPluginOptions>,
    ) {}

    isConfigured(): boolean {
        return this.options.provider.isConfigured();
    }

    providerName(): string {
        return this.options.provider.name;
    }

    async prepareLocalizedFields(
        fields: LocalizedContentFieldInput[],
    ): Promise<PreparedLocalizedContentField[]> {
        const prepared = new Map<string, PreparedLocalizedContentField>();
        const segments = [] as Array<{ key: string; text: string; format: 'TEXT' | 'HTML' }>;
        for (const field of fields) {
            const sourceText = field.sourceText.trim();
            if (field.required && !sourceText) {
                throw new UserInputError(`Required Simplified Chinese field "${field.path}" is empty`);
            }
            const normalizedTarget = field.targetText?.trim() ?? '';
            const normalizedExistingTarget = field.existingTargetText?.trim() ?? '';
            const sourceUnchanged =
                field.existingSourceText != null && field.existingSourceText.trim() === sourceText;
            const targetUnchanged =
                field.existingTargetText != null && normalizedTarget === normalizedExistingTarget;
            if (field.manualLock === true) {
                if (!normalizedTarget || containsHanContent(normalizedTarget)) {
                    throw new UserInputError(`字段“${field.path}”启用人工锁定时，必须填写不含中文的英文内容`);
                }
                prepared.set(field.path, {
                    path: field.path,
                    sourceText,
                    translatedText: normalizedTarget,
                    status: !sourceUnchanged && targetUnchanged ? 'STALE' : 'MANUAL_LOCKED',
                    origin: 'MANUAL',
                    locked: true,
                });
                continue;
            }
            if (
                field.manualLock === false &&
                field.existingLocked === false &&
                sourceUnchanged &&
                targetUnchanged &&
                normalizedExistingTarget &&
                !containsHanContent(normalizedExistingTarget)
            ) {
                prepared.set(field.path, {
                    path: field.path,
                    sourceText,
                    translatedText: normalizedExistingTarget,
                    status: 'AUTO_TRANSLATED',
                    origin: 'AUTO',
                    locked: false,
                });
                continue;
            }
            const hasManualTarget =
                field.manualLock == null &&
                normalizedTarget.length > 0 &&
                !containsHanContent(normalizedTarget) &&
                (field.existingTargetText == null || normalizedTarget !== normalizedExistingTarget);
            if (hasManualTarget) {
                prepared.set(field.path, {
                    path: field.path,
                    sourceText,
                    translatedText: normalizedTarget,
                    status: 'MANUAL_LOCKED',
                    origin: 'MANUAL',
                    locked: true,
                });
                continue;
            }
            if (
                field.manualLock == null &&
                sourceUnchanged &&
                field.existingTargetText?.trim() &&
                !containsHanContent(field.existingTargetText)
            ) {
                prepared.set(field.path, {
                    path: field.path,
                    sourceText,
                    translatedText: field.existingTargetText.trim(),
                    status: 'MANUAL_LOCKED',
                    origin: 'MANUAL',
                    locked: true,
                });
                continue;
            }
            if (!sourceText) {
                prepared.set(field.path, {
                    path: field.path,
                    sourceText: '',
                    translatedText: '',
                    status: 'AUTO_TRANSLATED',
                    origin: 'AUTO',
                    locked: false,
                });
                continue;
            }
            segments.push({ key: field.path, text: sourceText, format: field.format ?? 'TEXT' });
        }
        if (segments.length) {
            if (!this.isConfigured()) {
                throw new UserInputError(
                    'English content could not be generated because the translation provider is not configured',
                );
            }
            const result = await this.translate({ segments });
            for (const item of result.translations) {
                const source = fields.find(field => field.path === item.key);
                if (!source) continue;
                prepared.set(item.key, {
                    path: item.key,
                    sourceText: source.sourceText.trim(),
                    translatedText: item.text.trim(),
                    status: 'AUTO_TRANSLATED',
                    origin: 'AUTO',
                    locked: false,
                });
            }
        }
        return fields.map(field => {
            const value = prepared.get(field.path);
            if (!value) throw new UserInputError(`Translation result is missing field "${field.path}"`);
            return value;
        });
    }

    async recordPreparedFields(
        ctx: RequestContext,
        identity: Omit<TranslationStateIdentity, 'fieldPath'>,
        fields: PreparedLocalizedContentField[],
    ): Promise<void> {
        for (const field of fields) {
            await this.recordState(ctx, {
                ...identity,
                fieldPath: field.path,
                sourceText: field.sourceText,
                translatedText: field.translatedText,
                status: field.status,
                origin: field.origin,
                locked: field.locked,
            });
        }
    }

    async translate(
        request: Omit<ContentTranslationRequest, 'sourceLanguageCode' | 'targetLanguageCode' | 'glossary'>,
    ): Promise<ContentTranslationResult> {
        return this.options.provider.translate({
            sourceLanguageCode: this.options.sourceLanguageCode,
            targetLanguageCode: this.options.targetLanguageCode,
            glossary: this.options.glossary,
            ...request,
        });
    }

    async recordState(
        ctx: RequestContext,
        input: RecordTranslationStateInput,
    ): Promise<ContentTranslationState> {
        const repository = this.connection.getRepository(ctx, ContentTranslationState);
        const stateKey = this.stateKey(input);
        const existing = await repository.findOne({ where: { stateKey } });
        return repository.save(
            new ContentTranslationState({
                ...existing,
                stateKey,
                channelId: input.channelId == null ? null : String(input.channelId),
                entityType: input.entityType,
                entityId: String(input.entityId),
                fieldPath: input.fieldPath,
                sourceLanguageCode: this.options.sourceLanguageCode,
                targetLanguageCode: input.targetLanguageCode ?? this.options.targetLanguageCode,
                sourceHash: hash(input.sourceText),
                translatedHash: input.translatedText == null ? null : hash(input.translatedText),
                status: input.status,
                origin: input.origin ?? 'AUTO',
                locked: input.locked ?? existing?.locked ?? false,
                error: input.error ?? null,
            }),
        );
    }

    async findStates(ctx: RequestContext, identity: Omit<TranslationStateIdentity, 'fieldPath'>) {
        return this.connection.getRepository(ctx, ContentTranslationState).find({
            where: {
                channelId: identity.channelId == null ? IsNull() : String(identity.channelId),
                entityType: identity.entityType,
                entityId: String(identity.entityId),
                targetLanguageCode: identity.targetLanguageCode ?? this.options.targetLanguageCode,
            },
            order: { fieldPath: 'ASC' },
        });
    }

    async countStale(ctx: RequestContext): Promise<number> {
        return this.connection.getRepository(ctx, ContentTranslationState).count({
            where: [
                { channelId: String(ctx.channelId), status: 'STALE' },
                { channelId: IsNull(), status: 'STALE' },
            ],
        });
    }

    async audit(ctx: RequestContext, channelId?: string | number | null) {
        const repository = this.connection.getRepository(ctx, ContentTranslationState);
        const where =
            channelId === undefined
                ? undefined
                : channelId === null
                  ? { channelId: IsNull() }
                  : [{ channelId: String(channelId) }, { channelId: IsNull() }];
        const [states, allStatuses] = await Promise.all([
            repository.find({
                ...(where ? { where } : {}),
                order: { updatedAt: 'DESC' },
                take: 1_000,
            }),
            repository.find({
                ...(where ? { where } : {}),
                select: { status: true },
            }),
        ]);
        const counts = new Map<ContentTranslationState['status'], number>();
        for (const state of allStatuses) {
            counts.set(state.status, (counts.get(state.status) ?? 0) + 1);
        }
        return {
            configured: this.isConfigured(),
            provider: this.providerName(),
            total: allStatuses.length,
            counts: [...counts.entries()].map(([status, count]) => ({ status, count })),
            states,
        };
    }

    private stateKey(identity: TranslationStateIdentity): string {
        return hash(
            [
                identity.channelId == null ? 'global' : String(identity.channelId),
                identity.entityType,
                String(identity.entityId),
                identity.fieldPath,
                identity.targetLanguageCode ?? this.options.targetLanguageCode,
            ].join(':'),
        );
    }
}

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export const contentTranslationInternals = { hash, containsHanContent };
