import 'reflect-metadata';

import { Permission } from '@vendure/common/lib/generated-types';
import {
    Collection,
    Facet,
    PaymentMethod,
    ProductOptionGroup,
    ShippingMethod,
    StockLocation,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { manageStoreTeamPermission } from './constants';
import {
    adjustReferralBalancePermission,
    manageReferralWithdrawalPermission,
    referralPermission,
} from './referral/referral.constants';
import {
    cloneTemplateCollectionFilters,
    remapTemplateOperationIds,
    storeAdministratorPermissions,
    StoreProvisioningService,
} from './store-provisioning.service';

function createService() {
    const repository = { find: vi.fn(), findOne: vi.fn().mockResolvedValue(null) };
    const stockLocationRepository = {
        find: vi.fn().mockResolvedValue([
            { id: 'stock-location-1', name: 'Warehouse A', description: 'Primary', customFields: {} },
            { id: 'stock-location-2', name: 'Warehouse B', description: 'Overflow', customFields: {} },
        ]),
    };
    const paymentMethodRepository = {
        find: vi.fn().mockResolvedValue([
            {
                id: 'payment-method-1',
                code: 'referral-balance',
                enabled: true,
                checker: null,
                handler: { code: 'referral-balance-payment', args: [] },
                translations: [{ languageCode: 'en', name: 'Referral balance', description: 'Balance' }],
                customFields: {},
            },
            {
                id: 'payment-method-2',
                code: 'usdt-trc20',
                enabled: true,
                checker: null,
                handler: { code: 'usdt-trc20-chain-handler', args: [] },
                translations: [{ languageCode: 'en', name: 'USDT', description: 'USDT' }],
                customFields: {},
            },
            {
                id: 'payment-method-3',
                code: 'controlled-test-payment-template-1',
                enabled: true,
                checker: { code: 'controlled-test-payment-checker', args: [] },
                handler: {
                    code: 'controlled-test-payment-handler',
                    args: [{ name: 'channelId', value: 'template-1' }],
                },
                translations: [{ languageCode: 'en', name: 'Test payment', description: 'Test only' }],
                customFields: {},
            },
        ]),
    };
    const shippingMethodRepository = {
        find: vi.fn().mockResolvedValue([
            {
                id: 'shipping-method-1',
                code: 'standard-shipping',
                checker: { code: 'default-shipping-eligibility-checker', args: [] },
                calculator: { code: 'default-shipping-calculator', args: [] },
                fulfillmentHandlerCode: 'manual-fulfillment',
                translations: [{ languageCode: 'en', name: 'Standard', description: 'Standard delivery' }],
                customFields: {},
            },
        ]),
    };
    const facetRepository = { find: vi.fn().mockResolvedValue([]) };
    const optionGroupRepository = { find: vi.fn().mockResolvedValue([]) };
    const collectionRepository = { find: vi.fn().mockResolvedValue([]) };
    const connection = {
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === StockLocation) return stockLocationRepository;
            if (entity === PaymentMethod) return paymentMethodRepository;
            if (entity === ShippingMethod) return shippingMethodRepository;
            if (entity === Facet) return facetRepository;
            if (entity === ProductOptionGroup) return optionGroupRepository;
            if (entity === Collection) return collectionRepository;
            return repository;
        }),
    };
    const sellerService = { create: vi.fn().mockResolvedValue({ id: 'seller-1' }) };
    const channel = { id: 'store-1', code: 'alpha-store', token: 'server-generated-token' };
    const channelService = {
        findOne: vi.fn().mockResolvedValue({
            id: 'template-1',
            defaultLanguageCode: 'zh_Hans',
            availableLanguageCodes: ['zh_Hans', 'en'],
            defaultCurrencyCode: 'CNY',
            availableCurrencyCodes: ['CNY'],
            pricesIncludeTax: true,
            trackInventory: true,
            outOfStockThreshold: 0,
            defaultShippingZone: { id: 'shipping-zone-1' },
            defaultTaxZone: { id: 'tax-zone-1' },
            customFields: { isStoreProvisioningTemplate: false },
        }),
        create: vi.fn().mockResolvedValue(channel),
        assignToChannels: vi.fn().mockResolvedValue(undefined),
        getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default-channel' }),
        removeFromChannels: vi.fn().mockResolvedValue(undefined),
    };
    const superAdminRole = { id: 'super-admin-role', permissions: [Permission.SuperAdmin] };
    const roleService = {
        getSuperAdminRole: vi.fn().mockResolvedValue(superAdminRole),
        getCustomerRole: vi.fn().mockResolvedValue({ id: 'customer-role' }),
        assignRoleToChannel: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: 'store-role-1' }),
    };
    const administratorService = { create: vi.fn().mockResolvedValue({ id: 'administrator-1' }) };
    const stockLocationService = {
        create: vi
            .fn()
            .mockResolvedValueOnce({ id: 'cloned-stock-location-1' })
            .mockResolvedValueOnce({ id: 'cloned-stock-location-2' }),
    };
    const shippingMethodService = {
        create: vi.fn().mockResolvedValue({ id: 'cloned-shipping-method-1' }),
    };
    const paymentMethodService = {
        create: vi.fn().mockResolvedValue({ id: 'cloned-payment-method-1' }),
    };
    const storeProfileService = {
        createDraft: vi.fn().mockResolvedValue({ id: 'profile-1', channelId: 'store-1' }),
    };
    const merchantInitialPasswordService = { requirePasswordChange: vi.fn().mockResolvedValue(undefined) };
    const administratorAccessService = {
        extendPlatformRolesToChannel: vi.fn().mockResolvedValue(undefined),
        registerStorePrimary: vi.fn().mockResolvedValue(undefined),
    };
    const contentTranslations = {
        prepareLocalizedFields: vi.fn((fields: any[]) =>
            Promise.resolve(
                fields.map(field => ({
                    path: field.path,
                    sourceText: field.sourceText,
                    translatedText: field.targetText?.trim() || 'Alpha Shop',
                    status: field.targetText?.trim() ? 'MANUAL_LOCKED' : 'AUTO_TRANSLATED',
                    origin: field.targetText?.trim() ? 'MANUAL' : 'AUTO',
                    locked: Boolean(field.targetText?.trim()),
                })),
            ),
        ),
        recordPreparedFields: vi.fn().mockResolvedValue(undefined),
    };
    const facetService = { create: vi.fn() };
    const facetValueService = { create: vi.fn() };
    const productOptionGroupService = { create: vi.fn() };
    const productOptionService = { create: vi.fn() };
    const collectionService = { create: vi.fn() };
    const service = new StoreProvisioningService(
        connection as any,
        sellerService as any,
        channelService as any,
        roleService as any,
        administratorService as any,
        stockLocationService as any,
        shippingMethodService as any,
        paymentMethodService as any,
        storeProfileService as any,
        merchantInitialPasswordService as any,
        administratorAccessService as any,
        contentTranslations as any,
        facetService as any,
        facetValueService as any,
        productOptionGroupService as any,
        productOptionService as any,
        collectionService as any,
    );
    return {
        administratorService,
        channel,
        channelService,
        shippingMethodRepository,
        stockLocationRepository,
        roleService,
        sellerService,
        shippingMethodService,
        paymentMethodService,
        service,
        stockLocationService,
        storeProfileService,
        merchantInitialPasswordService,
        contentTranslations,
        repository,
        facetRepository,
        optionGroupRepository,
        collectionRepository,
        facetService,
        facetValueService,
        productOptionGroupService,
        productOptionService,
        collectionService,
    };
}

