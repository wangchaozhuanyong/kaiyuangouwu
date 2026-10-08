import { Channel, ProductVariant } from '@vendure/core';
import { StoreDomain } from '@vendure/store-domain-plugin';
import { StorefrontContentBlock } from '@vendure/storefront-content-plugin';
import { DataSource, EntitySchema, FindManyOptions } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { physicalSubtotalShippingCalculator } from '../../commerce-fulfillment-plugin/src/commerce-shipping-options';

import { StoreAdministratorAccess } from './entities/store-administrator-access.entity';
import {
    evaluateStoreActivationReadiness,
    hasCompleteStoreProfile,
    hasReadyShippingMethod,
    isProductionPaymentMethod,
    isUsableEnglishContent,
    StoreActivationReadinessService,
    storeProfileActivationCheck,
} from './store-activation-readiness.service';

const completeSnapshot = {
    profile: true,
    domain: true,
    password: true,
    catalog: true,
    support: true,
    privacy: true,
    terms: true,
    shipping: true,
    payment: true,
};

const completeProfile = {
    channel: {
        customFields: {
            storefrontNameZh: 'MOYAO AI｜模钥',
            storefrontNameEn: 'MOYAO AI',
        },
    },
    descriptionZh: 'AI 软件商城',
    descriptionEn: 'AI software marketplace',
    logoAssetId: 'asset-logo',
    legalEntityName: 'MOYAO AI Example Limited',
    legalRegistrationCountry: 'Malaysia',
    supportEmail: 'support@moyaoai.com',
    privacyEmail: 'privacy@moyaoai.com',
} as any;

