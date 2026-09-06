import { Inject, Injectable, Optional } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {
    Channel,
    EventBus,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    VendureEvent,
} from '@vendure/core';
import { EntityManager, In, IsNull, ObjectLiteral } from 'typeorm';

import {
    ContentTranslationService,
    contentTranslationInternals,
    isUsableEnglishTranslation,
} from './content-translation.service.js';
import { customerFacingContentRegistry } from './customer-facing-content-registry.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { NativeContentTranslationService } from './native-content-translation.service.js';
import { TranslationProviderError } from './translation-provider-error.js';

interface FieldSnapshot {
    source: string;
    target: string;
    format: 'TEXT' | 'HTML';
    derivedTarget?: string;
    maxTargetLength?: number;
    save: (value: string) => Promise<unknown>;
}

const columnFields: Record<string, string[]> = {
    StoreProfile: ['description'],
    SystemAnnouncement: ['title', 'content'],
    AutoCardConfig: ['instructions'],
    StorefrontReview: ['merchantResponse'],
    AfterSalesRequest: ['resolution'],
    ImageGenerationConfig: ['terms'],
    ImageModelConfig: ['displayName', 'description'],
    ReferralPosterTemplate: customerFacingContentRegistry.ReferralPosterTemplate.fields.map(
        field => field.path,
    ),
};

