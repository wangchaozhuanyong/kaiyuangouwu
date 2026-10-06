import {
    CatalogResourceOwnership,
    ProductSalesAuthorization,
    ProductVariant,
    RequestContextCacheService,
} from '@vendure/core';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { AutoCardSupplyService } from './auto-card-supply.service';
import { AutoCardService } from './auto-card.service';
import { DigitalProductService } from './digital-product.service';
import { AutoCardConfig } from './entities/auto-card-config.entity';
import { AutoCardPoolItem } from './entities/auto-card-pool-item.entity';
import { AutoCardSupplyGrant } from './entities/auto-card-supply-grant.entity';
import { DigitalVariantConfig } from './entities/digital-product.entity';

type Row = Record<string, any>;
const request = () => ({ channelId: 'A', apiType: 'shop' }) as any;
function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object' && value._type === 'in')
            return value._value.map(String).includes(String(row[key]));
        if (value && typeof value === 'object')
            return Array.isArray(row[key])
                ? row[key].some((item: Row) => matches(item, value))
                : matches(row[key] ?? {}, value);
        return row[key] === value;
    });
}

function fixture(rows: Map<unknown, Row[]>) {
    const reads: string[] = [];
    const findRows = (entity: { name: string }) =>
        vi.fn(({ where }: { where: Row | Row[] }) => {
            reads.push(entity.name);
            return Promise.resolve(
                (rows.get(entity) ?? []).filter(row =>
                    (Array.isArray(where) ? where : [where]).some(part => matches(row, part)),
                ),
            );
        });
    const connection = {
        getRepository: (_ctx: unknown, entity: { name: string }) => ({
            find: findRows(entity),
            manager: { getRepository: (target: { name: string }) => ({ find: findRows(target) }) },
            createQueryBuilder: () => {
                let ids: string[] = [];
                const query = {
                    select: () => query,
                    addSelect: () => query,
                    andWhere: () => query,
                    groupBy: () => query,
                    where: (_sql: string, parameters: { ids: string[] }) => {
                        ids = parameters.ids;
                        return query;
                    },
                    getRawMany: () => {
                        reads.push(`${entity.name}:count`);
                        return Promise.resolve(
                            ids.map(configId => ({
                                configId,
                                available: (rows.get(entity) ?? []).filter(
                                    row => row.configId === configId && row.state === 'AVAILABLE',
                                ).length,
                            })),
                        );
                    },
                };
                return query;
            },
        }),
    };
    const cache = new RequestContextCacheService();
    const supply = new AutoCardSupplyService(connection as any, {} as any, {} as any, cache);
    const cards = Object.assign(Object.create(AutoCardService.prototype), {
        connection,
        supply,
        requestCache: cache,
    }) as AutoCardService;
    const digital = new DigitalProductService(connection as any, {} as any, {} as any, cache);
    return { reads, supply, cards, digital };
}

function ownedRows(size: number) {
    const rows = new Map<unknown, Row[]>();
    const variants: Row[] = Array.from({ length: size }, (_, i) => ({
        id: `v${i}`,
        productId: `p${Math.floor(i / 3)}`,
        channels: [{ id: 'A' }],
        customFields: { fulfillmentType: 'digital' },
    }));
    rows.set(ProductVariant, variants);
    rows.set(
        CatalogResourceOwnership,
        Array.from({ length: Math.ceil(size / 3) }, (_, i) => ({
            resourceType: 'Product',
            resourceId: `p${i}`,
            ownerChannelId: 'A',
        })),
    );
    rows.set(
        AutoCardConfig,
        variants.map(variant => ({
            id: `c${variant.id}`,
            channelId: 'A',
            productVariantId: variant.id,
            enabled: true,
        })),
    );
    rows.set(
        AutoCardPoolItem,
        variants.flatMap(variant => [
            { configId: `c${variant.id}`, state: 'AVAILABLE' },
            { configId: `c${variant.id}`, state: 'ASSIGNED' },
        ]),
    );
    return { rows, variants };
}

