import 'reflect-metadata';

import { ShippingMethod, TaxCategory, TaxRate, Zone } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import {
    normalizeStoreCommerceInput,
    shippingCalculatorInput,
    shippingCheckerInput,
    StoreCommerceSettingsService,
    storeShippingMethodCode,
    storeZoneName,
} from './store-commerce-settings.service';
import { UpdateMyStoreCommerceConfigurationInput } from './types';

const input: UpdateMyStoreCommerceConfigurationInput = {
    pricesIncludeTax: true,
    countryCode: ' my ',
    taxRate: 6,
    shippingMethodNameZh: ' 标准配送 ',
    shippingMethodNameEn: ' Standard delivery ',
    shippingDescriptionZh: ' 普通配送 ',
    shippingDescriptionEn: ' Standard shipping ',
    baseRate: 1200,
    freeShippingThreshold: 9900,
    shippingTaxRate: 6,
    shippingPriceIncludesTax: true,
    estimateMinDays: 2,
    estimateMaxDays: 5,
    blockedPostalPrefixes: ' 99, po-box;99 ',
};

describe('store commerce configuration helpers', () => {
    it('normalizes merchant input and creates deterministic resource names', () => {
        expect(normalizeStoreCommerceInput(input)).toEqual({
            ...input,
            countryCode: 'MY',
            shippingMethodNameZh: '标准配送',
            shippingMethodNameEn: 'Standard delivery',
            shippingDescriptionZh: '普通配送',
            shippingDescriptionEn: 'Standard shipping',
            blockedPostalPrefixes: '99,PO-BOX',
        });
        expect(storeShippingMethodCode('my-malaysia')).toBe('store-my-malaysia-standard-delivery');
        expect(storeZoneName('my-malaysia', 'tax')).toBe('Store my-malaysia tax');
    });

    it('rejects invalid rates and delivery ranges', () => {
        expect(() => normalizeStoreCommerceInput({ ...input, taxRate: 101 })).toThrow('商品税率');
        expect(() =>
            normalizeStoreCommerceInput({ ...input, estimateMinDays: 8, estimateMaxDays: 3 }),
        ).toThrow('最长配送天数');
        expect(() => normalizeStoreCommerceInput({ ...input, baseRate: -1 })).toThrow('基础运费');
    });

    it('maps the saved values to the registered shipping operations', () => {
        const normalized = normalizeStoreCommerceInput(input);
        expect(shippingCheckerInput(normalized.countryCode, normalized.blockedPostalPrefixes)).toEqual({
            code: 'supported-destination-eligibility-checker',
            arguments: [
                { name: 'allowedCountryCodes', value: 'MY' },
                { name: 'blockedPostalPrefixes', value: '99,PO-BOX' },
            ],
        });
        expect(shippingCalculatorInput(normalized)).toEqual({
            code: 'physical-subtotal-shipping-calculator',
            arguments: [
                { name: 'baseRate', value: '1200' },
                { name: 'freeAbove', value: '9900' },
                { name: 'taxRate', value: '6' },
                { name: 'priceIncludesTax', value: 'true' },
                { name: 'estimateMinDays', value: '2' },
                { name: 'estimateMaxDays', value: '5' },
            ],
        });
    });
});

