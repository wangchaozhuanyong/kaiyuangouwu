import 'reflect-metadata';

import {
    Asset,
    Collection,
    ForbiddenError,
    Product,
    ProductVariant,
    StockLocation,
    User,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';

function createService(options?: {
    merchant?: boolean;
    channelIds?: string[];
    visibleEntityIds?: string[];
    sharedEntityIds?: string[];
}) {
    const channelIds = options?.channelIds ?? ['store-a'];
    const accessRepository = {
        findOne: vi.fn().mockResolvedValue(options?.merchant === false ? null : { userId: 'user-a' }),
    };
    const userRepository = {
        findOne: vi.fn().mockResolvedValue({
            id: 'user-a',
            roles: [{ channels: channelIds.map(id => ({ id })) }],
        }),
    };
    const visibleEntityIds = options?.visibleEntityIds ?? [];
    const sharedEntityIds = new Set(options?.sharedEntityIds ?? []);
    const connection = {
        getRepository: vi.fn((_ctx, entity) =>
            entity === StoreAdministratorAccess ? accessRepository : userRepository,
        ),
        findByIdsInChannel: vi.fn(async (_ctx, entity, ids: string[]) =>
            ids
                .filter(id => visibleEntityIds.includes(id))
                .map(id => ({
                    id,
                    entity,
                    channels: sharedEntityIds.has(id) ? [{ id: 'store-a' }, { id: 'store-b' }] : [{ id: 'store-a' }],
                })),
        ),
    };
    return {
        connection,
        service: new MerchantCatalogAccessService(connection as any, {
            getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default-channel' }),
        } as any),
    };
}

const merchantContext = {
    apiType: 'admin',
    activeUserId: 'user-a',
    channelId: 'store-a',
} as any;

describe('MerchantCatalogAccessService', () => {
    it('does not restrict platform administrators', async () => {
        const { connection, service } = createService({ merchant: false });

        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'assignProductsToChannel', {
                input: { channelId: 'store-b', productIds: ['product-b'] },
            }),
        ).resolves.toBeUndefined();
        expect(connection.findByIdsInChannel).not.toHaveBeenCalled();
    });

    it('requires a provisioned merchant to use exactly one active Channel', async () => {
        const mismatched = createService({ channelIds: ['store-b'] });
        await expect(
            mismatched.service.assertRootFieldAccess(merchantContext, 'Query', 'products', {}),
        ).rejects.toBeInstanceOf(ForbiddenError);

        const multiple = createService({ channelIds: ['store-a', 'store-b'] });
        await expect(
            multiple.service.assertRootFieldAccess(merchantContext, 'Query', 'products', {}),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('blocks Channel assignment and platform-managed stock-location mutations', async () => {
        const { service } = createService();

        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'assignProductsToChannel', {
                input: { channelId: 'store-a', productIds: ['product-b'] },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateStockLocation', {
                input: { id: 'stock-a', name: 'Changed' },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows creating variants only on an exclusive active-Channel Product', async () => {
        const own = createService({ visibleEntityIds: ['product-a', 'stock-a'] });
        await expect(
            own.service.assertRootFieldAccess(merchantContext, 'Mutation', 'createProductVariants', {
                input: [{ productId: 'product-a', stockLevels: [{ stockLocationId: 'stock-a' }] }],
            }),
        ).resolves.toBeUndefined();
        expect(own.connection.findByIdsInChannel).toHaveBeenCalledWith(
            merchantContext,
            Product,
            ['product-a'],
            'store-a',
            { relations: ['channels'] },
        );

        const foreign = createService({ visibleEntityIds: ['stock-a'] });
        await expect(
            foreign.service.assertRootFieldAccess(merchantContext, 'Mutation', 'createProductVariants', {
                input: [{ productId: 'product-b', stockLevels: [{ stockLocationId: 'stock-a' }] }],
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows the implicit default Channel on a merchant-owned catalog entity', async () => {
        const accessRepository = { findOne: vi.fn().mockResolvedValue({ userId: 'user-a' }) };
        const userRepository = {
            findOne: vi.fn().mockResolvedValue({ roles: [{ channels: [{ id: 'store-a' }] }] }),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StoreAdministratorAccess ? accessRepository : userRepository,
            ),
            findByIdsInChannel: vi.fn().mockResolvedValue([
                { id: 'product-a', channels: [{ id: 'default-channel' }, { id: 'store-a' }] },
            ]),
        };
        const service = new MerchantCatalogAccessService(connection as any, {
            getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default-channel' }),
        } as any);

        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateProduct', {
                input: { id: 'product-a', translations: [] },
            }),
        ).resolves.toBeUndefined();
    });

    it('rejects foreign stock locations and shared catalog entities', async () => {
        const foreignStock = createService({ visibleEntityIds: ['variant-a'] });
        await expect(
            foreignStock.service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateProductVariant', {
                input: { id: 'variant-a', stockLevels: [{ stockLocationId: 'stock-b' }] },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(foreignStock.connection.findByIdsInChannel).toHaveBeenCalledWith(
            merchantContext,
            StockLocation,
            ['stock-b'],
            'store-a',
            {},
        );

        const shared = createService({ visibleEntityIds: ['asset-shared'], sharedEntityIds: ['asset-shared'] });
        await expect(
            shared.service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateAsset', {
                input: { id: 'asset-shared' },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(shared.connection.findByIdsInChannel).toHaveBeenCalledWith(
            merchantContext,
            Asset,
            ['asset-shared'],
            'store-a',
            { relations: ['channels'] },
        );
    });

    it('validates both the target and parent when moving a collection', async () => {
        const ownTree = createService({
            visibleEntityIds: ['collection-a', 'root-collection'],
            sharedEntityIds: ['root-collection'],
        });
        await expect(
            ownTree.service.assertRootFieldAccess(merchantContext, 'Mutation', 'moveCollection', {
                input: { collectionId: 'collection-a', parentId: 'root-collection', index: 0 },
            }),
        ).resolves.toBeUndefined();
        expect(ownTree.connection.findByIdsInChannel).toHaveBeenCalledWith(
            merchantContext,
            Collection,
            ['collection-a'],
            'store-a',
            { relations: ['channels'] },
        );
        expect(ownTree.connection.findByIdsInChannel).toHaveBeenCalledWith(
            merchantContext,
            Collection,
            ['root-collection'],
            'store-a',
            {},
        );

        const foreignParent = createService({ visibleEntityIds: ['collection-a'] });
        await expect(
            foreignParent.service.assertRootFieldAccess(merchantContext, 'Mutation', 'moveCollection', {
                input: { collectionId: 'collection-a', parentId: 'collection-b', index: 0 },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows updating an exclusive active-Channel variant without stock changes', async () => {
        const { connection, service } = createService({ visibleEntityIds: ['variant-a'] });

        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateProductVariant', {
                input: { id: 'variant-a', price: 1999 },
            }),
        ).resolves.toBeUndefined();
        expect(connection.findByIdsInChannel).toHaveBeenCalledWith(
            merchantContext,
            ProductVariant,
            ['variant-a'],
            'store-a',
            { relations: ['channels'] },
        );
    });
});