describe('catalog activation readiness with real SQLjs membership', () => {
    interface CatalogProduct {
        id: string;
        enabled: boolean;
        deletedAt: Date | null;
        translations: Array<Record<string, string>>;
        channels: Array<{ id: string }>;
    }
    interface CatalogVariant extends CatalogProduct {
        sku: string;
        product: CatalogProduct;
    }
    const channel = new EntitySchema<{ id: string }>({
        name: 'CatalogReadinessChannel',
        columns: { id: { type: String, primary: true } },
    });
    const columns = {
        id: { type: String, primary: true },
        enabled: { type: Boolean },
        // Production uses ordinary nullable columns, so TypeORM does not hide deleted rows.
        deletedAt: { type: Date, nullable: true },
        translations: { type: 'simple-json' as const },
    };
    const product = new EntitySchema<CatalogProduct>({
        name: 'CatalogReadinessProduct',
        columns,
        relations: { channels: { type: 'many-to-many', target: channel.options.name, joinTable: true } },
    });
    const variant = new EntitySchema<CatalogVariant>({
        name: 'CatalogReadinessVariant',
        columns: { ...columns, sku: { type: String } },
        relations: {
            product: { type: 'many-to-one', target: product.options.name },
            channels: { type: 'many-to-many', target: channel.options.name, joinTable: true },
        },
    });
    const database = new DataSource({
        type: 'sqljs',
        entities: [channel, product, variant],
        synchronize: true,
    });
    const productTranslations = [
        { languageCode: 'zh_Hans', name: '正式商品', slug: 'production-zh', description: '商品描述' },
        {
            languageCode: 'en',
            name: 'Production product',
            slug: 'production',
            description: 'Product details',
        },
    ];
    const variantTranslations = [
        { languageCode: 'zh_Hans', name: '标准版' },
        { languageCode: 'en', name: 'Standard' },
    ];
    beforeAll(async () => {
        await database.initialize();
        await database.getRepository(channel).save([{ id: 'store-a' }, { id: 'store-b' }]);
        await database.getRepository(product).save([
            {
                id: 'live',
                enabled: true,
                deletedAt: null,
                translations: productTranslations,
                channels: [{ id: 'store-a' }],
            },
            {
                id: 'deleted',
                enabled: true,
                deletedAt: new Date(),
                translations: [],
                channels: [{ id: 'store-a' }],
            },
            {
                id: 'removed',
                enabled: true,
                deletedAt: null,
                translations: [],
                channels: [{ id: 'store-b' }],
            },
        ]);
        await database.getRepository(variant).save([
            {
                id: 'live',
                sku: 'LIVE',
                enabled: true,
                deletedAt: null,
                translations: variantTranslations,
                product: { id: 'live' },
                channels: [{ id: 'store-a' }],
            },
            {
                id: 'deleted-variant',
                sku: 'DELETED-VARIANT',
                enabled: true,
                deletedAt: new Date(),
                translations: [],
                product: { id: 'live' },
                channels: [{ id: 'store-a' }],
            },
            {
                id: 'deleted-product',
                sku: 'DELETED-PRODUCT',
                enabled: true,
                deletedAt: null,
                translations: [],
                product: { id: 'deleted' },
                channels: [{ id: 'store-a' }],
            },
            {
                id: 'removed-product',
                sku: 'REMOVED-PRODUCT',
                enabled: true,
                deletedAt: null,
                translations: [],
                product: { id: 'removed' },
                channels: [{ id: 'store-a' }],
            },
        ]);
    });
    afterAll(async () => {
        if (database.isInitialized) await database.destroy();
    });
    async function catalogReady(): Promise<boolean> {
        const activeChannel = { id: 'store-a', customFields: { commerceMode: 'DIGITAL_ONLY' } };
        const accessQuery = {
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn().mockResolvedValue(0),
        };
        const connection = {
            getRepository: (_ctx: unknown, entity: unknown) => {
                if (entity === Channel) return { findOne: vi.fn().mockResolvedValue(activeChannel) };
                if (entity === StoreDomain) return { findOne: vi.fn().mockResolvedValue(null) };
                if (entity === StoreAdministratorAccess) return { createQueryBuilder: () => accessQuery };
                if (entity === StorefrontContentBlock) return { find: vi.fn().mockResolvedValue([]) };
                if (entity === ProductVariant) {
                    return {
                        find: (options: FindManyOptions<CatalogVariant>) =>
                            // JSON translations keep this SQL fixture small; membership and deletion
                            // predicates still run through the real TypeORM repository unchanged.
                            database
                                .getRepository(variant)
                                .find({ ...options, relations: { product: true } }),
                    };
                }
                throw new Error('Unexpected activation dependency');
            },
        };
        const shipping = { getActiveShippingMethods: vi.fn().mockResolvedValue([]) };
        const service = new StoreActivationReadinessService(connection as any, shipping as any);
        const readiness = await service.get({ copy: () => ({ channel: activeChannel }) } as any, {
            ...completeProfile,
            channelId: activeChannel.id,
        });
        return readiness.checks.find(check => check.code === 'CATALOG')?.ready ?? false;
    }
    it('ignores deleted variants, deleted products and products removed from the store', async () => {
        expect(await catalogReady()).toBe(true);
    });
    it.each(['name', 'slug', 'description'])(
        'still rejects an in-store product missing its English %s',
        async field => {
            const incomplete = productTranslations.map(translation =>
                translation.languageCode === 'en' ? { ...translation, [field]: '' } : translation,
            );
            await database.getRepository(product).update('live', { translations: incomplete });
            try {
                expect(await catalogReady()).toBe(false);
            } finally {
                await database.getRepository(product).update('live', { translations: productTranslations });
            }
        },
    );
    it.each(['zh_Hans', 'en'])('still rejects an in-store variant missing its %s name', async language => {
        const incomplete = variantTranslations.map(translation =>
            translation.languageCode === language ? { ...translation, name: '' } : translation,
        );
        await database.getRepository(variant).update('live', { translations: incomplete });
        try {
            expect(await catalogReady()).toBe(false);
        } finally {
            await database.getRepository(variant).update('live', { translations: variantTranslations });
        }
    });
});

