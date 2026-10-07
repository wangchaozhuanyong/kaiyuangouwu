import 'reflect-metadata';

import {
    API_KEY_AUTH_STRATEGY_NAME,
    Channel,
    Collection,
    ForbiddenError,
    Fulfillment,
    Order,
    OrderLine,
    Payment,
    Permission,
    Product,
    ProductVariant,
    Refund,
    RequestContext,
    StockLocation,
    User,
} from '@vendure/core';
import { DataSource, EntitySchema } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hasMachineMailboxAccess } from './constants';
import { AdministratorAccessProfile } from './entities/administrator-access-profile.entity';
import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import { StoreCouponCampaignConfig } from './entities/store-coupon-campaign-config.entity';
import { MerchantCatalogAccessService } from './merchant-catalog-access.service';

function createService(options?: {
    merchant?: boolean;
    commerceMode?: string | null;
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
            if (entity === Channel)
                return {
                    findOne: vi.fn().mockResolvedValue({
                        id: 'store-a',
                        customFields: {
                            commerceMode:
                                options?.commerceMode === undefined ? 'HYBRID' : options.commerceMode,
                        },
                    }),
                };
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
            if (entity === Order)
                return {
                    count: vi.fn(({ where }) =>
                        Promise.resolve(
                            (where.id.value as string[]).filter(id => visibleEntityIds.includes(id)).length,
                        ),
                    ),
                };
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
    channel: { code: 'store-a', customFields: { commerceMode: 'HYBRID' } },
    userHasPermissions: vi.fn().mockReturnValue(false),
} as any;

// Independent contract fixtures checked against the mailbox resolver's @Allow.
const mailboxRootPermissions = [
    ['Query', 'icloudPrimaryAccounts', 'ReadIcloudRelay'],
    ['Query', 'icloudPrimaryAccount', 'ReadIcloudRelay'],
    ['Query', 'icloudVirtualEmails', 'ReadIcloudRelay'],
    ['Query', 'icloudVirtualEmail', 'ReadIcloudRelay'],
    ['Query', 'icloudReceivedMails', 'ReadIcloudRelay'],
    ['Mutation', 'createIcloudPrimaryAccount', 'CreateIcloudRelay'],
    ['Mutation', 'createIcloudVirtualEmail', 'CreateIcloudRelay'],
    ['Mutation', 'batchCreateIcloudVirtualEmails', 'CreateIcloudRelay'],
    ['Mutation', 'reconcileIcloudMailHistory', 'UpdateIcloudRelay'],
    ['Mutation', 'updateIcloudPrimaryAccount', 'UpdateIcloudRelay'],
    ['Mutation', 'testIcloudConnection', 'UpdateIcloudRelay'],
    ['Mutation', 'syncIcloudAccount', 'UpdateIcloudRelay'],
    ['Mutation', 'resetIcloudMasterCode', 'UpdateIcloudRelay'],
    ['Mutation', 'updateIcloudVirtualEmail', 'UpdateIcloudRelay'],
    ['Mutation', 'resetIcloudVirtualEmailCode', 'UpdateIcloudRelay'],
    ['Mutation', 'reassignIcloudMail', 'UpdateIcloudRelay'],
    ['Mutation', 'deleteIcloudPrimaryAccount', 'DeleteIcloudRelay'],
    ['Mutation', 'deleteIcloudVirtualEmail', 'DeleteIcloudRelay'],
    ['Mutation', 'deleteIcloudMail', 'DeleteIcloudRelay'],
] as const;
const mailboxCrudPermissions = [
    'ReadIcloudRelay',
    'CreateIcloudRelay',
    'UpdateIcloudRelay',
    'DeleteIcloudRelay',
] as const;

function mailboxMachineContext(permissions: readonly string[]) {
    const permissionMock = vi.fn((requested: Permission[]) =>
        requested.some(permission => permissions.includes(permission)),
    );
    return {
        ...merchantContext,
        session: { authenticationStrategy: API_KEY_AUTH_STRATEGY_NAME },
        channel: { code: '__default_channel__' },
        userHasPermissions: permissionMock,
        permissionMock,
    } as RequestContext & { permissionMock: typeof permissionMock };
}

describe('MerchantCatalogAccessService', () => {
    it.each(
        mailboxRootPermissions.flatMap(([parentType, fieldName, requiredPermission]) =>
            mailboxCrudPermissions.map(grantedPermission => ({
                parentType,
                fieldName,
                requiredPermission,
                grantedPermission,
            })),
        ),
    )(
        'enforces $requiredPermission for $parentType.$fieldName with only $grantedPermission',
        async ({ parentType, fieldName, requiredPermission, grantedPermission }) => {
            const { service, connection } = createService({ merchant: false });
            const ctx = mailboxMachineContext([grantedPermission]);
            const result = service.assertRootFieldAccess(ctx, parentType, fieldName, {});
            if (requiredPermission === grantedPermission) {
                await expect(result).resolves.toBeUndefined();
            } else {
                await expect(result).rejects.toMatchObject({
                    extensions: { code: 'USER_INPUT_ERROR' },
                });
            }
            expect(ctx.permissionMock).toHaveBeenCalledWith([requiredPermission]);
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it.each(mailboxRootPermissions)(
        'rejects non-default mailbox machine context at %s.%s',
        async (parentType, fieldName, permission) => {
            const { service, connection } = createService({ merchant: false });
            const ctx = mailboxMachineContext([permission, Permission.SuperAdmin]);
            const store = { ...ctx, channel: { code: 'store-a' } } as unknown as RequestContext;
            await expect(service.assertRootFieldAccess(store, parentType, fieldName, {})).rejects.toThrow(
                '平台管理中心',
            );
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it.each(mailboxRootPermissions)(
        'keeps native delegated permission restricted at %s.%s',
        async (parentType, fieldName, permission) => {
            const { service, connection } = createService({ merchant: false });
            const ctx = mailboxMachineContext([permission]);
            const native = {
                ...ctx,
                session: { authenticationStrategy: 'native' },
            } as unknown as RequestContext;
            await expect(service.assertRootFieldAccess(native, parentType, fieldName, {})).rejects.toThrow(
                '超级管理员',
            );
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );

    it.each([
        ['Query', 'imageProviderAdminConfigs'],
        ['Query', 'imagePromptRoutingConfig'],
        ['Query', 'imagePromptModelConfigs'],
        ['Mutation', 'saveImageProviderCredential'],
        ['Mutation', 'saveImagePromptRoutingConfig'],
        ['Mutation', 'testImagePromptRoute'],
        ['Mutation', 'testImageProviderConnection'],
        ['Mutation', 'testImageProviderCredential'],
        ['Mutation', 'archiveImageProviderCredential'],
        ['Mutation', 'activateImagePromptSkillRelease'],
        ['Mutation', 'saveImagePromptModel'],
        ['Mutation', 'testImagePromptModel'],
        ['Mutation', 'archiveImagePromptModel'],
        ['Mutation', 'anonymizeImageGenerationCustomerData'],
    ])('preserves non-mailbox owner protection at %s.%s', async (parentType, fieldName) => {
        const { service, connection } = createService({ merchant: false });
        const ctx = mailboxMachineContext(mailboxCrudPermissions);
        expect(hasMachineMailboxAccess(ctx, `${parentType}.${fieldName}`)).toBe(false);
        await expect(service.assertRootFieldAccess(ctx, parentType, fieldName, {})).rejects.toThrow(
            '超级管理员',
        );
        expect(connection.getRepository).not.toHaveBeenCalled();
    });

    it.each([
        ['no session', { session: undefined }],
        ['native session', { session: { authenticationStrategy: 'native' } }],
        ['another strategy', { session: { authenticationStrategy: 'oauth' } }],
        ['no authenticated user', { activeUserId: undefined }],
        ['Shop API', { apiType: 'shop' }],
        ['non-default channel', { channel: { code: 'store-a' } }],
    ])('does not grant a mailbox machine exception with %s', (_label, override) => {
        const ctx = { ...mailboxMachineContext(['ReadIcloudRelay']), ...override } as ReturnType<
            typeof mailboxMachineContext
        >;
        expect(hasMachineMailboxAccess(ctx, 'Query.icloudPrimaryAccounts')).toBe(false);
        expect(ctx.permissionMock).not.toHaveBeenCalled();
    });

    it.each([
        'Query.icloudPrimaryAccountsExtra',
        'Mutation.icloudPrimaryAccounts',
        'Query.createIcloudPrimaryAccount',
        'Query.icloudQueryMails',
        'Query.activeChannel',
    ])('does not match an unrelated root field %s', rootField => {
        const ctx = mailboxMachineContext(mailboxCrudPermissions);
        expect(hasMachineMailboxAccess(ctx, rootField)).toBe(false);
        expect(ctx.permissionMock).not.toHaveBeenCalled();
    });

    it.each([
        ['matching channel', 'default-channel', ['ReadIcloudRelay'], true],
        ['other channel', 'store-a', ['ReadIcloudRelay'], false],
        ['no mailbox permission', 'default-channel', [], false],
        ['SuperAdmin-only', 'default-channel', [Permission.SuperAdmin], false],
    ] as const)(
        'checks actual RequestContext channel permissions for %s',
        (_label, permissionsChannelId, permissions, expected) => {
            const ctx = new RequestContext({
                apiType: 'admin',
                channel: new Channel({ id: 'default-channel', code: '__default_channel__' }),
                session: {
                    id: 'fixture-session',
                    token: 'fixture-session-token',
                    cacheExpiry: 0,
                    expires: new Date('2030-01-01'),
                    authenticationStrategy: API_KEY_AUTH_STRATEGY_NAME,
                    user: {
                        id: 'fixture-machine',
                        identifier: 'fixture-machine',
                        verified: true,
                        channelPermissions: [
                            {
                                id: permissionsChannelId,
                                code: permissionsChannelId,
                                token: 'fixture-channel-token',
                                permissions: [...permissions] as Permission[],
                            },
                        ],
                    },
                },
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });
            expect(hasMachineMailboxAccess(ctx, 'Query.icloudPrimaryAccounts')).toBe(expected);
        },
    );

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
    it.each(['jobs', 'storePaymentStats', 'telegramNotificationDeliveries', 'governanceApprovals'])(
        'rejects platform %s from a store context even for SuperAdmin',
        async fieldName => {
            const { service, connection } = createService({ merchant: false });
            const superInStore = { ...merchantContext, userHasPermissions: () => true };
            await expect(service.assertRootFieldAccess(superInStore, 'Query', fieldName, {})).rejects.toThrow(
                '平台管理中心',
            );
            expect(connection.getRepository).not.toHaveBeenCalled();
        },
    );
    it.each([
        ['Query', 'systemAnnouncements'],
        ['Mutation', 'createSystemAnnouncement'],
        ['Mutation', 'updateSystemAnnouncement'],
        ['Mutation', 'deleteSystemAnnouncement'],
    ])(
        'allows scope-aware announcements through %s.%s while retaining merchant channel isolation',
        async (type, field) => {
            const { service } = createService();
            await expect(
                service.assertRootFieldAccess(merchantContext, type, field, {}),
            ).resolves.toBeUndefined();
            const wrongStore = createService({ channelIds: ['store-b'] });
            await expect(
                wrongStore.service.assertRootFieldAccess(merchantContext, type, field, {}),
            ).rejects.toThrow();
        },
    );

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
            service.assertRootFieldAccess(
                { ...merchantContext, channel: { code: '__default_channel__' } },
                'Mutation',
                'updatePromotion',
                {
                    input: { id: 'ordinary-promotion' },
                },
            ),
        ).resolves.toBeUndefined();
    });

    it.each([
        'createPromotion',
        'updatePromotion',
        'deletePromotion',
        'updateStockLocation',
        'createAdministrator',
    ])('uses the active store for platform staff without a merchant profile: %s', async fieldName => {
        const { service } = createService({ merchant: false });
        const ctx = { ...merchantContext, userHasPermissions: () => true };
        await expect(
            service.assertRootFieldAccess(ctx, 'Mutation', fieldName, {
                input: { id: 'foreign-stock' },
            }),
        ).rejects.toThrow();
    });

    it.each([
        ['Query', 'scheduledTasks'],
        ['Mutation', 'updateScheduledTask'],
        ['Mutation', 'runScheduledTask'],
        ['Query', 'globalSettings'],
        ['Mutation', 'updateGlobalSettings'],
        ['Mutation', 'backfillCustomerContentTranslations'],
    ])('keeps technical %s.%s in the platform context', async (parent, fieldName) => {
        const { service } = createService({ merchant: false });
        const ctx = { ...merchantContext, userHasPermissions: () => true };
        await expect(service.assertRootFieldAccess(ctx, parent, fieldName, {})).rejects.toThrow(
            '平台管理中心',
        );
        await expect(
            service.assertRootFieldAccess(
                { ...ctx, channel: { code: '__default_channel__' } },
                parent,
                fieldName,
                {},
            ),
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

    it('blocks cross-store assignment and foreign stock-location mutations', async () => {
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
    it.each([
        ['createStockLocation', { input: { name: 'Own new warehouse' } }],
        ['updateStockLocation', { input: { id: 'stock-a', name: 'Own warehouse' } }],
        ['deleteStockLocation', { input: { id: 'stock-a', transferToLocationId: 'stock-target' } }],
        ['deleteStockLocations', { input: [{ id: 'stock-a' }] }],
    ])('allows own %s under native resolver RBAC', async (field, args) => {
        const { service } = createService({ visibleEntityIds: ['stock-a', 'stock-target'] });
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', field, args),
        ).resolves.toBeUndefined();
    });
    it.each([
        ['updateStockLocation', { input: { id: 'stock-shared', name: 'Shared' } }],
        ['deleteStockLocation', { input: { id: 'stock-a', transferToLocationId: 'stock-shared' } }],
        ['deleteStockLocation', { input: { id: 'stock-a', transferToLocationId: 'foreign-stock' } }],
    ])(
        'rejects foreign or cross-store shared warehouse maintenance through %s including SuperAdmin',
        async (field, args) => {
            const { service } = createService({
                merchant: false,
                visibleEntityIds: ['stock-a', 'stock-shared'],
                sharedEntityIds: ['stock-shared'],
            });
            await expect(
                service.assertRootFieldAccess(
                    { ...merchantContext, userHasPermissions: () => true },
                    'Mutation',
                    field,
                    args,
                ),
            ).rejects.toBeInstanceOf(ForbiddenError);
        },
    );
    it('allows own draft creation but prevents sales in the default platform context', async () => {
        const { service } = createService();
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'createDraftOrder', {}),
        ).resolves.toBeUndefined();
        await expect(
            service.assertRootFieldAccess(
                {
                    ...merchantContext,
                    channel: { code: '__default_channel__' },
                    userHasPermissions: () => true,
                },
                'Mutation',
                'createDraftOrder',
                {},
            ),
        ).rejects.toThrow('平台管理中心不创建销售订单');
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

        for (const fieldName of ['settlePayment', 'refundOrder', 'recordManualRefund', 'retryRefund']) {
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

    it('allows scoped order modifications but requires finance permission for refund allocations', async () => {
        const { service } = createService({ visibleEntityIds: ['order-a'] });
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'modifyOrder', {
                input: { orderId: 'order-a', refunds: [] },
            }),
        ).resolves.toBeUndefined();
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Mutation', 'modifyOrder', {
                input: { orderId: 'order-a', refunds: [{ paymentId: 'payment-a', amount: 100 }] },
            }),
        ).rejects.toThrow('敏感店铺财务权限');
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

    it('rejects a forged foreign warehouse even for SuperAdmin in a store context', async () => {
        const { service, connection } = createService({ merchant: false, visibleEntityIds: ['variant-a'] });
        const ctx = { ...merchantContext, userHasPermissions: () => true };
        await expect(
            service.assertRootFieldAccess(ctx, 'Mutation', 'updateProductVariant', {
                input: { id: 'variant-a', stockLevels: [{ stockLocationId: 'stock-b' }] },
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(connection.findByIdsInChannel).toHaveBeenCalledWith(
            ctx,
            StockLocation,
            ['stock-b'],
            'store-a',
            {},
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

describe('direct API commerce mode boundaries', () => {
    it.each([
        ['Query', 'catalogInventoryOperations'],
        ['Query', 'catalogPurchaseOrders'],
        ['Query', 'stockLocations'],
        ['Query', 'shippingTemplateManagement'],
        ['Query', 'shippingMethods'],
        ['Query', 'shippingMethod'],
        ['Query', 'shippingEligibilityCheckers'],
        ['Query', 'shippingCalculators'],
        ['Mutation', 'saveCatalogInventoryLot'],
        ['Mutation', 'createCatalogPurchaseOrder'],
        ['Mutation', 'copyPlatformShippingTemplate'],
    ])('rejects %s.%s for digital-only stores including SuperAdmin', async (parent, field) => {
        const { service } = createService({ merchant: false, commerceMode: 'DIGITAL_ONLY' });
        await expect(
            service.assertRootFieldAccess(
                {
                    ...merchantContext,
                    channel: { code: 'store-a', customFields: { commerceMode: 'DIGITAL_ONLY' } },
                    userHasPermissions: () => true,
                },
                parent,
                field,
                {},
            ),
        ).rejects.toThrow('仅经营虚拟商品');
    });
    it('rejects forged native stock-level writes in digital-only context', async () => {
        const { service } = createService({ merchant: false, commerceMode: 'DIGITAL_ONLY' });
        await expect(
            service.assertRootFieldAccess(
                {
                    ...merchantContext,
                    channel: { code: 'store-a', customFields: { commerceMode: 'DIGITAL_ONLY' } },
                    userHasPermissions: () => true,
                },
                'Mutation',
                'updateProductVariant',
                {
                    input: {
                        id: 'variant-a',
                        stockLevels: [{ stockLocationId: 'warehouse-a', stockOnHand: 10 }],
                    },
                },
            ),
        ).rejects.toThrow('仅经营虚拟商品');
    });
    it.each(['updateAutoCardConfig', 'importAutoCardPoolItems'])(
        'rejects new digital supply %s in physical-only stores',
        async field => {
            const { service } = createService({ merchant: false, commerceMode: 'PHYSICAL_ONLY' });
            await expect(
                service.assertRootFieldAccess(
                    {
                        ...merchantContext,
                        channel: { code: 'store-a', customFields: { commerceMode: 'PHYSICAL_ONLY' } },
                        userHasPermissions: () => true,
                    },
                    'Mutation',
                    field,
                    {},
                ),
            ).rejects.toThrow('仅经营实物商品');
        },
    );
    it.each([
        ['PHYSICAL_ONLY', 'Mutation', 'importAutoCardPoolItems'],
        ['DIGITAL_ONLY', 'Mutation', 'createCatalogPurchaseOrder'],
        ['DIGITAL_ONLY', 'Query', 'shippingMethods'],
    ])('rejects newly restricted %s mode despite a stale HYBRID context', async (mode, parent, field) => {
        const { service, connection } = createService({ merchant: false, commerceMode: mode });
        await expect(service.assertRootFieldAccess(merchantContext, parent, field, {})).rejects.toThrow();
        expect(connection.getRepository).toHaveBeenCalledWith(merchantContext, Channel);
    });
    it.each([null, 'UNKNOWN'])(
        'fails closed for both supply types when persisted commerce mode is %s',
        async mode => {
            const { service } = createService({ merchant: false, commerceMode: mode });
            for (const field of ['createCatalogPurchaseOrder', 'importAutoCardPoolItems']) {
                await expect(
                    service.assertRootFieldAccess(merchantContext, 'Mutation', field, {}),
                ).rejects.toThrow('经营模式尚未确认');
            }
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Mutation', 'retryAutoCardDelivery', {}),
            ).resolves.toBeUndefined();
        },
    );
    it.each(['createPlatformFreeShippingVersion', 'initializePlatformShippingTemplates'])(
        'restricts %s to the platform context',
        async field => {
            const { service } = createService({ merchant: false });
            await expect(
                service.assertRootFieldAccess(merchantContext, 'Mutation', field, {}),
            ).rejects.toThrow('平台管理中心');
        },
    );
    it('restricts technical prompt release history while leaving published business choices available', async () => {
        const { service } = createService({ merchant: false });
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Query', 'imagePromptSkillReleases', {}),
        ).rejects.toThrow('平台管理中心');
        await expect(
            service.assertRootFieldAccess(merchantContext, 'Query', 'catalogImageStudioConfig', {}),
        ).resolves.toBeUndefined();
    });
    it.each([
        'retryAutoCardDelivery',
        'retryManualDigitalDelivery',
        'appendManualDigitalDelivery',
        'recordCatalogPurchasePayment',
        'returnCatalogPurchaseOrder',
    ])('leaves accepted recovery %s to its owner/state service checks', async field => {
        const { service } = createService({ merchant: false });
        await expect(
            service.assertRootFieldAccess(
                {
                    ...merchantContext,
                    channel: { code: 'store-a', customFields: { commerceMode: 'PHYSICAL_ONLY' } },
                    userHasPermissions: () => true,
                },
                'Mutation',
                field,
                {},
            ),
        ).resolves.toBeUndefined();
    });
});

describe('draft order immutable sale scope with real SQLjs membership', () => {
    const channel = new EntitySchema<{ id: string }>({
        name: 'DraftGuardChannel',
        columns: { id: { type: String, primary: true } },
    });
    const order = new EntitySchema<{
        id: string;
        salesChannelId: string;
        state: string;
        channels: Array<{ id: string }>;
    }>({
        name: 'DraftGuardOrder',
        columns: {
            id: { type: String, primary: true },
            salesChannelId: { type: String },
            state: { type: String },
        },
        relations: { channels: { type: 'many-to-many', target: 'DraftGuardChannel', joinTable: true } },
    });
    const database = new DataSource({ type: 'sqljs', entities: [channel, order], synchronize: true });
    const draftFields = [
        'deleteDraftOrder',
        'addItemToDraftOrder',
        'adjustDraftOrderLine',
        'removeDraftOrderLine',
        'setDraftOrderCustomFields',
        'setCustomerForDraftOrder',
        'setDraftOrderShippingAddress',
        'setDraftOrderBillingAddress',
        'unsetDraftOrderShippingAddress',
        'unsetDraftOrderBillingAddress',
        'applyCouponCodeToDraftOrder',
        'removeCouponCodeFromDraftOrder',
        'setDraftOrderShippingMethod',
    ];
    beforeAll(async () => {
        await database.initialize();
        await database.getRepository(channel).save([{ id: 'store-a' }, { id: 'store-b' }]);
        const channels = [{ id: 'store-a' }, { id: 'store-b' }];
        await database.getRepository(order).save([
            { id: 'own-draft', salesChannelId: 'store-a', state: 'Draft', channels },
            { id: 'foreign-draft', salesChannelId: 'store-b', state: 'Draft', channels },
            { id: 'own-placed', salesChannelId: 'store-a', state: 'PaymentSettled', channels },
        ]);
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });
    function service() {
        const fixture = createService({ merchant: false });
        const fallback = fixture.connection.getRepository.getMockImplementation();
        fixture.connection.getRepository.mockImplementation((ctx, entity) =>
            entity === Order ? database.getRepository(order) : fallback?.(ctx, entity),
        );
        return fixture.service;
    }
    it.each(draftFields)(
        'allows only own Draft state for %s even when memberships expose both shops',
        async field => {
            const guard = service();
            const ctx = { ...merchantContext, userHasPermissions: () => true };
            await expect(
                guard.assertRootFieldAccess(ctx, 'Mutation', field, {
                    orderId: 'own-draft',
                    input: { orderLineId: 'line-own' },
                }),
            ).resolves.toBeUndefined();
            for (const orderId of ['foreign-draft', 'own-placed']) {
                await expect(
                    guard.assertRootFieldAccess(ctx, 'Mutation', field, {
                        orderId,
                        input: { orderLineId: 'line-own' },
                    }),
                ).rejects.toBeInstanceOf(ForbiddenError);
            }
        },
    );
    it('checks draft quote ownership before returning from a Query guard', async () => {
        const guard = service();
        await expect(
            guard.assertRootFieldAccess(merchantContext, 'Query', 'eligibleShippingMethodsForDraftOrder', {
                orderId: 'own-draft',
            }),
        ).resolves.toBeUndefined();
        await expect(
            guard.assertRootFieldAccess(merchantContext, 'Query', 'eligibleShippingMethodsForDraftOrder', {
                orderId: 'foreign-draft',
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });
});
