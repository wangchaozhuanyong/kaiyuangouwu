import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {
    Channel,
    EventBus,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    VendureEvent,
} from '@vendure/core';
import { SearchIndexService } from '@vendure/core/dist/plugin/default-search-plugin/indexer/search-index.service';
import { createHash } from 'node:crypto';
import { EntityManager, EntityMetadata, IsNull, ObjectLiteral } from 'typeorm';

import { customerFacingContentRegistry } from './customer-facing-content-registry.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { TranslationProviderError } from './translation-provider-error.js';

export class TranslationDependencyPending extends Error {}
export interface TranslationFieldSnapshot {
    source: string;
    target: string;
    format: 'TEXT' | 'HTML';
    derivedTarget?: string;
    reusableTarget?: boolean;
    maxTargetLength?: number;
    save: (value: string) => Promise<unknown>;
}
const columnFields: Record<string, string[]> = Object.fromEntries(
    Object.entries(customerFacingContentRegistry)
        .filter(([, definition]) => definition.storage === 'LOCALIZED_COLUMNS')
        .map(([name, definition]) => [name, definition.fields.map(field => field.path)]),
);

@Injectable()
export class TranslationContentAdapter {
    @Inject(ModuleRef) private readonly moduleRef!: ModuleRef;
    @Optional() @Inject(EventBus) private readonly eventBus?: EventBus;
    @Optional() @Inject(RequestContextService) private readonly contexts?: RequestContextService;
    constructor(private readonly connection: TransactionalConnection) {}
    scopeWhere(metadata: EntityMetadata, channelId: string | number): ObjectLiteral {
        const active = metadata.deleteDateColumn
            ? { [metadata.deleteDateColumn.propertyName]: IsNull() }
            : {};
        if (metadata.findColumnWithPropertyName('channelId')) return { ...active, channelId };
        if (metadata.name === 'StorefrontContentItem') return { ...active, block: { channelId } };
        if (metadata.relations.some(relation => relation.propertyName === 'channels'))
            return { ...active, channels: { id: channelId } };
        return active;
    }

    async notify(state: ContentTranslationState) {
        if (!this.eventBus || !this.contexts) return;
        const channels = await this.connection.rawConnection.getRepository(Channel).find({
            where: state.channelId == null ? {} : { id: state.channelId },
        });
        for (const channel of channels) {
            const ctx = await this.contexts.create({ apiType: 'admin', channelOrToken: channel });
            if (['Product', 'ProductVariant'].includes(state.entityType)) {
                const metadata = this.connection.rawConnection.entityMetadatas.find(
                    entity => entity.name === state.entityType,
                );
                if (metadata) {
                    const entity = await this.connection.rawConnection
                        .getRepository(metadata.target)
                        .findOne({ where: { id: state.entityId }, relations: { channels: true } });
                    if (entity) {
                        const search = this.moduleRef.get(SearchIndexService, { strict: false });
                        for (const owner of entity.channels) {
                            const ownerCtx = await this.contexts.create({
                                apiType: 'admin',
                                channelOrToken: owner,
                            });
                            if (state.entityType === 'Product')
                                await search.updateProduct(ownerCtx, entity as never);
                            else await search.updateVariants(ownerCtx, [entity as never]);
                        }
                    }
                }
            }
            await this.eventBus.publish(new ContentTranslatedEvent(ctx, [state.entityId]));
        }
    }

    async load(
        manager: EntityManager,
        state: ContentTranslationState,
        lock = false,
    ): Promise<TranslationFieldSnapshot | undefined> {
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
        if (!entity || entity.deletedAt) return;
        if (
            metadata.findColumnWithPropertyName('channelId') &&
            entity.channelId != null &&
            String(entity.channelId) !== state.channelId
        )
            return;
        if (metadata.relations.some(relation => relation.propertyName === 'channels')) {
            const scoped = await repository.findOne({
                where: { id: entity.id },
                relations: { channels: true },
            });
            if (!scoped?.channels.some((channel: { id: unknown }) => String(channel.id) === state.channelId))
                return;
        }
        if (state.entityType === 'StorefrontContentItem') {
            const parent = metadata.relations.find(relation => relation.propertyName === 'block');
            if (!parent) return;
            const block = await manager
                .getRepository(parent.inverseEntityMetadata.target)
                .findOne({ where: { id: entity.blockId } });
            if (!block || String(block.channelId) !== state.channelId) return;
        }
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
            // Native translation rows are shared across Channels. Respect a review made in any owning Channel.
            const targetHash = createHash('sha256')
                .update(String(target[state.fieldPath] ?? ''))
                .digest('hex');
            const sourceHash = createHash('sha256')
                .update(String(source[state.fieldPath] ?? ''))
                .digest('hex');
            const siblingStates =
                definition.storage === 'VENDURE_TRANSLATIONS'
                    ? await manager.getRepository(ContentTranslationState).find({
                          where: {
                              entityType: state.entityType,
                              entityId: state.entityId,
                              fieldPath: state.fieldPath,
                              targetLanguageCode: state.targetLanguageCode ?? 'en',
                          },
                      })
                    : [];
            if (siblingStates.some(sibling => sibling.locked && sibling.translatedHash === targetHash)) {
                throw new TranslationProviderError('MANUAL_REVIEW');
            }
            const reusableTarget = siblingStates.some(
                sibling =>
                    sibling.sourceHash === sourceHash &&
                    sibling.translatedHash === targetHash &&
                    ['AUTO_TRANSLATED', 'NOTIFY_PENDING'].includes(sibling.status),
            );
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
                if (nameState && ['PENDING', 'TRANSLATING', 'FAILED'].includes(nameState.status))
                    throw new TranslationDependencyPending();
            }
            return {
                reusableTarget,
                source: String(source[state.fieldPath] ?? ''),
                target: String(target[state.fieldPath] ?? ''),
                derivedTarget:
                    field.format === 'SLUG'
                        ? String(
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
                maxTargetLength: 16,
                save: async value =>
                    channels.update(channel.id, {
                        customFields: { ...channel.customFields, storefrontNameEn: value },
                    }),
            };
        }
        if (state.entityType === 'AutoCardConfig' && /^fields\.[^.]+\.label$/.test(state.fieldPath)) {
            let parsed: unknown;
            try {
                parsed = JSON.parse(entity.fieldsJson);
            } catch {
                throw new TranslationProviderError('INVALID_CONTENT');
            }
            if (
                !Array.isArray(parsed) ||
                parsed.some(
                    entry => !entry || typeof entry.key !== 'string' || typeof entry.label !== 'string',
                )
            ) {
                throw new TranslationProviderError('INVALID_CONTENT');
            }
            const fields = parsed as Array<{
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