describe('shipping activation readiness', () => {
    const channel = {
        code: 'store-a',
        defaultCurrencyCode: 'MYR',
        customFields: {},
        defaultShippingZone: { name: 'store-a-shipping', members: [{ code: 'MY', enabled: true }] },
    } as any;
    const shared = {
        checker: { code: 'store-shipping-zone-eligibility-checker' },
        calculator: { code: 'default-shipping-calculator', args: [{ name: 'rate', value: '0' }] },
    } as any;
    const physical = (sourceCurrency: string, baseRate = '1200', freeAbove = '0') => ({
        ...shared,
        calculator: {
            code: 'physical-subtotal-shipping-calculator',
            args: [
                { name: 'baseRate', value: baseRate },
                { name: 'freeAbove', value: freeAbove },
                { name: 'sourceCurrencyCode', value: sourceCurrency },
            ],
        },
    });
    it('accepts enabled public or owned regional templates without a required legacy code', () => {
        expect(hasReadyShippingMethod(channel, [shared])).toBe(true);
        expect(hasReadyShippingMethod(channel, [])).toBe(false);
    });
    it('does not accept an absent or empty store shipping region', () => {
        expect(hasReadyShippingMethod({ ...channel, defaultShippingZone: null }, [shared])).toBe(false);
        expect(hasReadyShippingMethod({ ...channel, defaultShippingZone: { members: [] } }, [shared])).toBe(
            false,
        );
        expect(
            hasReadyShippingMethod({ ...channel, defaultShippingZone: { members: [{ enabled: false }] } }, [
                shared,
            ]),
        ).toBe(false);
    });
    it('requires the template destination list to overlap an enabled store country', () => {
        const restricted = (value: string) => ({
            ...shared,
            checker: {
                code: 'store-shipping-zone-eligibility-checker',
                args: [{ name: 'allowedCountryCodes', value }],
            },
        });
        expect(hasReadyShippingMethod(channel, [restricted('US')])).toBe(false);
        expect(hasReadyShippingMethod(channel, [restricted('US, my')])).toBe(true);
        expect(hasReadyShippingMethod(channel, [restricted(JSON.stringify('MY'))])).toBe(true);
        expect(hasReadyShippingMethod(channel, [restricted('')])).toBe(true);
        expect(hasReadyShippingMethod(channel, [restricted('US'), shared])).toBe(true);
        expect(
            hasReadyShippingMethod(
                {
                    ...channel,
                    defaultShippingZone: {
                        members: [
                            { code: 'MY', enabled: true },
                            { code: 'SG', enabled: false },
                        ],
                    },
                },
                [restricted('SG')],
            ),
        ).toBe(false);
    });
    it('rejects a private shipping amount without a supported source-to-store currency path', () => {
        const unsupported = physical('USD');
        expect(hasReadyShippingMethod(channel, [unsupported])).toBe(false);
        expect(() =>
            physicalSubtotalShippingCalculator.calculate(
                { channel, currencyCode: channel.defaultCurrencyCode } as any,
                { lines: [] } as any,
                unsupported.calculator.args,
                unsupported,
            ),
        ).toThrow('运费币种汇率配置无效');
        expect(
            hasReadyShippingMethod({ ...channel, customFields: { cnyToMyrRate: 0.6 } }, [physical('USD')]),
        ).toBe(false);
    });
    it('requires the existing exchange rate for both fixed shipping and its free-shipping threshold', () => {
        expect(hasReadyShippingMethod(channel, [physical('CNY')])).toBe(false);
        expect(hasReadyShippingMethod(channel, [physical('CNY', '0', '9900')])).toBe(false);
        expect(
            hasReadyShippingMethod({ ...channel, customFields: { cnyToMyrRate: 0.6 } }, [
                physical('CNY', '1200', '9900'),
            ]),
        ).toBe(true);
    });
    it('keeps same-currency and legacy currency arguments usable without an exchange rate', () => {
        expect(hasReadyShippingMethod(channel, [physical('MYR')])).toBe(true);
        expect(hasReadyShippingMethod({ ...channel, defaultCurrencyCode: 'USD' }, [physical('USD')])).toBe(
            true,
        );
        const legacy = physical('');
        legacy.calculator.args.push({ name: 'currencyCode', value: 'CNY' });
        expect(hasReadyShippingMethod(channel, [legacy])).toBe(false);
        expect(hasReadyShippingMethod({ ...channel, customFields: { cnyToMyrRate: 0.6 } }, [legacy])).toBe(
            true,
        );
        expect(hasReadyShippingMethod(channel, [physical('')])).toBe(true);
    });
    it('keeps public zero-rate shipping ready even when another private template cannot convert', () => {
        expect(hasReadyShippingMethod(channel, [shared])).toBe(true);
        expect(hasReadyShippingMethod(channel, [physical('USD'), shared])).toBe(true);
    });
    it('does not accept absent or invalid fixed shipping amounts', () => {
        for (const amount of ['', '-1', 'invalid']) {
            expect(hasReadyShippingMethod(channel, [physical('MYR', amount)])).toBe(false);
            expect(hasReadyShippingMethod(channel, [physical('MYR', '1200', amount)])).toBe(false);
        }
    });
});

