import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {
    Channel,
    Collection,
    CollectionEvent,
    Country,
    CountryEvent,
    EventBus,
    Facet,
    FacetEvent,
    FacetValue,
    FacetValueEvent,
    ID,
    LanguageCode,
    Logger,
    PaymentMethod,
    PaymentMethodEvent,
    ProcessContext,
    Product,
    ProductEvent,
    ProductOption,
    ProductOptionEvent,
    ProductOptionGroup,
    ProductOptionGroupEvent,
    ProductVariant,
    ProductVariantEvent,
    Promotion,
    PromotionEvent,
    Province,
    ProvinceEvent,
    RequestContext,
    RequestContextService,
    ShippingMethod,
    ShippingMethodEvent,
    TransactionalConnection,
    UserInputError,
    VendureEntity,
} from '@vendure/core';
import { ObjectLiteral, ObjectType, Repository } from 'typeorm';

import { contentTranslationLoggerCtx } from './constants.js';
import { ContentTranslationService, contentTranslationInternals } from './content-translation.service.js';
import { ContentTranslationFormat } from './types.js';

type TranslationField = {
    path: string;
    format?: ContentTranslationFormat;
    required?: boolean;
    deriveFrom?: string;
};

type NativeDefinition = {
    fields: TranslationField[];
};

type NamedEntityClass = ObjectType<ObjectLiteral> & { name: string };

export interface NativeContentBackfillResult {
    total: number;
    scanned: number;
    processed: number;
    failed: number;
    nextOffset: number;
    hasMore: boolean;
    errors: string[];
}

type NativeEntity = VendureEntity & {
    channels?: Channel[];
    enabled?: boolean;
    translations?: ObjectLiteral[];
};
type NativeEvent = {
    type: 'created' | 'updated' | 'deleted';
    ctx: RequestContext;
    entity: NativeEntity | NativeEntity[];
    input?: unknown;
};

const definitions = new Map<NamedEntityClass, NativeDefinition>([
    [
        Product,
        {
            fields: [
                { path: 'name', required: true },
                { path: 'slug', required: true, deriveFrom: 'name' },
                { path: 'description', required: true, format: 'HTML' },
            ],
        },
    ],
    [ProductVariant, { fields: [{ path: 'name', required: true }] }],
    [ProductOptionGroup, { fields: [{ path: 'name', required: true }] }],
    [ProductOption, { fields: [{ path: 'name', required: true }] }],
    [
        Collection,
        {
            fields: [
                { path: 'name', required: true },
                { path: 'slug', required: true, deriveFrom: 'name' },
                { path: 'description', format: 'HTML' },
            ],
        },
    ],
    [Facet, { fields: [{ path: 'name', required: true }] }],
    [FacetValue, { fields: [{ path: 'name', required: true }] }],
    [
        Promotion,
        {
            fields: [{ path: 'name', required: true }, { path: 'description' }],
        },
    ],
    [
        ShippingMethod,
        {
            fields: [{ path: 'name', required: true }, { path: 'description' }],
        },
    ],
    [
        PaymentMethod,
        {
            fields: [{ path: 'name', required: true }, { path: 'description' }],
        },
    ],
    [Country, { fields: [{ path: 'name', required: true }] }],
    [Province, { fields: [{ path: 'name', required: true }] }],
]);