const input = {
    code: ' Alpha-Store ',
    name: ' Alpha Limited ',
    storefrontNameZh: ' 阿尔法商城 ',
    storefrontNameEn: '',
    templateChannelId: 'template-1',
    administrator: {
        firstName: ' Alice ',
        lastName: ' Chen ',
        emailAddress: ' OWNER@EXAMPLE.COM ',
    },
};

describe('StoreProvisioningService', () => {
    it('remaps facet-value ids inside collection filter arguments', () => {
        const result = remapTemplateOperationIds(
            {
                code: 'facet-value-filter',
                args: [
                    { name: 'facetValueIds', value: '["11","12"]' },
                    { name: 'containsAny', value: ['11', 'other'] },
                ],
            },
            new Map([
                ['11', '101'],
                ['12', '102'],
            ]),
        );

        expect(result).toEqual({
            code: 'facet-value-filter',
            args: [
                { name: 'facetValueIds', value: '["101","102"]' },
                { name: 'containsAny', value: ['101', 'other'] },
            ],
        });
    });

    it('drops template product and variant id filters instead of leaking source-store records', () => {
        expect(
            cloneTemplateCollectionFilters(
                [
                    {
                        code: 'product-id-filter',
                        args: [{ name: 'productIds', value: '["product-1"]' }],
                    },
                    {
                        code: 'variant-id-filter',
                        args: [{ name: 'variantIds', value: '["variant-1"]' }],
                    },
                    {
                        code: 'facet-value-filter',
                        args: [{ name: 'facetValueIds', value: '["facet-value-1"]' }],
                    },
                ],
                new Map([['facet-value-1', 'target-facet-value-1']]),
            ),
        ).toEqual([
            {
                code: 'facet-value-filter',
                arguments: [{ name: 'facetValueIds', value: '["target-facet-value-1"]' }],
            },
        ]);
    });

    it('creates one isolated store from the selected base Channel without a separate template flag', async () => {
        const {
            administratorService,
            channel,
            channelService,
            roleService,
            sellerService,
            service,
            shippingMethodRepository,
            shippingMethodService,
            paymentMethodService,
            stockLocationService,
            storeProfileService,
            merchantInitialPasswordService,
            contentTranslations,
        } = createService();
        const ctx = {
            channelId: 'template-1',
            session: {
                user: {
                    channelPermissions: [
                        {
                            id: 'default-channel',
                            token: 'default-token',
                            code: '__default_channel__',
                            permissions: [Permission.ReadChannel, Permission.CreateProduct],
                        },
                    ],
                },
            },
            copy: vi.fn().mockReturnValue({}),
        } as any;

        const result = await service.provision(ctx, input);

        expect(sellerService.create).toHaveBeenCalledWith(ctx, { name: 'Alpha Limited' });
        expect(channelService.create).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                code: 'alpha-store',
                sellerId: 'seller-1',
                defaultLanguageCode: 'zh_Hans',
                defaultCurrencyCode: 'CNY',
                defaultShippingZoneId: 'shipping-zone-1',
                defaultTaxZoneId: 'tax-zone-1',
                customFields: {
                    storefrontNameZh: '阿尔法商城',
                    storefrontNameEn: 'Alpha Shop',
                    isStoreProvisioningTemplate: false,
                },
            }),
        );
        const createChannelInput = channelService.create.mock.calls[0][1];
        expect(createChannelInput.token).not.toBe('alpha-store-token');
        expect(createChannelInput.token.length).toBeGreaterThanOrEqual(24);
        expect(roleService.assignRoleToChannel).toHaveBeenCalledWith(ctx, 'super-admin-role', channel.id);
        expect(roleService.assignRoleToChannel).toHaveBeenCalledWith(ctx, 'customer-role', channel.id);
        expect(roleService.create).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                code: 'alpha-store-store-admin',
                channelIds: ['store-1'],
                permissions: storeAdministratorPermissions,
            }),
        );
        expect(administratorService.create).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                firstName: 'Alice',
                lastName: 'Chen',
                emailAddress: 'owner@example.com',
                roleIds: ['store-role-1'],
            }),
        );
        expect(merchantInitialPasswordService.requirePasswordChange).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({ id: 'administrator-1' }),
        );
        expect(stockLocationService.create).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({ name: 'Warehouse A', description: 'Primary' }),
        );
        expect(stockLocationService.create).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({ name: 'Warehouse B', description: 'Overflow' }),
        );
        expect(paymentMethodService.create).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                code: 'referral-balance',
                handler: { code: 'referral-balance-payment', arguments: [] },
            }),
        );
        expect(paymentMethodService.create).toHaveBeenCalledTimes(1);
        expect(shippingMethodService.create).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                code: 'standard-shipping',
                fulfillmentHandler: 'manual-fulfillment',
            }),
        );
        expect(shippingMethodRepository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ deletedAt: expect.anything() }),
            }),
        );
        expect(channelService.assignToChannels).not.toHaveBeenCalled();
        expect(channelService.removeFromChannels).toHaveBeenCalledWith(
            expect.anything(),
            StockLocation,
            'cloned-stock-location-1',
            ['default-channel'],
        );
        expect(channelService.removeFromChannels).toHaveBeenCalledWith(
            expect.anything(),
            StockLocation,
            'cloned-stock-location-2',
            ['default-channel'],
        );
        expect(channelService.removeFromChannels).toHaveBeenCalledWith(
            expect.anything(),
            ShippingMethod,
            'cloned-shipping-method-1',
            ['default-channel'],
        );
        expect(channelService.removeFromChannels).toHaveBeenCalledWith(
            expect.anything(),
            PaymentMethod,
            'cloned-payment-method-1',
            ['default-channel'],
        );
        expect(storeProfileService.createDraft).toHaveBeenCalledWith(ctx, channel);
        expect(contentTranslations.prepareLocalizedFields).toHaveBeenCalledWith([
            expect.objectContaining({ sourceText: '阿尔法商城', targetText: '', required: true }),
        ]);
        expect(contentTranslations.recordPreparedFields).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({ channelId: 'store-1', entityType: 'StoreProfile' }),
            [expect.objectContaining({ translatedText: 'Alpha Shop', origin: 'AUTO' })],
        );
        expect(ctx.session.user.channelPermissions).toEqual([
            {
                id: 'default-channel',
                token: 'default-token',
                code: '__default_channel__',
                permissions: [Permission.ReadChannel, Permission.CreateProduct],
            },
            {
                id: 'store-1',
                token: 'server-generated-token',
                code: 'alpha-store',
                permissions: [Permission.ReadChannel, Permission.CreateProduct],
            },
        ]);
        expect(result).toMatchObject({
            sellerId: 'seller-1',
            channelId: 'store-1',
            roleId: 'store-role-1',
            administratorId: 'administrator-1',
            stockLocationId: 'cloned-stock-location-1',
            profileId: 'profile-1',
            channelCode: 'alpha-store',
        });
        expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(24);
    });

    it('clones facets, options and the collection tree as independent store records', async () => {
        const {
            service,
            facetRepository,
            optionGroupRepository,
            collectionRepository,
            facetService,
            facetValueService,
            productOptionGroupService,
            productOptionService,
            collectionService,
        } = createService();
        facetRepository.find.mockResolvedValueOnce([
            {
                id: 'facet-1',
                code: 'brand',
                isPrivate: false,
                customFields: {},
                translations: [{ languageCode: 'en', name: 'Brand', customFields: {} }],
                values: [
                    {
                        id: 'facet-value-1',
                        code: 'local',
                        customFields: {},
                        translations: [{ languageCode: 'en', name: 'Local', customFields: {} }],
                    },
                ],
            },
        ]);
        optionGroupRepository.find.mockResolvedValueOnce([
            {
                id: 'option-group-1',
                code: 'size',
                customFields: {},
                translations: [{ languageCode: 'en', name: 'Size', customFields: {} }],
                options: [
                    {
                        id: 'option-1',
                        code: 'large',
                        customFields: {},
                        translations: [{ languageCode: 'en', name: 'Large', customFields: {} }],
                    },
                ],
            },
        ]);
        collectionRepository.find.mockResolvedValueOnce([
            {
                id: 'collection-parent',
                parentId: 'root',
                parent: { isRoot: true },
                isPrivate: false,
                inheritFilters: true,
                filters: [
                    {
                        code: 'facet-value-filter',
                        args: [{ name: 'facetValueIds', value: '["facet-value-1"]' }],
                    },
                ],
                customFields: {},
                translations: [
                    {
                        languageCode: 'en',
                        name: 'Parent',
                        slug: 'parent',
                        description: '',
                        customFields: {},
                    },
                ],
            },
            {
                id: 'collection-child',
                parentId: 'collection-parent',
                parent: { isRoot: false },
                isPrivate: false,
                inheritFilters: true,
                filters: [],
                customFields: {},
                translations: [
                    {
                        languageCode: 'en',
                        name: 'Child',
                        slug: 'child',
                        description: '',
                        customFields: {},
                    },
                ],
            },
        ]);
        facetService.create.mockResolvedValueOnce({ id: 'target-facet-1' });
        facetValueService.create.mockResolvedValueOnce({ id: 'target-facet-value-1' });
        productOptionGroupService.create.mockResolvedValueOnce({ id: 'target-option-group-1' });
        productOptionService.create.mockResolvedValueOnce({ id: 'target-option-1' });
        collectionService.create
            .mockResolvedValueOnce({ id: 'target-collection-parent' })
            .mockResolvedValueOnce({ id: 'target-collection-child' });
        const ctx = {
            channelId: 'template-1',
            session: {
                user: {
                    channelPermissions: [
                        {
                            id: 'default-channel',
                            token: 'default-token',
                            code: '__default_channel__',
                            permissions: [Permission.SuperAdmin],
                        },
                    ],
                },
            },
            copy: vi.fn().mockReturnValue({ channelId: 'store-1' }),
        } as any;

        const result = await service.provision(ctx, input);

        expect(facetService.create).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'store-1' }),
            expect.objectContaining({ code: 'alpha-store-brand' }),
        );
        expect(facetValueService.create).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'store-1' }),
            expect.objectContaining({ id: 'target-facet-1' }),
            expect.objectContaining({ code: 'local' }),
        );
        expect(productOptionGroupService.create).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'store-1' }),
            expect.objectContaining({ code: 'alpha-store-size' }),
        );
        expect(productOptionService.create).toHaveBeenCalledWith(
            expect.objectContaining({ channelId: 'store-1' }),
            expect.objectContaining({ id: 'target-option-group-1' }),
            expect.objectContaining({ code: 'large' }),
        );
        expect(collectionService.create).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ channelId: 'store-1' }),
            expect.objectContaining({
                parentId: undefined,
                filters: [
                    {
                        code: 'facet-value-filter',
                        arguments: [{ name: 'facetValueIds', value: '["target-facet-value-1"]' }],
                    },
                ],
            }),
        );
        expect(collectionService.create).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ channelId: 'store-1' }),
            expect.objectContaining({ parentId: 'target-collection-parent' }),
        );
    });

    it('rejects invalid store identifiers before writing data', async () => {
        const { sellerService, service } = createService();

        await expect(service.provision({} as any, { ...input, code: 'Invalid code' })).rejects.toThrow(
            '网店编码',
        );
        expect(sellerService.create).not.toHaveBeenCalled();
    });

    it('rejects provisioning when the base store has no inventory to clone', async () => {
        const { stockLocationRepository, sellerService, service } = createService();
        stockLocationRepository.find.mockResolvedValueOnce([]);

        await expect(
            service.provision(
                { channelId: 'template-1', session: { user: { channelPermissions: [] } } } as any,
                input,
            ),
        ).rejects.toThrow('基础店铺没有可复制的库存点');
        expect(sellerService.create).not.toHaveBeenCalled();
    });

    it('lists operating Channels as selectable bases and excludes platform management', async () => {
        const { repository, service } = createService();
        repository.find.mockResolvedValueOnce([
            { id: 'default', code: '__default_channel__' },
            { id: 'template', code: 'template', customFields: { isStoreProvisioningTemplate: true } },
            { id: 'store', code: 'store', customFields: { isStoreProvisioningTemplate: false } },
        ]);

        await expect(service.findTemplates({} as any)).resolves.toEqual([
            expect.objectContaining({ id: 'template' }),
            expect.objectContaining({ id: 'store' }),
        ]);
        expect(repository.find).toHaveBeenCalledWith({ order: { code: 'ASC' } });
    });

    it('does not grant platform-level or destructive order permissions', () => {
        expect(storeAdministratorPermissions).toContain(Permission.ReadChannel);
        expect(storeAdministratorPermissions).toContain(Permission.CreateProduct);
        expect(storeAdministratorPermissions).toContain(Permission.UpdateProduct);
        expect(storeAdministratorPermissions).toContain(Permission.DeleteProduct);
        expect(storeAdministratorPermissions).toContain(Permission.CreateCollection);
        expect(storeAdministratorPermissions).toContain(Permission.UpdateCollection);
        expect(storeAdministratorPermissions).toContain(Permission.DeleteCollection);
        expect(storeAdministratorPermissions).toContain(Permission.CreateFacet);
        expect(storeAdministratorPermissions).toContain(Permission.UpdateFacet);
        expect(storeAdministratorPermissions).toContain(Permission.DeleteFacet);
        expect(storeAdministratorPermissions).toContain(Permission.CreateAsset);
        expect(storeAdministratorPermissions).toContain(Permission.UpdateAsset);
        expect(storeAdministratorPermissions).toContain(Permission.DeleteAsset);
        expect(storeAdministratorPermissions).toContain('ReadStoreDomain');
        expect(storeAdministratorPermissions).toContain('UpdateStorefrontContent');
        expect(storeAdministratorPermissions).toContain('ReadStoreProfile');
        expect(storeAdministratorPermissions).toContain('UpdateStoreProfile');
        expect(storeAdministratorPermissions).toEqual(
            expect.arrayContaining([
                'CreateCatalogImport',
                'ReadCatalogImport',
                'UpdateCatalogImport',
                'DeleteCatalogImport',
            ]),
        );
        expect(storeAdministratorPermissions).toEqual(
            expect.arrayContaining([
                referralPermission.Create,
                referralPermission.Read,
                referralPermission.Update,
                referralPermission.Delete,
            ]),
        );
        expect(storeAdministratorPermissions).toEqual(
            expect.arrayContaining([
                Permission.CreateAdministrator,
                Permission.ReadAdministrator,
                Permission.UpdateAdministrator,
                Permission.DeleteAdministrator,
                manageStoreTeamPermission.Permission,
            ]),
        );
        expect(storeAdministratorPermissions).not.toContain(manageReferralWithdrawalPermission.Permission);
        expect(storeAdministratorPermissions).not.toContain(adjustReferralBalancePermission.Permission);
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateChannel);
        expect(storeAdministratorPermissions).not.toContain(Permission.DeleteChannel);
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateSeller);
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateOrder);
        expect(storeAdministratorPermissions).not.toContain(Permission.DeleteOrder);
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateCatalog);
        expect(storeAdministratorPermissions).not.toContain(Permission.UpdateCatalog);
        expect(storeAdministratorPermissions).not.toContain(Permission.DeleteCatalog);
        expect(storeAdministratorPermissions).not.toContain(Permission.UpdateStockLocation);
    });
});