describe('StoreCommerceSettingsService', () => {
    it('creates isolated zones, tax rates and shipping configuration for the active store', async () => {
        const zoneRepository = { findOne: vi.fn().mockResolvedValue(null) };
        const taxCategory = { id: 'tax-category-1', name: 'Standard', isDefault: true };
        const exemptTaxCategory = { id: 'tax-category-2', name: 'Exempt', isDefault: false };
        const taxCategoryRepository = {
            find: vi.fn().mockResolvedValue([taxCategory, exemptTaxCategory]),
        };
        const taxRateRepository = { findOne: vi.fn().mockResolvedValue(null) };
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === Zone) return zoneRepository;
                if (entity === TaxCategory) return taxCategoryRepository;
                if (entity === TaxRate) return taxRateRepository;
                throw new Error(`Unexpected repository: ${entity.name}`);
            }),
        };
        const channel = {
            id: 'channel-1',
            code: 'my-malaysia',
            defaultCurrencyCode: 'MYR',
            pricesIncludeTax: false,
            defaultTaxZone: { id: 'shared-tax-zone' },
            defaultShippingZone: { id: 'shared-shipping-zone' },
        };
        const updatedChannel = {
            ...channel,
            pricesIncludeTax: true,
            defaultTaxZone: { id: 'tax-zone-1' },
            defaultShippingZone: { id: 'shipping-zone-1' },
        };
        const channelService = {
            findOne: vi.fn().mockResolvedValue(channel),
            update: vi.fn().mockResolvedValue(updatedChannel),
            getDefaultChannel: vi.fn().mockResolvedValue({ id: 'default-channel' }),
            removeFromChannels: vi.fn().mockResolvedValue(undefined),
        };
        const countryService = {
            findOneByCode: vi.fn().mockResolvedValue({ id: 'country-my', enabled: true }),
        };
        const zoneService = {
            create: vi
                .fn()
                .mockResolvedValueOnce({ id: 'tax-zone-1', name: 'Store my-malaysia tax' })
                .mockResolvedValueOnce({ id: 'shipping-zone-1', name: 'Store my-malaysia shipping' }),
        };
        const taxRateService = { create: vi.fn().mockResolvedValue({ id: 'tax-rate-1' }) };
        const configuredMethod = { id: 'configured-method', code: storeShippingMethodCode(channel.code) };
        const placeholders = [
            { id: 'standard-method', code: 'standard-shipping' },
            { id: 'express-method', code: 'express-shipping' },
            { id: 'legacy-standard-method', code: '标准配送' },
        ];
        const shippingMethodService = {
            findAll: vi
                .fn()
                .mockResolvedValueOnce({ items: placeholders, totalItems: 2 })
                .mockResolvedValueOnce({ items: [...placeholders, configuredMethod], totalItems: 3 }),
            create: vi.fn().mockResolvedValue(configuredMethod),
        };
        const service = new StoreCommerceSettingsService(
            connection as any,
            channelService as any,
            countryService as any,
            zoneService as any,
            taxRateService as any,
            shippingMethodService as any,
        );
        const result = { channelId: channel.id, ready: true } as any;
        vi.spyOn(service, 'get').mockResolvedValue(result);
        const ctx = { channelId: channel.id } as any;

        await expect(service.update(ctx, input)).resolves.toBe(result);

        expect(zoneService.create).toHaveBeenCalledWith(ctx, {
            name: 'Store my-malaysia tax',
            memberIds: ['country-my'],
        });
        expect(zoneService.create).toHaveBeenCalledWith(ctx, {
            name: 'Store my-malaysia shipping',
            memberIds: ['country-my'],
        });
        expect(channelService.update).toHaveBeenCalledWith(ctx, {
            id: channel.id,
            pricesIncludeTax: true,
            defaultTaxZoneId: 'tax-zone-1',
            defaultShippingZoneId: 'shipping-zone-1',
        });
        expect(taxRateService.create).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({ categoryId: taxCategory.id, zoneId: 'tax-zone-1', value: 6 }),
        );
        expect(taxRateService.create).not.toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({ categoryId: exemptTaxCategory.id }),
        );
        expect(shippingMethodService.create).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                code: 'store-my-malaysia-standard-delivery',
                fulfillmentHandler: 'manual-fulfillment',
            }),
        );
        expect(channelService.removeFromChannels).toHaveBeenCalledWith(
            ctx,
            ShippingMethod,
            'standard-method',
            [channel.id],
        );
        expect(channelService.removeFromChannels).toHaveBeenCalledWith(
            ctx,
            ShippingMethod,
            'express-method',
            [channel.id],
        );
        expect(channelService.removeFromChannels).toHaveBeenCalledWith(
            ctx,
            ShippingMethod,
            'legacy-standard-method',
            [channel.id],
        );
    });
});