describe('store activation readiness', () => {
    it('is ready only when all launch checks pass', () => {
        const readiness = evaluateStoreActivationReadiness(completeSnapshot);

        expect(readiness.ready).toBe(true);
        expect(readiness.checks).toHaveLength(8);
        expect(readiness.checks.every(check => check.ready)).toBe(true);
    });

    it('returns every missing requirement for an incomplete store', () => {
        const readiness = evaluateStoreActivationReadiness({
            ...completeSnapshot,
            domain: false,
            terms: false,
            payment: false,
        });

        expect(readiness.ready).toBe(false);
        expect(readiness.checks.filter(check => !check.ready).map(check => check.code)).toEqual([
            'DOMAIN',
            'TERMS',
        ]);
    });

    it.each(['DIGITAL_ONLY', 'PHYSICAL_ONLY', 'HYBRID'] as const)(
        'allows %s stores to activate without a production payment method',
        commerceMode => {
            const readiness = evaluateStoreActivationReadiness(
                { ...completeSnapshot, payment: false },
                commerceMode,
            );

            expect(readiness.ready).toBe(true);
            expect(readiness.checks.some(check => check.code === 'PAYMENT')).toBe(false);
        },
    );

    it('does not consult payment methods or currency settings when reading launch checks', async () => {
        const channel = { id: 'store-1', customFields: { commerceMode: 'DIGITAL_ONLY' } };
        const accessQuery = {
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            andWhere: vi.fn().mockReturnThis(),
            getCount: vi.fn().mockResolvedValue(0),
        };
        const connection = {
            getRepository: vi.fn((_ctx, entity) => {
                if (entity === Channel) return { findOne: vi.fn().mockResolvedValue(channel) };
                if (entity === StoreDomain) return { findOne: vi.fn().mockResolvedValue(null) };
                if (entity === StoreAdministratorAccess) return { createQueryBuilder: () => accessQuery };
                if (entity === ProductVariant || entity === StorefrontContentBlock)
                    return { find: vi.fn().mockResolvedValue([]) };
                throw new Error('Unexpected activation dependency');
            }),
        };
        const shippingMethods = { getActiveShippingMethods: vi.fn().mockResolvedValue([]) };
        const service = new StoreActivationReadinessService(connection as any, shippingMethods as any);
        const ctx = { copy: vi.fn().mockReturnValue({ channel }) };

        const readiness = await service.get(ctx as any, { channelId: channel.id } as any);

        expect(readiness.ready).toBe(false);
        expect(readiness.checks.filter(check => !check.ready).map(check => check.code)).toEqual([
            'PROFILE',
            'DOMAIN',
            'CATALOG',
            'SUPPORT',
            'PRIVACY',
            'TERMS',
        ]);
    });

    it('never treats a test payment handler as production-ready', () => {
        const method = (code: string, handlerCode: string, name: string) =>
            ({
                code,
                handler: { code: handlerCode },
                translations: [{ name, description: '' }],
            }) as any;

        expect(isProductionPaymentMethod(method('dummy', 'dummy-payment-handler', 'Test payment'))).toBe(
            false,
        );
        expect(isProductionPaymentMethod(method('stripe-sandbox', 'stripe-payment', 'Card payment'))).toBe(
            false,
        );
        expect(
            isProductionPaymentMethod(method('referral-balance', 'referral-balance-payment', '邀请返利余额')),
        ).toBe(false);
        expect(isProductionPaymentMethod(method('stripe', 'stripe-payment', 'Card payment'))).toBe(true);
        expect(
            isProductionPaymentMethod(
                method('stripe', 'stripe-payment', 'Card payment'),
                new Set(['another-handler']),
            ),
        ).toBe(false);
        const usdt = method('usdt-trc20', 'usdt-trc20-chain-handler', 'USDT-TRC20');
        const registeredUsdtHandler = new Set(['usdt-trc20-chain-handler']);
        expect(isProductionPaymentMethod(usdt, registeredUsdtHandler)).toBe(false);
        expect(isProductionPaymentMethod(usdt, registeredUsdtHandler, true)).toBe(true);
        expect(
            isProductionPaymentMethod(
                method('usdt-trc20', 'other-handler', 'USDT-TRC20'),
                new Set(['other-handler']),
                true,
            ),
        ).toBe(false);
    });

    it('does not accept Chinese text stored in an English translation field', () => {
        expect(isUsableEnglishContent('Official ChatGPT Plus channel service')).toBe(true);
        expect(isUsableEnglishContent('ChatGPT Plus 为官方渠道服务')).toBe(false);
        expect(isUsableEnglishContent('<p>商品详情</p>')).toBe(false);
        expect(isUsableEnglishContent('')).toBe(false);
    });

    it.each([
        { description: '', tagline: null },
        { description: ' \n\t ', tagline: '' },
    ])('allows blank descriptions and no tagline ($description)', ({ description, tagline }) => {
        const profile = {
            ...completeProfile,
            descriptionZh: description,
            descriptionEn: description,
            taglineZh: tagline,
            taglineEn: tagline,
        };
        const profileCheck = storeProfileActivationCheck(profile);
        const readiness = evaluateStoreActivationReadiness({
            ...completeSnapshot,
            profile: profileCheck.ready,
        });

        expect(hasCompleteStoreProfile(profile)).toBe(true);
        expect(profileCheck).toMatchObject({ code: 'PROFILE', ready: true });
        expect(readiness.ready).toBe(true);
        expect(profileCheck.message).not.toContain('简介');
        expect(profileCheck.messageEn).not.toContain('description');
        expect(readiness.checks.find(check => check.code === 'PROFILE')?.message).not.toContain('简介');
        expect(readiness.checks.find(check => check.code === 'PROFILE')?.messageEn).not.toContain(
            'description',
        );
    });

    it.each([
        ['storefrontNameZh', '中文店铺名称', 'Chinese store name'],
        ['logoAssetId', '店铺图标', 'Store icon'],
        ['legalEntityName', '法定经营主体', 'Legal entity'],
        ['legalRegistrationCountry', '注册国家/地区', 'Registration country/region'],
        ['supportEmail', '客服邮箱', 'Support email'],
        ['privacyEmail', '隐私邮箱', 'Privacy email'],
    ])('still requires %s and reports only that field', (field, labelZh, labelEn) => {
        const profile = {
            ...completeProfile,
            descriptionZh: '',
            descriptionEn: '',
            [field]: '',
            ...(field === 'storefrontNameZh'
                ? { channel: { customFields: { ...completeProfile.channel.customFields, [field]: '' } } }
                : {}),
        };
        const profileCheck = storeProfileActivationCheck(profile);

        expect(hasCompleteStoreProfile(profile)).toBe(false);
        expect(profileCheck).toMatchObject({
            ready: false,
            message: `请在“编辑档案”补充：${labelZh}`,
            messageEn: `Complete in Edit profile: ${labelEn}`,
        });
        expect(profileCheck.message).not.toContain('简介');
        expect(profileCheck.messageEn).not.toContain('description');
    });

    it('requires legal identity and both contact emails in the store profile check', () => {
        expect(hasCompleteStoreProfile(completeProfile)).toBe(true);
        expect(hasCompleteStoreProfile({ ...completeProfile, privacyEmail: null })).toBe(false);
        expect(storeProfileActivationCheck(completeProfile)).toMatchObject({ code: 'PROFILE', ready: true });
        expect(storeProfileActivationCheck({ ...completeProfile, privacyEmail: null })).toMatchObject({
            ready: false,
            message: '请在“编辑档案”补充：隐私邮箱',
            messageEn: 'Complete in Edit profile: Privacy email',
        });

        const pendingTranslation = storeProfileActivationCheck({
            ...completeProfile,
            descriptionZh: '',
            descriptionEn: '',
            channel: { customFields: { ...completeProfile.channel.customFields, storefrontNameEn: '' } },
        });
        expect(pendingTranslation.ready).toBe(false);
        expect(pendingTranslation.message).toContain('英文资料尚未生成或未通过校验：店铺名称');
        expect(pendingTranslation.message).not.toContain('补充');
        expect(pendingTranslation.message).not.toContain('法定经营主体');
        expect(pendingTranslation.message).not.toContain('简介');
        expect(pendingTranslation.messageEn).toContain('English content is missing or invalid: store name');
        expect(pendingTranslation.messageEn).not.toContain('description');

        const missingIcon = storeProfileActivationCheck({ ...completeProfile, logoAssetId: null });
        expect(missingIcon.message).toBe('请在“编辑档案”补充：店铺图标');
        expect(missingIcon.ready).toBe(false);
        expect(
            storeProfileActivationCheck({
                ...completeProfile,
                channel: {
                    customFields: {
                        ...completeProfile.channel.customFields,
                        storefrontNameEn: 'AI 软件商城',
                    },
                },
            }).ready,
        ).toBe(false);
    });
});