describe('digital catalog batched display reads', () => {
    it.each([12, 48])(
        '%i products with 3 SKUs use 5 fixed repository operations for card availability',
        async products => {
            const { rows, variants } = ownedRows(products * 3);
            const { cards, reads } = fixture(rows);
            const ctx = request();
            expect(
                await Promise.all(
                    variants.map(variant => cards.availableStockForDisplay(ctx, variant as any)),
                ),
            ).toEqual(Array(products * 3).fill(1));
            expect(reads).toEqual([
                'ProductVariant',
                'CatalogResourceOwnership',
                'ProductSalesAuthorization',
                'AutoCardConfig',
                'AutoCardPoolItem:count',
            ]);
            await cards.availableStockForDisplay(ctx, variants[0] as any);
            expect(reads).toHaveLength(5);
        },
    );

    it('skips all card queries only for positively identified physical products', async () => {
        const { cards, reads } = fixture(new Map());
        expect(
            await cards.availableStockForDisplay(request(), {
                id: 'physical',
                customFields: { fulfillmentType: 'physical' },
                product: { customFields: { fulfillmentType: 'physical' } },
            } as any),
        ).toBeNull();
        expect(reads).toHaveLength(0);
        await cards.availableStockForDisplay(request(), {
            id: 'legacy',
            customFields: { fulfillmentType: 'physical' },
        } as any);
        expect(reads).toEqual(['ProductVariant']);
    });

    it('keeps active sale, pending SKU, owner, source, config and channel restrictions', async () => {
        const { rows, variants } = ownedRows(9);
        rows.set(CatalogResourceOwnership, [
            { resourceType: 'Product', resourceId: 'p0', ownerChannelId: 'B' },
            { resourceType: 'Product', resourceId: 'p1', ownerChannelId: 'B' },
            { resourceType: 'Product', resourceId: 'p2', ownerChannelId: 'B' },
        ]);
        rows.set(ProductSalesAuthorization, [
            {
                productId: 'p0',
                channelId: 'A',
                state: 'ACTIVE',
                variantIds: ['v0', 'v1'],
                pendingVariantIds: ['v1'],
            },
            { productId: 'p1', channelId: 'A', state: 'REVOKED', variantIds: ['v3', 'v4', 'v5'] },
            { productId: 'p2', channelId: 'A', state: 'ACTIVE', variantIds: ['v6', 'v7', 'v8'] },
        ]);
        rows.set(
            AutoCardSupplyGrant,
            variants.map(variant => ({
                channelId: 'A',
                sourceChannelId: variant.id === 'v6' ? 'C' : 'B',
                productVariantId: variant.id,
                configId: `c${variant.id}`,
                enabled: variant.id !== 'v7',
            })),
        );
        const configurations = rows.get(AutoCardConfig);
        if (!configurations) throw new Error('Missing auto-card configuration fixture');
        for (const config of configurations) config.channelId = config.productVariantId === 'v8' ? 'C' : 'B';
        const { supply } = fixture(rows);
        const result = await Promise.all(
            variants.map(variant => supply.resolveForDisplay(request(), variant.id)),
        );
        expect(result.map(source => source?.config.id ?? null)).toEqual([
            'cv0',
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
        ]);
    });

    it('only allows the single-operating-store legacy fallback and does not cache transaction resolution', async () => {
        const { rows, variants } = ownedRows(3);
        rows.set(CatalogResourceOwnership, []);
        variants[0].product = {
            channels: [
                { id: 'default', code: '__default_channel__' },
                { id: 'A', code: 'store-a' },
            ],
        };
        variants[1].product = {
            channels: [
                { id: 'A', code: 'store-a' },
                { id: 'B', code: 'store-b' },
            ],
        };
        variants[2].product = { channels: [{ id: 'B', code: 'store-b' }] };
        const { supply } = fixture(rows);
        const ctx = request();
        expect(
            (await Promise.all(variants.map(variant => supply.resolveForDisplay(ctx, variant.id)))).map(
                source => source?.config.id ?? null,
            ),
        ).toEqual(['cv0', null, null]);
        const configurations = rows.get(AutoCardConfig);
        if (!configurations) throw new Error('Missing auto-card configuration fixture');
        configurations[0].enabled = false;
        expect(await supply.resolve(ctx, 'v0')).toBeNull();
        expect(await supply.resolveForDisplay(request(), 'v0')).toBeNull();
    });

    it.each([12, 48])(
        '%i migrated pool-derived products batch config and counts and share metadata reads',
        async products => {
            const { rows, variants } = ownedRows(products * 3);
            rows.set(
                DigitalVariantConfig,
                variants.map(variant => ({
                    channelId: 'A',
                    productVariantId: variant.id,
                    migrationState: 'ACTIVE',
                    stockPolicy: 'pool_derived',
                    deliveryMode: 'auto_card',
                })),
            );
            const { digital, reads } = fixture(rows);
            const ctx = request();
            const [stock, metadata] = await Promise.all([
                Promise.all(variants.map(variant => digital.availableForDisplay(ctx, variant as any))),
                Promise.all(variants.map(variant => digital.configForDisplay(ctx, variant.id))),
            ]);
            expect(stock).toEqual(Array(products * 3).fill(1));
            expect(metadata.every(config => config?.deliveryMode === 'auto_card')).toBe(true);
            expect(reads).toEqual(['DigitalVariantConfig', 'AutoCardConfig', 'AutoCardPoolItem:count']);
        },
    );

    it('retains unlimited/null, limited quantities, physical/undefined and unmigrated fallback', async () => {
        const { rows, variants } = ownedRows(3);
        rows.set(DigitalVariantConfig, [
            { channelId: 'A', productVariantId: 'v0', migrationState: 'ACTIVE', stockPolicy: 'unlimited' },
            {
                channelId: 'A',
                productVariantId: 'v1',
                migrationState: 'ACTIVE',
                stockPolicy: 'limited',
                availableQuantity: 4,
            },
        ]);
        const { digital } = fixture(rows);
        const ctx = request();
        expect(
            await Promise.all(variants.map(variant => digital.availableForDisplay(ctx, variant as any))),
        ).toEqual([null, 4, undefined]);
        expect(
            await digital.availableForDisplay(ctx, { customFields: { fulfillmentType: 'physical' } } as any),
        ).toBeUndefined();
    });
});
