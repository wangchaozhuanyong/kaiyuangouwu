import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
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

import { ContentTranslationService, contentTranslationInternals } from './content-translation.service.js';
import { customerFacingContentRegistry } from './customer-facing-content-registry.js';
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
    queued: number;
    skipped: number;
    failed: number;
    nextOffset: number;
    hasMore: boolean;
    skippedRecords: string[];
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

const nativeClasses = [
    Product,
    ProductVariant,
    ProductOptionGroup,
    ProductOption,
    Collection,
    Facet,
    FacetValue,
    Promotion,
    ShippingMethod,
    PaymentMethod,
    Country,
    Province,
];
const definitions = new Map<NamedEntityClass, NativeDefinition>(
    nativeClasses.map(entity => [
        entity,
        {
            fields: customerFacingContentRegistry[
                entity.name as keyof typeof customerFacingContentRegistry
            ].fields.map(field => ({
                path: field.path,
                required: field.requiredForPublish,
                format: field.format === 'HTML' ? 'HTML' : 'TEXT',
                deriveFrom: field.format === 'SLUG' ? 'name' : undefined,
            })),
        },
    ]),
);

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
    }

    // Called by the worker scanner only; one bounded page, no network requests.
    async repairHistoricalTranslations(offset = 0): Promise<NativeContentBackfillResult> {
        if (!this.requestContextService) return emptyBackfillResult();
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
            languageCode: LanguageCode.zh_Hans,
        });
        return this.backfill(ctx, null, 100, offset);
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
        const totals = await Promise.all(
            repositories.map(item =>
                item.repository.count({
                    where: this.backfillWhere(ctx, item.entityClass),
                }),
            ),
        );
        const total = totals.reduce((sum, count) => sum + count, 0);
        const result: NativeContentBackfillResult = {
            total,
            scanned: 0,
            processed: 0,
            queued: 0,
            skipped: 0,
            failed: 0,
            nextOffset: Math.min(offset, total),
            hasMore: offset < total,
            skippedRecords: [],
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
                where: this.backfillWhere(ctx, entityClass),
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
                if (!source) {
                    result.skipped++;
                    if (result.skippedRecords.length < 50) {
                        result.skippedRecords.push(
                            `${entity.constructor.name}#${entity.id}: Simplified Chinese content is missing`,
                        );
                    }
                    continue;
                }
                try {
                    const queued = await this.connection.withTransaction(ctx, transactionCtx =>
                        this.translateEntity(transactionCtx, entity, { translations: [source] }),
                    );
                    if (queued) result.queued++;
                    else result.processed++;
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

    async translateEntity(ctx: RequestContext, entity: NativeEntity, input: any): Promise<boolean> {
        const definition = definitions.get(entity.constructor);
        if (!definition) return false;
        const entityType = entity.constructor.name;
        const repository = this.translationRepository(ctx, entity);
        if (!repository) return false;
        const [source, target] = await Promise.all([
            findTranslation(repository, entity.id, 'zh_Hans'),
            findTranslation(repository, entity.id, 'en'),
        ]);
        if (!source) {
            throw new UserInputError(`Cannot translate ${entityType}: Simplified Chinese content is missing`);
        }

        const targetInput = getTranslationInput(input, 'en');
        const existingStates = await this.translations.findStates(
            ctx,
            {
                channelId: ctx.channelId,
                entityType,
                entityId: entity.id,
            },
            true,
        );
        const statesByField = new Map(
            existingStates
                .filter(state => state.channelId == null || state.channelId === String(ctx.channelId))
                .map(state => [state.fieldPath, state]),
        );
        const manualFields = new Set<string>();
        const staleFields = new Set<string>();
        const currentAutoFields = new Set<string>();
        for (const field of definition.fields) {
            const currentTargetText = String(target?.[field.path] ?? '');
            const currentHash = contentTranslationInternals.hash(currentTargetText);
            const shared = existingStates.filter(
                candidate => candidate.fieldPath === field.path && candidate.translatedHash === currentHash,
            );
            const state =
                shared.find(candidate => candidate.locked) ?? statesByField.get(field.path) ?? shared[0];

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
        const pendingFields = definition.fields.filter(
            field =>
                !manualFields.has(field.path) &&
                !currentAutoFields.has(field.path) &&
                (field.deriveFrom || String(source[field.path] ?? '').trim()),
        );
        const pending = new Set(pendingFields.map(field => field.path));
        const nextTarget = target ?? repository.create({ languageCode: 'en', base: entity });
        for (const field of definition.fields) {
            if (manualFields.has(field.path) || currentAutoFields.has(field.path)) continue;
            const previous = String(target?.[field.path] ?? '');
            nextTarget[field.path] =
                pending.has(field.path) && !contentTranslationInternals.containsHanContent(previous)
                    ? previous
                    : '';
            if (field.deriveFrom && !nextTarget[field.path])
                nextTarget[field.path] = `${entityType.toLowerCase()}-${entity.id}`;
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
                status: isStale
                    ? 'STALE'
                    : isManual
                      ? 'MANUAL_LOCKED'
                      : pending.has(field.path)
                        ? 'PENDING'
                        : 'AUTO_TRANSLATED',
                origin: isManual ? 'MANUAL' : 'AUTO',
                locked: isManual,
            });
        }
        return pending.size > 0;
    }

    private backfillWhere(ctx: RequestContext, entityClass: NamedEntityClass) {
        const metadata = this.connection.rawConnection.getMetadata(entityClass);
        return {
            ...(entityClass === Collection ? { isRoot: false } : {}),
            ...(metadata.relations.some(relation => relation.propertyName === 'channels')
                ? { channels: { id: ctx.channelId } }
                : {}),
        };
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

    async refreshProductSearchIndex(ctx: RequestContext, entity: NativeEntity): Promise<void> {
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
        queued: 0,
        skipped: 0,
        failed: 0,
        nextOffset: 0,
        hasMore: false,
        skippedRecords: [],
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