/** Pending rows are the durable outbox: persisted in the same transaction as the Chinese edit. */
@Injectable()
export class ContentTranslationRetryService {
    @Optional() @Inject(EventBus) private readonly eventBus?: EventBus;
    @Optional() @Inject(RequestContextService) private readonly contexts?: RequestContextService;
    @Optional()
    @Inject(NativeContentTranslationService)
    private readonly nativeTranslations?: NativeContentTranslationService;
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly translations: ContentTranslationService,
    ) {}

    async retryPending() {
        const repository = this.connection.rawConnection.getRepository(ContentTranslationState);
        const pending = await repository.find({
            where: { status: In(['PENDING', 'FAILED', 'TRANSLATING']), locked: false, origin: 'AUTO' },
            order: { updatedAt: 'ASC', id: 'ASC' },
            take: 20,
        });
        const result = { scanned: 0, translated: 0, deferred: 0 };
        const deadline = Date.now() + 45_000;
        for (const state of pending) {
            if (Date.now() >= deadline) break;
            result.scanned++;
            let appliedState: ContentTranslationState | undefined;
            try {
                const snapshot = await this.load(this.connection.rawConnection.manager, state);
                if (!snapshot) {
                    await repository.update(this.stateCriteria(state), {
                        status: 'FAILED',
                        error: '翻译源记录或字段已不存在，请检查内容',
                    });
                    result.deferred++;
                    continue;
                }
                if (
                    state.status === 'TRANSLATING' &&
                    state.sourceHash === contentTranslationInternals.hash(snapshot.source) &&
                    state.translatedHash === contentTranslationInternals.hash(snapshot.target)
                ) {
                    // The translation is durable; resume a notification interrupted by a worker restart.
                    appliedState = state;
                    await this.notify(state);
                    await repository.update(this.stateCriteria(state), {
                        status: 'AUTO_TRANSLATED',
                        error: null,
                    });
                    result.translated++;
                    continue;
                }
                if (!this.translations.isConfigured()) throw new TranslationProviderError('CONFIGURATION');
                // Translate a snapshot outside any business row lock. New edits must win when applying it.
                const response =
                    snapshot.derivedTarget != null
                        ? { translations: [{ key: state.fieldPath, text: snapshot.derivedTarget }] }
                        : snapshot.source.trim()
                          ? await this.translations.translate({
                                segments: [
                                    { key: state.fieldPath, text: snapshot.source, format: snapshot.format },
                                ],
                            })
                          : { translations: [{ key: state.fieldPath, text: '' }] };
                const translated = response.translations.find(item => item.key === state.fieldPath)?.text;
                if (translated == null || (snapshot.source.trim() && !isUsableEnglishTranslation(translated)))
                    throw new TranslationProviderError('INVALID_RESPONSE');
                if (snapshot.maxTargetLength && translated.trim().length > snapshot.maxTargetLength)
                    throw new TranslationProviderError('TEXT_TOO_LONG');
                const applied = await this.connection.rawConnection.transaction(async manager => {
                    const current = await this.load(manager, state, true);
                    const currentState = await manager
                        .getRepository(ContentTranslationState)
                        .findOne({ where: { id: state.id } });
                    if (
                        !current ||
                        !currentState ||
                        currentState.locked ||
                        currentState.origin !== 'AUTO' ||
                        !['PENDING', 'FAILED', 'TRANSLATING'].includes(currentState.status)
                    )
                        return undefined;
                    if (
                        currentState.updatedAt.getTime() !== state.updatedAt.getTime() ||
                        current.source !== snapshot.source ||
                        current.target !== snapshot.target
                    )
                        return undefined;
                    await current.save(translated.trim());
                    await manager.getRepository(ContentTranslationState).update(state.id, {
                        sourceHash: contentTranslationInternals.hash(current.source),
                        translatedHash: contentTranslationInternals.hash(translated.trim()),
                        status: 'TRANSLATING',
                        error: null,
                    });
                    return await manager
                        .getRepository(ContentTranslationState)
                        .findOneByOrFail({ id: state.id });
                });
                if (applied) {
                    appliedState = applied;
                    await this.notify(state);
                    await repository.update(this.stateCriteria(applied), {
                        status: 'AUTO_TRANSLATED',
                        error: null,
                    });
                    result.translated++;
                } else result.deferred++;
            } catch (error) {
                await repository.update(this.stateCriteria(appliedState ?? state), {
                    status: appliedState ? 'TRANSLATING' : 'PENDING',
                    error:
                        error instanceof TranslationProviderError
                            ? error.message
                            : '自动翻译重试失败，系统将稍后再试',
                });
                result.deferred++;
                // Stop this sweep on provider failure; never drain the remaining quota with repeated errors.
                break;
            }
        }
        return result;
    }

    private stateCriteria(state: ContentTranslationState) {
        return {
            id: state.id,
            sourceHash: state.sourceHash,
            translatedHash: state.translatedHash ?? IsNull(),
            status: state.status,
            origin: state.origin,
            locked: state.locked,
        };
    }

    private async notify(state: ContentTranslationState) {
        if (!this.eventBus || !this.contexts) return;
        const channels = await this.connection.rawConnection.getRepository(Channel).find({
            where: state.channelId == null ? {} : { id: state.channelId },
        });
        for (const channel of channels) {
            const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
            if (['Product', 'ProductVariant'].includes(state.entityType) && this.nativeTranslations) {
                const metadata = this.connection.rawConnection.entityMetadatas.find(
                    entity => entity.name === state.entityType,
                );
                if (metadata) {
                    const entity = await this.connection.rawConnection
                        .getRepository(metadata.target)
                        .findOne({ where: { id: state.entityId }, relations: { channels: true } });
                    if (entity) await this.nativeTranslations.refreshProductSearchIndex(ctx, entity as never);
                }
            }
            await this.eventBus.publish(new ContentTranslatedEvent(ctx, [state.entityId]));
        }
    }

    private async load(
        manager: EntityManager,
        state: ContentTranslationState,
        lock = false,
    ): Promise<FieldSnapshot | undefined> {
        const metadata = manager.connection.entityMetadatas.find(
            candidate => candidate.name === state.entityType,
        );
        if (!metadata) return;
        const repository = manager.getRepository<ObjectLiteral>(metadata.target);
        const driver = manager.connection.options.type;
        const lockOptions =
            lock && !['sqlite', 'better-sqlite3', 'sqljs'].includes(driver)
                ? { lock: { mode: 'pessimistic_write' as const } }
                : {};
        const entity = await repository.findOne({ where: { id: state.entityId }, ...lockOptions });
        if (!entity || (entity.channelId != null && String(entity.channelId) !== state.channelId)) return;
        const definition =
            customerFacingContentRegistry[state.entityType as keyof typeof customerFacingContentRegistry];
        const field = definition?.fields.find(candidate => candidate.path === state.fieldPath);
        const translationRelation = metadata.relations.find(
            relation => relation.propertyName === 'translations',
        );
        if (translationRelation && field) {
            const table = manager.getRepository<ObjectLiteral>(
                translationRelation.inverseEntityMetadata.target,
            );
            const source = await table.findOne({
                where: { base: { id: entity.id }, languageCode: 'zh_Hans' },
                ...lockOptions,
            });
            const target = await table.findOne({
                where: { base: { id: entity.id }, languageCode: 'en' },
                ...lockOptions,
            });
            if (!source || !target) return;
            if (field.format === 'SLUG') {
                // Slugs are derived from the already-translated name; they are never sent to the provider.
                const nameState = await manager.getRepository(ContentTranslationState).findOne({
                    where: {
                        entityType: state.entityType,
                        entityId: state.entityId,
                        fieldPath: 'name',
                        channelId: state.channelId == null ? undefined : state.channelId,
                    },
                });
                if (nameState && ['PENDING', 'FAILED'].includes(nameState.status)) return;
            }
            return {
                source: String(source[state.fieldPath] ?? ''),
                target: String(target[state.fieldPath] ?? ''),
                derivedTarget:
                    field.format === 'SLUG'
                        ? String(
                              target[state.fieldPath] ||
                                  normalizeString(target.name ?? '', '-') ||
                                  `${state.entityType.toLowerCase()}-${entity.id}`,
                          )
                        : undefined,
                maxTargetLength:
                    Number(table.metadata.findColumnWithPropertyName(state.fieldPath)?.length) || undefined,
                format: field.format === 'HTML' ? 'HTML' : 'TEXT',
                save: async value =>
                    table.update(target.id, {
                        [state.fieldPath]:
                            field.format === 'SLUG'
                                ? normalizeString(value, '-') ||
                                  `${state.entityType.toLowerCase()}-${entity.id}`
                                : value,
                    }),
            };
        }
        if (state.entityType === 'StoreProfile' && state.fieldPath === 'storefrontName') {
            const channelMetadata = manager.connection.entityMetadatas.find(
                candidate => candidate.name === 'Channel',
            );
            if (!channelMetadata) return;
            const channels = manager.getRepository<ObjectLiteral>(channelMetadata.target);
            const channel = await channels.findOne({ where: { id: entity.channelId }, ...lockOptions });
            if (!channel) return;
            return {
                source: channel.customFields.storefrontNameZh ?? '',
                target: channel.customFields.storefrontNameEn ?? '',
                format: 'TEXT',
                maxTargetLength: 32,
                save: async value =>
                    channels.update(channel.id, {
                        customFields: { ...channel.customFields, storefrontNameEn: value },
                    }),
            };
        }
        if (state.entityType === 'AutoCardConfig' && /^fields\.[^.]+\.label$/.test(state.fieldPath)) {
            const fields = JSON.parse(entity.fieldsJson) as Array<{
                key: string;
                label: string;
                labelEn?: string;
            }>;
            const jsonField = fields.find(candidate => `fields.${candidate.key}.label` === state.fieldPath);
            if (!jsonField) return;
            return {
                source: jsonField.label,
                target: jsonField.labelEn ?? '',
                format: 'TEXT',
                save: async value => {
                    jsonField.labelEn = value;
                    await repository.update(entity.id, { fieldsJson: JSON.stringify(fields) });
                },
            };
        }
        if (!columnFields[state.entityType]?.includes(state.fieldPath)) return;
        const sourceKey = `${state.fieldPath}Zh`;
        const targetKey = `${state.fieldPath}En`;
        if (
            !metadata.findColumnWithPropertyName(sourceKey) ||
            !metadata.findColumnWithPropertyName(targetKey)
        )
            return;
        return {
            source: String(entity[sourceKey] ?? ''),
            target: String(entity[targetKey] ?? ''),
            format: field?.format === 'HTML' || state.fieldPath === 'instructions' ? 'HTML' : 'TEXT',
            maxTargetLength: Number(metadata.findColumnWithPropertyName(targetKey)?.length) || undefined,
            save: async value => repository.update(entity.id, { [targetKey]: value }),
        };
    }
}

class ContentTranslatedEvent extends VendureEvent {
    readonly realtimeEventKind = 'storefront-content-changed';
    constructor(
        public readonly ctx: RequestContext,
        public readonly entityIds: string[],
    ) {
        super();
    }
}
