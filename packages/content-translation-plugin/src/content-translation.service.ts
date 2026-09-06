import { Inject, Injectable } from '@nestjs/common';
import { containsHanContent, isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';
import { RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { createHash } from 'node:crypto';
import { In, IsNull } from 'typeorm';

export { containsHanContent, isUsableEnglishTranslation } from '@vendure/common/lib/translation-validation';

import { CONTENT_TRANSLATION_OPTIONS } from './constants.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationProviderError } from './translation-provider-error.js';
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
                    reusedTranslation: true,
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
                    reusedTranslation: true,
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
            try {
                if (!this.isConfigured()) throw new TranslationProviderError('CONFIGURATION');
                const result = await this.translate({ segments });
                if (
                    segments.some(
                        segment =>
                            !isUsableEnglishTranslation(
                                result.translations.find(item => item.key === segment.key)?.text,
                            ),
                    )
                ) {
                    throw new TranslationProviderError('INVALID_RESPONSE');
                }
                for (const item of result.translations) {
                    const source = fields.find(field => field.path === item.key);
                    if (!source) continue;
                    if (source.maxTargetLength && item.text.trim().length > source.maxTargetLength) {
                        prepared.set(item.key, {
                            path: item.key,
                            sourceText: source.sourceText.trim(),
                            translatedText: isUsableEnglishTranslation(source.existingTargetText)
                                ? source.existingTargetText.trim()
                                : '',
                            status: 'PENDING',
                            origin: 'AUTO',
                            locked: false,
                            error: new TranslationProviderError('TEXT_TOO_LONG').message,
                        });
                        continue;
                    }
                    prepared.set(item.key, {
                        path: item.key,
                        sourceText: source.sourceText.trim(),
                        translatedText: item.text.trim(),
                        status: 'AUTO_TRANSLATED',
                        origin: 'AUTO',
                        locked: false,
                    });
                }
            } catch (error) {
                if (!(error instanceof TranslationProviderError)) throw error;
                for (const segment of segments) {
                    const source = fields.find(field => field.path === segment.key);
                    if (!source) throw new Error('Missing source field');
                    prepared.set(segment.key, {
                        path: segment.key,
                        sourceText: segment.text,
                        translatedText: isUsableEnglishTranslation(source.existingTargetText)
                            ? source.existingTargetText.trim()
                            : '',
                        status: 'PENDING',
                        origin: 'AUTO',
                        locked: false,
                        error: error.message,
                    });
                }
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
            // Reusing unchanged English must not turn a failed automatic translation into a manual lock.
            const existing = field.reusedTranslation
                ? await this.connection
                      .getRepository(ctx, ContentTranslationState)
                      .findOne({ where: { stateKey: this.stateKey({ ...identity, fieldPath: field.path }) } })
                : undefined;
            const reuseState =
                existing &&
                existing.sourceHash === hash(field.sourceText) &&
                existing.translatedHash === hash(field.translatedText);
            await this.recordState(ctx, {
                ...identity,
                fieldPath: field.path,
                sourceText: field.sourceText,
                translatedText: field.translatedText,
                status: reuseState ? existing.status : field.status,
                origin: reuseState ? existing.origin : field.origin,
                locked: reuseState ? existing.locked : field.locked,
                error: reuseState ? existing.error : field.error,
            });
        }
    }

    async prepareLocalizedColumns(
        paths: readonly string[],
        input: object,
        existing?: object,
        limits: Record<string, number> = {},
        ctx?: RequestContext,
    ) {
        const submitted = input as Record<string, unknown>;
        const previous = (existing ?? {}) as Record<string, unknown>;
        const metadata = this.connection.rawConnection?.entityMetadatas?.find(
            entity => entity.name === existing?.constructor.name,
        );
        const states =
            ctx && metadata && (typeof previous.id === 'string' || typeof previous.id === 'number')
                ? await this.findStates(ctx, {
                      entityType: metadata.name,
                      entityId: String(previous.id),
                      channelId: ctx.channelId,
                  })
                : [];
        const prepared = await this.prepareLocalizedFields(
            paths.map(path => ({
                path,
                maxTargetLength:
                    limits[path] ||
                    Number(metadata?.findColumnWithPropertyName(`${path}En`)?.length) ||
                    undefined,
                sourceText: optionalLocalizedText(submitted[`${path}Zh`] ?? previous[`${path}Zh`]) ?? '',
                targetText:
                    submitted[`${path}En`] == null
                        ? previous[`${path}En`] == null
                            ? undefined
                            : optionalLocalizedText(previous[`${path}En`])
                        : optionalLocalizedText(submitted[`${path}En`]),
                // Clearing an optional English override returns this field to automatic translation.
                manualLock:
                    submitted[`${path}En`] === ''
                        ? false
                        : states.find(state => state.fieldPath === path)?.locked
                          ? true
                          : undefined,
                existingSourceText:
                    previous[`${path}Zh`] == null ? undefined : optionalLocalizedText(previous[`${path}Zh`]),
                existingTargetText:
                    previous[`${path}En`] == null ? undefined : optionalLocalizedText(previous[`${path}En`]),
            })),
        );
        return {
            prepared,
            values: Object.fromEntries(prepared.map(field => [`${field.path}En`, field.translatedText])),
        };
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
                {
                    channelId: String(ctx.channelId),
                    status: In(['STALE', 'PENDING', 'TRANSLATING', 'FAILED']),
                },
                { channelId: IsNull(), status: In(['STALE', 'PENDING', 'TRANSLATING', 'FAILED']) },
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
                order: { updatedAt: 'DESC', id: 'DESC' },
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

function optionalLocalizedText(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value !== 'string') throw new UserInputError('本地化文案必须是文本');
    return value;
}
