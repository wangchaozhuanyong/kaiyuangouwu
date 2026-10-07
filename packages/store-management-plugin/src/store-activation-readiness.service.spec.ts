import { describe, expect, it } from 'vitest';

import { physicalSubtotalShippingCalculator } from '../../commerce-fulfillment-plugin/src/commerce-shipping-options';

import {
    evaluateStoreActivationReadiness,
    hasCompleteStoreProfile,
    hasReadyShippingMethod,
    isProductionPaymentMethod,
    isUsableEnglishContent,
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
        expect(readiness.checks).toHaveLength(9);
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
            'PAYMENT',
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

    it('requires legal identity and both contact emails in the store profile check', () => {
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

        expect(hasCompleteStoreProfile(completeProfile)).toBe(true);
        expect(hasCompleteStoreProfile({ ...completeProfile, privacyEmail: null })).toBe(false);
    });
});
