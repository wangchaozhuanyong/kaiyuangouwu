import 'reflect-metadata';

import { Permission } from '@vendure/common/lib/generated-types';
import { PaymentMethod, ShippingMethod, StockLocation } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { storeAdministratorPermissions, StoreProvisioningService } from './store-provisioning.service';

function createService() {
    const repository = { findOne: vi.fn().mockResolvedValue(null) };
    const stockLocationRepository = {
        find: vi.fn().mockResolvedValue([{ id: 'stock-location-1' }, { id: 'stock-location-2' }]),
    };
    const paymentMethodRepository = { find: vi.fn().mockResolvedValue([{ id: 'payment-method-1' }]) };
    const shippingMethodRepository = { find: vi.fn().mockResolvedValue([{ id: 'shipping-method-1' }]) };
    const connection = {
        getRepository: vi.fn((_ctx, entity) => {
            if (entity === StockLocation) return stockLocationRepository;
            if (entity === PaymentMethod) return paymentMethodRepository;
            if (entity === ShippingMethod) return shippingMethodRepository;
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
        }),
        create: vi.fn().mockResolvedValue(channel),
        assignToChannels: vi.fn().mockResolvedValue(undefined),
    };
    const superAdminRole = { id: 'super-admin-role', permissions: [Permission.SuperAdmin] };
    const roleService = {
        getSuperAdminRole: vi.fn().mockResolvedValue(superAdminRole),
        getCustomerRole: vi.fn().mockResolvedValue({ id: 'customer-role' }),
        assignRoleToChannel: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({ id: 'store-role-1' }),
    };
    const administratorService = { create: vi.fn().mockResolvedValue({ id: 'administrator-1' }) };
    const storeProfileService = { createDraft: vi.fn().mockResolvedValue({ id: 'profile-1' }) };
    const merchantInitialPasswordService = { requirePasswordChange: vi.fn().mockResolvedValue(undefined) };
    const service = new StoreProvisioningService(
        connection as any,
        sellerService as any,
        channelService as any,
        roleService as any,
        administratorService as any,
        storeProfileService as any,
        merchantInitialPasswordService as any,
    );
    return {
        administratorService,
        channel,
        channelService,
        shippingMethodRepository,
        stockLocationRepository,
        roleService,
        sellerService,
        service,
        storeProfileService,
        merchantInitialPasswordService,
    };
}

const input = {
    code: ' Alpha-Store ',
    name: ' Alpha Limited ',
    storefrontNameZh: ' 阿尔法商城 ',
    storefrontNameEn: ' Alpha Shop ',
    templateChannelId: 'template-1',
    administrator: {
        firstName: ' Alice ',
        lastName: ' Chen ',
        emailAddress: ' OWNER@EXAMPLE.COM ',
    },
};

describe('StoreProvisioningService', () => {
    it('creates one isolated store from a template Channel', async () => {
        const {
            administratorService,
            channel,
            channelService,
            roleService,
            sellerService,
            service,
            shippingMethodRepository,
            storeProfileService,
            merchantInitialPasswordService,
        } = createService();
        const ctx = {
            channelId: 'template-1',
            session: { user: { channelPermissions: [] } },
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
        expect(channelService.assignToChannels).toHaveBeenCalledWith(
            ctx,
            expect.any(Function),
            'stock-location-1',
            ['store-1'],
        );
        expect(channelService.assignToChannels).toHaveBeenCalledWith(
            ctx,
            expect.any(Function),
            'stock-location-2',
            ['store-1'],
        );
        expect(channelService.assignToChannels).toHaveBeenCalledWith(
            ctx,
            PaymentMethod,
            'payment-method-1',
            ['store-1'],
        );
        expect(channelService.assignToChannels).toHaveBeenCalledWith(
            ctx,
            ShippingMethod,
            'shipping-method-1',
            ['store-1'],
        );
        expect(shippingMethodRepository.find).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ deletedAt: expect.anything() }),
            }),
        );
        expect(channelService.assignToChannels).toHaveBeenCalledTimes(4);
        expect(storeProfileService.createDraft).toHaveBeenCalledWith(ctx, channel);
        expect(ctx.session.user.channelPermissions).toEqual([
            {
                id: 'store-1',
                token: 'server-generated-token',
                code: 'alpha-store',
                permissions: [Permission.SuperAdmin],
            },
        ]);
        expect(result).toMatchObject({
            sellerId: 'seller-1',
            channelId: 'store-1',
            roleId: 'store-role-1',
            administratorId: 'administrator-1',
            stockLocationId: 'stock-location-1',
            profileId: 'profile-1',
            channelCode: 'alpha-store',
        });
        expect(result.temporaryPassword.length).toBeGreaterThanOrEqual(24);
    });

    it('rejects invalid store identifiers before writing data', async () => {
        const { sellerService, service } = createService();

        await expect(service.provision({} as any, { ...input, code: 'Invalid code' })).rejects.toThrow(
            '网店编码',
        );
        expect(sellerService.create).not.toHaveBeenCalled();
    });

    it('rejects provisioning when the template has no shared inventory', async () => {
        const { stockLocationRepository, sellerService, service } = createService();
        stockLocationRepository.find.mockResolvedValueOnce([]);

        await expect(
            service.provision(
                { channelId: 'template-1', session: { user: { channelPermissions: [] } } } as any,
                input,
            ),
        ).rejects.toThrow('没有可共享的库存点');
        expect(sellerService.create).not.toHaveBeenCalled();
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
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateChannel);
        expect(storeAdministratorPermissions).not.toContain(Permission.DeleteChannel);
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateSeller);
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateAdministrator);
        expect(storeAdministratorPermissions).not.toContain(Permission.DeleteOrder);
        expect(storeAdministratorPermissions).not.toContain(Permission.CreateCatalog);
        expect(storeAdministratorPermissions).not.toContain(Permission.UpdateCatalog);
        expect(storeAdministratorPermissions).not.toContain(Permission.DeleteCatalog);
        expect(storeAdministratorPermissions).not.toContain(Permission.UpdateStockLocation);
    });
});
