import 'reflect-metadata';

import {
    Collection,
    ForbiddenError,
    Fulfillment,
    Order,
    OrderLine,
    Payment,
    Product,
    ProductVariant,
    Refund,
    StockLocation,
    User,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { AdministratorAccessProfile } from './entities/administrator-access-profile.entity';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreCouponCampaignConfig } from './entities/store-coupon-campaign-config.entity';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';

function createService(options?: {
    merchant?: boolean;
    couponConfigs?: Array<{ promotionId: string; channelId: string }>;
    channelIds?: string[];
    visibleEntityIds?: string[];
    sharedEntityIds?: string[];
    orderLines?: Array<{ id: string; order: { salesChannelId: string; channels?: Array<{ id: string }> } }>;
    fulfillments?: Array<{
        id: string;
        orders: Array<{ salesChannelId: string; channels?: Array<{ id: string }> }>;
    }>;
    payments?: Array<{ id: string; order: { salesChannelId: string } }>;
    refunds?: Array<{ id: string; payment: { order: { salesChannelId: string } } }>;
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
    const orderLineRepository = { find: vi.fn().mockResolvedValue(options?.orderLines ?? []) };
    const fulfillmentRepository = { find: vi.fn().mockResolvedValue(options?.fulfillments ?? []) };
    const paymentRepository = { find: vi.fn().mockResolvedValue(options?.payments ?? []) };
    const refundRepository = { find: vi.fn().mockResolvedValue(options?.refunds ?? []) };
    const connection = {
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === StoreCouponCampaignConfig)
                return { find: vi.fn().mockResolvedValue(options?.couponConfigs ?? []) };
            if (entity === StoreAdministratorAccess) return accessRepository;
            if (entity === AdministratorAccessProfile)
                return {
                    findOne: vi
                        .fn()
                        .mockResolvedValue(
                            options?.merchant === false || channelIds.length !== 1
                                ? null
                                : { userId: 'user-a', scope: 'STORE', channelId: channelIds[0] },
                        ),
                };
            if (entity === User) return userRepository;
            if (entity === Order) return { count: vi.fn().mockResolvedValue(visibleEntityIds.length) };
            if (entity === OrderLine) return orderLineRepository;
            if (entity === Fulfillment) return fulfillmentRepository;
            if (entity === Payment) return paymentRepository;
            if (entity === Refund) return refundRepository;
            throw new Error(`Unexpected repository: ${String(entity)}`);
        }),
        getEntityOrThrow: vi.fn().mockResolvedValue({ id: 'variant-a', productId: 'product-a' }),
        findByIdsInChannel: vi.fn((_ctx, entity, ids: string[]) =>
            ids
                .filter(id => visibleEntityIds.includes(id))
                .map(id => ({
                    id,
                    entity,
                    channels: sharedEntityIds.has(id)
                        ? [{ id: 'store-a' }, { id: 'store-b' }]
                        : [{ id: 'store-a' }],
                })),
        ),
    };
    return {
        connection,
        fulfillmentRepository,
        orderLineRepository,
        service: new MerchantCatalogAccessService(
            connection as any,
            {
                getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default-channel' }),
            } as any,
            {
                assertOwned: vi.fn((_ctx, _type, id) => {
                    if (sharedEntityIds.has(id)) {
                        if (_type !== 'Product') throw new ForbiddenError();
                        throw new Error('该历史共享商品需先完成店铺归属迁移');
                    }
                    return Promise.resolve({ ownerChannelId: 'store-a', scope: 'STORE' });
                }),
            } as any,
        ),
    };
}

const merchantContext = {
    apiType: 'admin',
    activeUserId: 'user-a',
    channelId: 'store-a',
    channel: { code: 'store-a' },
    userHasPermissions: vi.fn().mockReturnValue(false),
} as any;

