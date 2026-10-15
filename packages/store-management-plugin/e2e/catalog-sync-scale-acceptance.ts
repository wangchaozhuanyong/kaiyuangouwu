import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    CatalogResourceOwnership,
    CatalogSyncBinding,
    CatalogSyncRule,
    Collection,
    CollectionService,
    CurrencyCode,
    LanguageCode,
    Product,
    ProductTranslation,
    ProductVariant,
    ProductVariantPrice,
    ProductVariantTranslation,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { In, MoreThan } from 'typeorm';
import { expect, it } from 'vitest';

import { CatalogSyncService } from '../../catalog-management-plugin/src/catalog-sync.service';

import { addSyntheticCollectionMembers } from './catalog-sync-fixture-links';

interface Fixture {
    connection: TransactionalConnection;
    platform: RequestContext;
    a: RequestContext;
    b: RequestContext;
    sync: CatalogSyncService;
    collections: CollectionService;
}

export function registerCatalogSyncScaleAcceptance(fixture: () => Fixture) {
    it.runIf(process.env.CATALOG_SYNC_SCALE === '10000')(
        'measures ten thousand real synthetic products in bounded resumable pages',
        async () => {
            const { connection, platform, a, b, sync, collections } = fixture();
            const started = performance.now();
            const repository = connection.rawConnection;
            const category = await collections.create(a, {
                inheritFilters: false,
                filters: [
                    {
                        code: 'variant-name-filter',
                        arguments: [
                            { name: 'operator', value: 'startsWith' },
                            { name: 'term', value: 'Synthetic scale ' },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
                translations: [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                    languageCode,
                    name: 'Synthetic ten thousand',
                    slug: 'synthetic-ten-thousand',
                    description: 'Local scalability fixture',
                })),
            });
            const variantIds: string[] = [];
            for (let offset = 0; offset < 10000; offset += 100) {
                const last = await repository
                    .getRepository(Product)
                    .find({ order: { id: 'DESC' }, take: 1, select: ['id'] });
                await repository
                    .createQueryBuilder()
                    .insert()
                    .into(Product)
                    .values(
                        Array.from({ length: 100 }, () => ({
                            enabled: true,
                            customFields: { fulfillmentType: 'digital' },
                        })),
                    )
                    .callListeners(false)
                    .execute();
                const ids = (
                    await repository.getRepository(Product).find({
                        where: { id: MoreThan(last[0]?.id ?? 0) },
                        order: { id: 'ASC' },
                        select: ['id'],
                    })
                ).map(product => product.id);
                expect(ids).toHaveLength(100);
                await repository.getRepository(ProductTranslation).insert(
                    ids.flatMap((id, i) =>
                        [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                            base: { id },
                            languageCode,
                            name: `Synthetic scale ${offset + i}`,
                            slug: `synthetic-scale-${offset + i}`,
                            description: 'Synthetic benchmark',
                        })),
                    ),
                );
                await repository.getRepository(CatalogResourceOwnership).insert(
                    ids.map(resourceId => ({
                        resourceType: 'Product' as const,
                        resourceId,
                        ownerChannelId: a.channelId,
                        scope: 'STORE' as const,
                    })),
                );
                await repository.createQueryBuilder().relation(Product, 'channels').of(ids).add(a.channelId);
                await repository
                    .createQueryBuilder()
                    .insert()
                    .into(ProductVariant)
                    .values(
                        ids.map((productId, i) => ({
                            productId,
                            enabled: true,
                            sku: `SYNC-SCALE-${offset + i}`,
                            trackInventory: GlobalFlag.FALSE,
                            outOfStockThreshold: 0,
                            useGlobalOutOfStockThreshold: true,
                            customFields: {
                                fulfillmentType: 'digital',
                                digitalDeliveryMode: 'manual_service',
                            },
                        })),
                    )
                    .callListeners(false)
                    .execute();
                const batchIds = (
                    await repository
                        .getRepository(ProductVariant)
                        .find({ where: { productId: In(ids) }, select: ['id'], order: { id: 'ASC' } })
                ).map(variant => String(variant.id));
                variantIds.push(...batchIds);
                await repository.getRepository(ProductVariantTranslation).insert(
                    batchIds.flatMap((id, i) =>
                        [LanguageCode.en, LanguageCode.zh_Hans].map(languageCode => ({
                            base: { id },
                            languageCode,
                            name: `Synthetic scale ${offset + i}`,
                        })),
                    ),
                );
                await repository.getRepository(ProductVariantPrice).insert(
                    batchIds.map(id => ({
                        variant: { id },
                        channelId: a.channelId,
                        currencyCode: CurrencyCode.CNY,
                        price: 1000,
                    })),
                );
                await repository
                    .createQueryBuilder()
                    .relation(ProductVariant, 'channels')
                    .of(batchIds)
                    .add(a.channelId);
                await addSyntheticCollectionMembers(connection, category.id, batchIds);
            }
            const seeded = performance.now();
            let rule = await sync.save(platform, {
                sourceChannelId: a.channelId,
                sourceCollectionId: category.id,
                targetChannelId: b.channelId,
                includeDescendants: true,
            });
            const previewStarted = performance.now();
            const preview = await sync.preview(platform, sync.input(rule));
            expect(preview.productCount).toBe(10000);
            expect(preview.blockers).toEqual([]);
            const previewMs = performance.now() - previewStarted;
            rule = await sync.enable(platform, rule.id, rule.version, preview.fingerprint, false);
            const syncStarted = performance.now();
            const pages: Array<{ cursor: number; elapsedMs: number }> = [];
            while (performance.now() - syncStarted < 840_000) {
                const current = await repository
                    .getRepository(CatalogSyncRule)
                    .findOneByOrFail({ id: rule.id });
                if (pages.at(-1)?.cursor !== current.cursor) {
                    pages.push({ cursor: current.cursor, elapsedMs: performance.now() - syncStarted });
                }
                if (
                    ['COMPLETE', 'PARTIAL'].includes(current.state) &&
                    current.completedGeneration >= rule.generation
                )
                    break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            expect(
                await repository
                    .getRepository(CatalogSyncBinding)
                    .count({ where: { ruleId: rule.id, kind: 'PRODUCT', state: 'ACTIVE' } }),
            ).toBe(10000);
            const mapping = await repository
                .getRepository(CatalogSyncBinding)
                .findOneByOrFail({ ruleId: rule.id, kind: 'COLLECTION' });
            const targetCategory = await repository
                .getRepository(Collection)
                .findOneByOrFail({ id: mapping.targetId });
            expect(JSON.stringify(targetCategory.filters).length).toBeLessThan(1000);
            const measurement = {
                environment: connection.rawConnection.options.type,
                synthetic: true,
                productCount: 10000,
                seedMs: seeded - started,
                previewMs,
                initialSyncMs: performance.now() - syncStarted,
                pages,
                scope: 'real database and services; Worker transport latency measured separately',
            };
            await writeFile(
                resolvePath(
                    __dirname,
                    '../../../docs/local-validation/catalog-continuous-sync-20261015/scale-10000.json',
                ),
                JSON.stringify(measurement, null, 2),
            );
        },
        900_000,
    );
}
