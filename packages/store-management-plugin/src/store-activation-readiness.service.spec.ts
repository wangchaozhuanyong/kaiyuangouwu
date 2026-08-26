import { describe, expect, it } from 'vitest';

import {
    evaluateStoreActivationReadiness,
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
        expect(isProductionPaymentMethod(method('stripe', 'stripe-payment', 'Card payment'))).toBe(true);
        expect(
            isProductionPaymentMethod(
                method('stripe', 'stripe-payment', 'Card payment'),
                new Set(['another-handler']),
            ),
        ).toBe(false);
    });

    it('does not accept Chinese text stored in an English translation field', () => {
        expect(isUsableEnglishContent('Official ChatGPT Plus channel service')).toBe(true);
        expect(isUsableEnglishContent('ChatGPT Plus 为官方渠道服务')).toBe(false);
        expect(isUsableEnglishContent('<p>商品详情</p>')).toBe(false);
        expect(isUsableEnglishContent('')).toBe(false);
    });
});