describe('MerchantCatalogAccessService', () => {
    it.each([
        ['Query', 'imageProviderAdminConfigs'],
        ['Mutation', 'saveImageProviderCredential'],
        ['Mutation', 'testImageProviderCredential'],
        ['Query', 'icloudPrimaryAccounts'],
        ['Query', 'icloudReceivedMails'],
        ['Mutation', 'resetIcloudVirtualEmailCode'],
    ])(
        'protects shared owner resources at %s.%s from store and legacy delegated roles',
        async (type, field) => {
            const { service, connection } = createService({ merchant: false });
            const platform = { ...merchantContext, channel: { code: '__default_channel__' } };
            await expect(
                service.assertRootFieldAccess(
                    { ...merchantContext, userHasPermissions: () => true },
                    type,
                    field,
                    {},
                ),
            ).rejects.toThrow('平台管理中心');
            await expect(service.assertRootFieldAccess(platform, type, field, {})).rejects.toThrow(
                '超级管理员',
            );
            await expect(
                service.assertRootFieldAccess(
                    { ...platform, userHasPermissions: () => true },
                    type,
                    field,
                    {},
                ),
            ).resolves.toBeUndefined();
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );
    it.each([
        ['Mutation', 'updateTaxRate'],
        ['Mutation', 'addMembersToZone'],
        ['Mutation', 'deleteCountries'],
        ['Query', 'dataRetentionRecords'],
        ['Mutation', 'setDataRetentionLegalHold'],
        ['Query', 'dataSubjectRequests'],
        ['Mutation', 'retryDataSubjectRequest'],
    ])(
        'keeps global dictionary and privacy administration in the management center at %s.%s',
        async (type, field) => {
            const { service, connection } = createService({ merchant: false });
            await expect(
                service.assertRootFieldAccess(
                    { ...merchantContext, userHasPermissions: () => true },
                    type,
                    field,
                    {},
                ),
            ).rejects.toThrow('平台管理中心');
            expect(connection.getRepository).not.toHaveBeenCalled();
            await expect(
                service.assertRootFieldAccess(
                    { ...merchantContext, channel: { code: '__default_channel__' } },
                    type,
                    field,
                    {},
                ),
            ).resolves.toBeUndefined();
        },
    );
    it.each(['imageGenerationJobs', 'imageAiUsageRecords', 'countries', 'taxCategories'])(
        'preserves scoped business usage and shared dictionary reads for %s',
        async field => {
            const { service } = createService({ merchant: false });
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Query', field, {}),
            ).resolves.toBeUndefined();
        },
    );
    it('preserves authenticated customer closure and public mailbox access through Shop API', async () => {
        const { service, connection } = createService();
        const ctx = { ...merchantContext, apiType: 'shop' };
        await expect(
            service.assertRootFieldAccess(ctx, 'Mutation', 'requestMyAccountClosure', {}),
        ).resolves.toBeUndefined();
        await expect(
            service.assertRootFieldAccess(ctx, 'Query', 'icloudQueryMails', {}),
        ).resolves.toBeUndefined();
        expect(connection.getRepository).not.toHaveBeenCalled();
    });
    it.each([
        'jobs',
        'storePaymentStats',
        'systemAnnouncements',
        'telegramNotificationDeliveries',
        'governanceApprovals',
    ])('rejects platform %s from a store context even for SuperAdmin', async fieldName => {
        const { service, connection } = createService({ merchant: false });
        const superInStore = { ...merchantContext, userHasPermissions: () => true };
        await expect(service.assertRootFieldAccess(superInStore, 'Query', fieldName, {})).rejects.toThrow(
            '平台管理中心',
        );
        expect(connection.getRepository).not.toHaveBeenCalled();
    });
    it.each(['createPaymentMethod', 'updatePaymentMethod', 'deletePaymentMethod', 'deletePaymentMethods'])(
        'requires platform context and SuperAdmin for %s',
        async fieldName => {
            const { service } = createService({ merchant: false });
            await expect(
                service.assertRootFieldAccess(
                    { ...merchantContext, userHasPermissions: () => true },
                    'Mutation',
                    fieldName,
                    {},
                ),
            ).rejects.toThrow('支付系统配置');
            const platform = {
                ...merchantContext,
                channel: { code: '__default_channel__' },
                userHasPermissions: () => false,
            };
            await expect(service.assertRootFieldAccess(platform, 'Mutation', fieldName, {})).rejects.toThrow(
                '支付系统配置',
            );
            await expect(
                service.assertRootFieldAccess(
                    { ...platform, userHasPermissions: () => true },
                    'Mutation',
                    fieldName,
                    {},
                ),
            ).resolves.toBeUndefined();
        },
    );
    it('preserves platform queue access and current-store payment statistics', async () => {
        const { service } = createService({ merchant: false });
        await expect(
            service.assertRootFieldAccess(
                { ...merchantContext, channel: { code: '__default_channel__' } },
                'Query',
                'jobs',
                {},
            ),
        ).resolves.toBeUndefined();
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Query', 'myStorePaymentStats', {}),
        ).resolves.toBeUndefined();
    });
    it.each(['adminBeginLogin', 'adminCompleteTwoFactorLogin'])(
        'allows public %s even when an old merchant session has another active Channel',
        async fieldName => {
            const { connection, service } = createService({ channelIds: ['store-b'] });
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Mutation', fieldName, {}),
            ).resolves.toBeUndefined();
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it.each(['store-a', 'store-b'])(
        'requires platform coupon operations to use the managed entry for %s',
        async channelId => {
            const { service } = createService({
                merchant: false,
                couponConfigs: [{ promotionId: 'coupon-1', channelId }],
            });
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Mutation', 'updatePromotion', {
                    input: { id: 'coupon-1', enabled: false },
                }),
            ).rejects.toThrow('优惠券管理入口');
        },
    );

    it('preserves ordinary platform promotion editing', async () => {
        const { service } = createService({ merchant: false });
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'updatePromotion', {
                input: { id: 'ordinary-promotion' },
            }),
        ).resolves.toBeUndefined();
    });

    it.each([
        'assignAssetsToChannel',
        'assignCollectionsToChannel',
        'assignFacetsToChannel',
        'assignProductOptionGroupsToChannel',
        'assignProductsToChannel',
        'assignProductVariantsToChannel',
    ])('blocks platform administrators from sharing records via %s', async fieldName => {
        const { connection, service } = createService({ merchant: false });

        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', fieldName, {
                input: { channelId: 'store-b', productIds: ['product-b'] },
            }),
        ).rejects.toThrow('平台商品分配中心');
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

    it('blocks cross-store assignment and platform-managed stock-location mutations', async () => {
        const { service } = createService();

        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'assignProductsToChannel', {
                input: { channelId: 'store-a', productIds: ['product-b'] },
            }),
        ).rejects.toThrow('平台商品分配中心');
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateStockLocation', {
                input: { id: 'stock-a', name: 'Changed' },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('requires merchants to use the managed promotion mutations', async () => {
        const { service } = createService();

        for (const fieldName of [
            'createPromotion',
            'updatePromotion',
            'deletePromotion',
            'deletePromotions',
        ]) {
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Mutation', fieldName, {
                    id: 'promotion-a',
                    input: { id: 'promotion-a' },
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);
        }
    });

    it('reserves advanced order administration and sensitive finance without explicit permission', async () => {
        const { service } = createService();

        for (const fieldName of ['settlePayment', 'refundOrder']) {
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Mutation', fieldName, {
                    id: 'foreign-id',
                    input: { id: 'foreign-id', orderId: 'foreign-id' },
                }),
            ).rejects.toThrow('敏感店铺财务权限');
        }
        for (const fieldName of [
            'modifyOrder',
            'adjustDraftOrderLine',
            'updateOrderNote',
            'deleteOrderNote',
        ]) {
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Mutation', fieldName, {
                    id: 'foreign-id',
                    input: { id: 'foreign-id', orderId: 'foreign-id' },
                }),
            ).rejects.toBeInstanceOf(ForbiddenError);
        }
    });

    it('allows scoped cancellation and state changes for the active store', async () => {
        const own = createService({ visibleEntityIds: ['order-a'] });
        await expect(
            own.service.assertRootFieldAccess(merchantContext, 'Mutation', 'cancelOrder', {
                input: { orderId: 'order-a' },
            }),
        ).resolves.toBeUndefined();
        await expect(
            own.service.assertRootFieldAccess(merchantContext, 'Mutation', 'transitionOrderToState', {
                id: 'order-a',
                state: 'Shipped',
            }),
        ).resolves.toBeUndefined();

        const foreign = createService({ visibleEntityIds: [] });
        await expect(
            foreign.service.assertRootFieldAccess(merchantContext, 'Mutation', 'cancelOrder', {
                input: { orderId: 'order-b' },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows explicitly authorized sensitive finance only for this store', async () => {
        const sensitiveContext = {
            ...merchantContext,
            userHasPermissions: vi.fn().mockReturnValue(true),
        };
        const own = createService({ payments: [{ id: 'payment-a', order: { salesChannelId: 'store-a' } }] });
        await expect(
            own.service.assertRootFieldAccess(sensitiveContext, 'Mutation', 'settlePayment', {
                id: 'payment-a',
            }),
        ).resolves.toBeUndefined();

        const foreign = createService({
            payments: [{ id: 'payment-b', order: { salesChannelId: 'store-b' } }],
        });
        await expect(
            foreign.service.assertRootFieldAccess(sensitiveContext, 'Mutation', 'settlePayment', {
                id: 'payment-b',
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('allows fulfillment and note operations only for the active Channel', async () => {
        const own = createService({
            visibleEntityIds: ['order-a'],
            orderLines: [
                { id: 'line-a', order: { salesChannelId: 'store-a', channels: [{ id: 'store-a' }] } },
            ],
            fulfillments: [
                {
                    id: 'fulfillment-a',
                    orders: [{ salesChannelId: 'store-a', channels: [{ id: 'store-a' }] }],
                },
            ],
        });

        await expect(
            own.service.assertRootFieldAccess(merchantContext, 'Mutation', 'addFulfillmentToOrder', {
                input: { lines: [{ orderLineId: 'line-a' }] },
            }),
        ).resolves.toBeUndefined();
        await expect(
            own.service.assertRootFieldAccess(merchantContext, 'Mutation', 'transitionFulfillmentToState', {
                id: 'fulfillment-a',
                state: 'Shipped',
            }),
        ).resolves.toBeUndefined();
        await expect(
            own.service.assertRootFieldAccess(merchantContext, 'Mutation', 'addNoteToOrder', {
                input: { id: 'order-a', note: 'Packed', isPublic: false },
            }),
        ).resolves.toBeUndefined();

        expect(own.orderLineRepository.find).toHaveBeenCalledWith({
            where: [{ id: 'line-a' }],
            relations: ['order'],
        });
        expect(own.fulfillmentRepository.find).toHaveBeenCalledWith({
            where: [{ id: 'fulfillment-a' }],
            relations: ['orders'],
        });
        const foreign = createService({
            visibleEntityIds: [],
            orderLines: [
                {
                    id: 'line-b',
                    order: { salesChannelId: 'store-b', channels: [{ id: 'store-a' }, { id: 'store-b' }] },
                },
            ],
            fulfillments: [
                {
                    id: 'fulfillment-b',
                    orders: [{ salesChannelId: 'store-b', channels: [{ id: 'store-a' }, { id: 'store-b' }] }],
                },
            ],
        });
        await expect(
            foreign.service.assertRootFieldAccess(merchantContext, 'Mutation', 'addFulfillmentToOrder', {
                input: { lines: [{ orderLineId: 'line-b' }] },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(
            foreign.service.assertRootFieldAccess(
                merchantContext,
                'Mutation',
                'transitionFulfillmentToState',
                {
                    id: 'fulfillment-b',
                    state: 'Shipped',
                },
            ),
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(
            foreign.service.assertRootFieldAccess(merchantContext, 'Mutation', 'addNoteToOrder', {
                input: { id: 'order-b', note: 'Forbidden', isPublic: false },
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
        ).rejects.toThrow('属于其他店铺');
    });

    it('treats a default-store assignment as sharing when checking merchant edit access', async () => {
        const accessRepository = { findOne: vi.fn().mockResolvedValue({ userId: 'user-a' }) };
        const userRepository = {
            findOne: vi
                .fn()
                .mockResolvedValue({ roles: [{ salesChannelId: 'store-a', channels: [{ id: 'store-a' }] }] }),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) =>
                entity === StoreAdministratorAccess ? accessRepository : userRepository,
            ),
            findByIdsInChannel: vi
                .fn()
                .mockResolvedValue([
                    { id: 'product-a', channels: [{ id: 'default-channel' }, { id: 'store-a' }] },
                ]),
        };
        const service = new MerchantCatalogAccessService(
            connection as any,
            {
                getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default-channel' }),
            } as any,
            {
                assertOwned: vi.fn().mockRejectedValue(new Error('该历史共享商品需先完成店铺归属迁移')),
            } as any,
        );

        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateProduct', {
                input: { id: 'product-a', translations: [] },
            }),
        ).rejects.toThrow('历史共享商品需先完成店铺归属迁移');
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

        const shared = createService({
            visibleEntityIds: ['asset-shared'],
            sharedEntityIds: ['asset-shared'],
        });
        await expect(
            shared.service.assertRootFieldAccess(merchantContext, 'Mutation', 'updateAsset', {
                input: { id: 'asset-shared' },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(shared.connection.findByIdsInChannel).not.toHaveBeenCalled();
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