@Injectable()
export class NativeContentTranslationService implements OnApplicationBootstrap {
    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
        private readonly translations: ContentTranslationService,
        private readonly processContext?: ProcessContext,
        private readonly requestContextService?: RequestContextService,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus.registerBlockingEventHandler({
            event: [
                ProductEvent,
                ProductVariantEvent,
                ProductOptionGroupEvent,
                ProductOptionEvent,
                CollectionEvent,
                FacetEvent,
                FacetValueEvent,
                PromotionEvent,
                ShippingMethodEvent,
                PaymentMethodEvent,
                CountryEvent,
                ProvinceEvent,
            ] as any,
            id: 'customer-content-auto-translate',
            handler: (event: any) => this.handle(event as NativeEvent),
        });
        if (this.processContext?.isServer && this.requestContextService && this.translations.isConfigured()) {
            void this.repairHistoricalTranslations().catch(error => {
                Logger.error(
                    `Automatic customer-content translation repair failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    contentTranslationLoggerCtx,
                    error instanceof Error ? error.stack : undefined,
                );
            });
        }
    }

    async repairHistoricalTranslations(): Promise<NativeContentBackfillResult> {
        if (!this.requestContextService || !this.translations.isConfigured()) {
            return emptyBackfillResult();
        }
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
            languageCode: LanguageCode.zh_Hans,
        });
        const aggregate = emptyBackfillResult();
        let offset = 0;
        do {
            const page = await this.backfill(ctx, null, 100, offset);
            aggregate.total = page.total;
            aggregate.scanned += page.scanned;
            aggregate.processed += page.processed;
            aggregate.failed += page.failed;
            aggregate.errors.push(...page.errors.slice(0, Math.max(0, 50 - aggregate.errors.length)));
            aggregate.nextOffset = page.nextOffset;
            aggregate.hasMore = page.hasMore;
            if (page.scanned === 0) break;
            offset = page.nextOffset;
        } while (aggregate.hasMore);
        const summary =
            `Automatic customer-content translation repair scanned ${aggregate.scanned} records, ` +
            `processed ${aggregate.processed}, failed ${aggregate.failed}`;
        if (aggregate.failed) {
            Logger.warn(
                `${summary}. ${aggregate.errors.slice(0, 5).join('; ')}`,
                contentTranslationLoggerCtx,
            );
        } else {
            Logger.info(summary, contentTranslationLoggerCtx);
        }
        return aggregate;
    }

    private async handle(event: NativeEvent): Promise<void> {
        if (event.type === 'deleted') return;
        const entities = Array.isArray(event.entity) ? event.entity : [event.entity];
        const inputs = Array.isArray(event.input) ? event.input : [event.input];
        for (let index = 0; index < entities.length; index++) {
            const entity = entities[index];
            const input = findInputForEntity(inputs, entity.id, index);
            if (containsSourceTranslation(input)) {
                await this.translateEntity(event.ctx, entity, input);
            } else if (containsTargetTranslation(input)) {
                await this.lockManualTranslation(event.ctx, entity, input);
            }
        }
    }

    async lockManualTranslation(ctx: RequestContext, entity: NativeEntity, input: any): Promise<void> {
        const definition = definitions.get(entity.constructor);
        if (!definition) return;
        const targetInput = getTranslationInput(input, 'en');
        if (!targetInput) return;
        const entityType = entity.constructor.name;
        const repository = this.translationRepository(ctx, entity);
        if (!repository) return;
        const [source, target] = await Promise.all([
            findTranslation(repository, entity.id, 'zh_Hans'),
            findTranslation(repository, entity.id, 'en'),
        ]);
        if (!source) {
            throw new UserInputError(
                `Cannot save ${entityType}: Simplified Chinese source content is missing`,
            );
        }
        if (!target) {
            throw new UserInputError(
                `Cannot review ${entityType} in English: save the Simplified Chinese source first so English can be generated`,
            );
        }
        const submittedChineseTarget = definition.fields.some(
            field =>
                Object.prototype.hasOwnProperty.call(targetInput, field.path) &&
                contentTranslationInternals.containsHanContent(String(target[field.path] ?? '')),
        );
        if (submittedChineseTarget) {
            await this.translateEntity(ctx, entity, { translations: [source] });
            return;
        }
        for (const field of definition.fields) {
            if (!Object.prototype.hasOwnProperty.call(targetInput, field.path)) continue;
            const sourceText = String(source[field.path] ?? '');
            const targetText = String(target[field.path] ?? '');
            if (field.required && !sourceText.trim()) {
                throw new UserInputError(
                    `Cannot save ${entityType}: required Simplified Chinese field "${field.path}" is empty`,
                );
            }
            if (sourceText.trim() && !targetText.trim()) {
                throw new UserInputError(
                    `Cannot review ${entityType} in English: field "${field.path}" is empty; save the Simplified Chinese source first so it can be generated`,
                );
            }
            if (!sourceText.trim() && !targetText.trim()) continue;
            await this.translations.recordState(ctx, {
                channelId: ctx.channelId,
                entityType,
                entityId: entity.id,
                fieldPath: field.path,
                sourceText,
                translatedText: targetText,
                status: 'MANUAL_LOCKED',
                origin: 'MANUAL',
                locked: true,
            });
        }
    }

    async backfill(
        ctx: RequestContext,
        entityType?: string | null,
        limit = 100,
        offset = 0,
    ): Promise<NativeContentBackfillResult> {
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            throw new UserInputError('Backfill limit must be an integer between 1 and 500');
        }
        if (!Number.isInteger(offset) || offset < 0) {
            throw new UserInputError('Backfill offset must be a non-negative integer');
        }
        const selected = [...definitions.entries()].filter(
            ([entityClass]) => !entityType || entityClass.name === entityType,
        );
        if (entityType && !selected.length) {
            throw new UserInputError(`Unsupported customer content type "${entityType}"`);
        }
        const repositories = selected.map(([entityClass]) => ({
            entityClass,
            repository: this.connection.getRepository(ctx, entityClass),
        }));
        const totals = await Promise.all(repositories.map(item => item.repository.count()));
        const total = totals.reduce((sum, count) => sum + count, 0);
        const result: NativeContentBackfillResult = {
            total,
            scanned: 0,
            processed: 0,
            failed: 0,
            nextOffset: Math.min(offset, total),
            hasMore: offset < total,
            errors: [],
        };
        let remaining = limit;
        let remainingOffset = offset;
        for (let typeIndex = 0; typeIndex < repositories.length; typeIndex++) {
            if (remaining <= 0) break;
            const { entityClass, repository } = repositories[typeIndex];
            const typeTotal = totals[typeIndex];
            if (remainingOffset >= typeTotal) {
                remainingOffset -= typeTotal;
                continue;
            }
            const entities = (await repository.find({
                relations:
                    entityClass === Product || entityClass === ProductVariant
                        ? ['translations', 'channels']
                        : ['translations'],
                take: remaining,
                skip: remainingOffset,
                order: { id: 'ASC' },
            })) as NativeEntity[];
            remainingOffset = 0;
            result.scanned += entities.length;
            remaining -= entities.length;
            for (const entity of entities) {
                const source = entity.translations?.find(
                    translation => translation.languageCode === 'zh_Hans',
                );
                if (!source) continue;
                try {
                    await this.translateEntity(ctx, entity, { translations: [source] });
                    await this.refreshProductSearchIndex(ctx, entity);
                    result.processed++;
                } catch (error) {
                    result.failed++;
                    if (result.errors.length < 50) {
                        result.errors.push(
                            `${entity.constructor.name}#${entity.id}: ${
                                error instanceof Error ? error.message : String(error)
                            }`,
                        );
                    }
                }
            }
        }
        result.nextOffset = Math.min(offset + result.scanned, total);
        result.hasMore = result.nextOffset < total;
        return result;
    }

    async translateEntity(ctx: RequestContext, entity: NativeEntity, input: any): Promise<void> {
        const definition = definitions.get(entity.constructor);
        if (!definition) return;
        const entityType = entity.constructor.name;
        const repository = this.translationRepository(ctx, entity);
        if (!repository) return;
        const [source, target] = await Promise.all([
            findTranslation(repository, entity.id, 'zh_Hans'),
            findTranslation(repository, entity.id, 'en'),
        ]);
        if (!source) {
            throw new UserInputError(`Cannot translate ${entityType}: Simplified Chinese content is missing`);
        }

        const targetInput = getTranslationInput(input, 'en');
        const existingStates = await this.translations.findStates(ctx, {
            channelId: ctx.channelId,
            entityType,
            entityId: entity.id,
        });
        const statesByField = new Map(existingStates.map(state => [state.fieldPath, state]));
        const manualFields = new Set<string>();
        const staleFields = new Set<string>();
        const currentAutoFields = new Set<string>();
        for (const field of definition.fields) {
            const state = statesByField.get(field.path);
            const currentTargetText = String(target?.[field.path] ?? '');
            const currentHash = contentTranslationInternals.hash(currentTargetText);
            const sourceHash = contentTranslationInternals.hash(String(source[field.path] ?? ''));
            const targetWasSubmitted = targetInput?.[field.path] != null;
            const targetWasCleared = targetWasSubmitted && !String(targetInput?.[field.path] ?? '').trim();
            const targetContainsHan = contentTranslationInternals.containsHanContent(currentTargetText);
            const targetChanged =
                targetWasSubmitted && !targetWasCleared && (!state || state.translatedHash !== currentHash);
            if (targetChanged && !targetContainsHan) {
                manualFields.add(field.path);
                continue;
            }
            if (targetWasCleared) continue;
            if (state?.locked && !targetContainsHan) {
                if (state.sourceHash !== sourceHash || state.status === 'STALE') {
                    staleFields.add(field.path);
                }
                manualFields.add(field.path);
                continue;
            }
            if (
                state?.status === 'AUTO_TRANSLATED' &&
                !state.locked &&
                state.sourceHash === sourceHash &&
                state.translatedHash === currentHash &&
                !targetContainsHan
            ) {
                currentAutoFields.add(field.path);
                continue;
            }
            if (!state && currentTargetText.trim() && currentHash !== sourceHash && !targetContainsHan) {
                manualFields.add(field.path);
            }
        }

        for (const field of definition.fields) {
            if (field.required && !String(source[field.path] ?? '').trim()) {
                throw new UserInputError(
                    `Cannot save ${entityType}: required Simplified Chinese field "${field.path}" is empty`,
                );
            }
        }
        const segments = definition.fields
            .filter(
                field =>
                    !field.deriveFrom && !manualFields.has(field.path) && !currentAutoFields.has(field.path),
            )
            .filter(field => String(source[field.path] ?? '').trim().length > 0)
            .map(field => ({
                key: field.path,
                text: String(source[field.path]),
                format: field.format ?? 'TEXT',
            }));
        if (segments.length && !this.translations.isConfigured()) {
            throw new UserInputError(
                'English content could not be generated because the translation provider is not configured',
            );
        }

        const generated = segments.length
            ? await this.translations.translate({ segments })
            : { provider: this.translations.providerName(), translations: [] };
        const generatedByField = new Map(generated.translations.map(item => [item.key, item.text]));
        const nextTarget =
            target ??
            repository.create({
                languageCode: 'en',
                base: entity,
            });
        for (const field of definition.fields) {
            if (manualFields.has(field.path) || currentAutoFields.has(field.path)) continue;
            if (field.deriveFrom) {
                const seed = String(
                    generatedByField.get(field.deriveFrom) ??
                        nextTarget[field.deriveFrom] ??
                        source[field.deriveFrom] ??
                        '',
                );
                nextTarget[field.path] =
                    normalizeString(seed, '-') || `${entityType.toLowerCase()}-${entity.id}`;
            } else {
                nextTarget[field.path] = generatedByField.get(field.path) ?? '';
            }
        }
        for (const field of definition.fields) {
            if (field.required && !String(nextTarget[field.path] ?? '').trim()) {
                throw new UserInputError(
                    `Cannot save ${entityType}: automatic English translation for required field "${field.path}" is empty`,
                );
            }
        }
        await repository.save(nextTarget, { reload: false });

        for (const field of definition.fields) {
            const isManual = manualFields.has(field.path);
            const isStale = staleFields.has(field.path);
            await this.translations.recordState(ctx, {
                channelId: ctx.channelId,
                entityType,
                entityId: entity.id,
                fieldPath: field.path,
                sourceText: String(source[field.path] ?? ''),
                translatedText: String(nextTarget[field.path] ?? ''),
                status: isStale ? 'STALE' : isManual ? 'MANUAL_LOCKED' : 'AUTO_TRANSLATED',
                origin: isManual ? 'MANUAL' : 'AUTO',
                locked: isManual,
            });
        }
    }

    private translationRepository(
        ctx: RequestContext,
        entity: NativeEntity,
    ): Repository<ObjectLiteral> | undefined {
        const baseMetadata = this.connection.rawConnection.getMetadata(entity.constructor);
        const translationsRelation = baseMetadata.relations.find(
            relation => relation.propertyName === 'translations',
        );
        if (!translationsRelation) return undefined;
        return this.connection.getRepository(ctx, translationsRelation.inverseEntityMetadata.target);
    }

    private async refreshProductSearchIndex(ctx: RequestContext, entity: NativeEntity): Promise<void> {
        if (!(entity instanceof Product) && !(entity instanceof ProductVariant)) return;
        const requestContextService = this.requestContextService;
        const contexts =
            requestContextService && entity.channels?.length
                ? await Promise.all(
                      entity.channels.map(channel =>
                          requestContextService.create({
                              apiType: 'admin',
                              channelOrToken: channel,
                              languageCode: LanguageCode.zh_Hans,
                          }),
                      ),
                  )
                : [ctx];
        for (const channelCtx of contexts) {
            if (entity instanceof Product) {
                await this.eventBus.publish(new ProductEvent(channelCtx, entity, 'updated', entity.id));
            } else {
                await this.eventBus.publish(
                    new ProductVariantEvent(channelCtx, [entity], 'updated', [entity.id]),
                );
            }
        }
    }
}

function containsSourceTranslation(input: any): boolean {
    return !!getTranslationInput(input, 'zh_Hans');
}

function containsTargetTranslation(input: any): boolean {
    return !!getTranslationInput(input, 'en');
}

function getTranslationInput(input: any, languageCode: string): Record<string, any> | undefined {
    if (!input || !Array.isArray(input.translations)) return undefined;
    return input.translations.find((translation: any) => translation?.languageCode === languageCode);
}

function findInputForEntity(inputs: unknown[], entityId: ID, index: number): any {
    return (
        inputs.find((input: any) => input?.id != null && String(input.id) === String(entityId)) ??
        inputs[index]
    );
}

function findTranslation(
    repository: Repository<ObjectLiteral>,
    entityId: ID,
    languageCode: string,
): Promise<ObjectLiteral | null> {
    return repository
        .createQueryBuilder('translation')
        .leftJoinAndSelect('translation.base', 'base')
        .where('base.id = :entityId', { entityId })
        .andWhere('translation.languageCode = :languageCode', { languageCode })
        .getOne();
}

function emptyBackfillResult(): NativeContentBackfillResult {
    return {
        total: 0,
        scanned: 0,
        processed: 0,
        failed: 0,
        nextOffset: 0,
        hasMore: false,
        errors: [],
    };
}

export const nativeContentTranslationInternals = {
    containsSourceTranslation,
    containsTargetTranslation,
    getTranslationInput,
    findInputForEntity,
    containsHanContent: contentTranslationInternals.containsHanContent,
    supportsEntityType: (entityType: NamedEntityClass) => definitions.has(entityType),
};
