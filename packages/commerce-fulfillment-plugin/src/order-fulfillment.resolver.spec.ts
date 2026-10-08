import { CurrencyCode, LanguageCode, Order, RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { physicalSubtotalShippingCalculator } from './commerce-shipping-options';
import { OrderFulfillmentResolver } from './order-fulfillment.resolver';

function requestContext(currencyCode: CurrencyCode) {
    return new RequestContext({
        apiType: 'shop',
        channel: {
            id: 'channel-1',
            defaultCurrencyCode: CurrencyCode.CNY,
            customFields: {
                cnyToMyrRate: 0.6,
                currencyRateMarkupBps: 0,
                currencyRoundingMode: 'CENT',
            },
        } as any,
        languageCode: LanguageCode.zh_Hans,
        currencyCode,
        isAuthorized: true,
        authorizedAsOwnerOnly: true,
    });
}

describe('OrderFulfillmentResolver', () => {
    it('returns a translated shipping method name when the raw name is unavailable', async () => {
        const shippingMethod = {
            code: 'store-test-standard-delivery',
            name: undefined,
            translations: [{ languageCode: 'zh_Hans', name: '测试标准配送' }],
            apply: vi.fn().mockResolvedValue({
                metadata: {
                    estimateMinDays: 3,
                    estimateMaxDays: 7,
                    freeShippingThreshold: 12300,
                    freeShippingApplied: false,
                },
            }),
        };
        const getEntityOrThrow = vi.fn().mockResolvedValue({
            currencyCode: CurrencyCode.CNY,
            shippingLines: [{ shippingMethod, discountedPriceWithTax: 123 }],
        });
        const resolver = new OrderFulfillmentResolver({ getEntityOrThrow } as any, {} as any);
        const ctx = requestContext(CurrencyCode.CNY);

        await expect(resolver.checkoutShipping(ctx, { id: 'order-1' } as any)).resolves.toEqual({
            methodCode: 'store-test-standard-delivery',
            methodName: '测试标准配送',
            priceWithTax: 123,
            estimateMinDays: 3,
            estimateMaxDays: 7,
            freeShippingThreshold: 12300,
            freeShippingApplied: false,
        });
        expect(getEntityOrThrow).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            'order-1',
            expect.objectContaining({
                relations: expect.arrayContaining(['shippingLines.shippingMethod.translations']),
            }),
        );

        shippingMethod.translations = [];
        await expect(resolver.checkoutShipping(ctx, { id: 'order-1' } as any)).resolves.toEqual(
            expect.objectContaining({ methodName: 'store-test-standard-delivery' }),
        );
        expect(shippingMethod.apply).toHaveBeenCalledWith(ctx, expect.anything());
    });

    it.each([
        {
            requestCurrency: CurrencyCode.CNY,
            orderCurrency: CurrencyCode.MYR,
            subtotal: 6500,
            threshold: 6000,
            free: true,
            price: 0,
        },
        {
            requestCurrency: CurrencyCode.MYR,
            orderCurrency: CurrencyCode.CNY,
            subtotal: 8000,
            threshold: 10000,
            free: false,
            price: 1200,
        },
        {
            requestCurrency: CurrencyCode.USD,
            orderCurrency: CurrencyCode.MYR,
            subtotal: 6500,
            threshold: 6000,
            free: true,
            price: 0,
        },
    ])(
        'calculates $orderCurrency shipping metadata independently of a $requestCurrency request',
        async fixture => {
            const calculatorArgs = [
                { name: 'baseRate', value: '1200' },
                { name: 'freeAbove', value: '10000' },
                { name: 'sourceCurrencyCode', value: 'CNY' },
                { name: 'taxRate', value: '0' },
                { name: 'priceIncludesTax', value: 'false' },
                { name: 'estimateMinDays', value: '2' },
                { name: 'estimateMaxDays', value: '4' },
            ];
            const shippingMethod = {
                code: 'standard-delivery',
                name: 'Standard delivery',
                apply: vi.fn((shippingCtx: RequestContext, shippingOrder: Order) =>
                    physicalSubtotalShippingCalculator.calculate(
                        shippingCtx,
                        shippingOrder,
                        calculatorArgs,
                        {} as any,
                    ),
                ),
            };
            const order = {
                id: 'order-1',
                currencyCode: fixture.orderCurrency,
                lines: [
                    {
                        quantity: 1,
                        discountedLinePriceWithTax: fixture.subtotal,
                        customFields: { fulfillmentTypeSnapshot: 'physical' },
                    },
                ],
                shippingLines: [{ shippingMethod, discountedPriceWithTax: fixture.price }],
            };
            const getEntityOrThrow = vi.fn().mockResolvedValue(order);
            const resolver = new OrderFulfillmentResolver({ getEntityOrThrow } as any, {} as any);
            const ctx = requestContext(fixture.requestCurrency);

            await expect(resolver.checkoutShipping(ctx, order as any)).resolves.toMatchObject({
                priceWithTax: fixture.price,
                freeShippingThreshold: fixture.threshold,
                freeShippingApplied: fixture.free,
                estimateMinDays: 2,
                estimateMaxDays: 4,
            });
            const calculationCtx = shippingMethod.apply.mock.calls[0][0];
            expect(calculationCtx.currencyCode).toBe(fixture.orderCurrency);
            expect(calculationCtx.channel).toBe(ctx.channel);
            expect(calculationCtx.languageCode).toBe(ctx.languageCode);
            expect(calculationCtx.authorizedAsOwnerOnly).toBe(ctx.authorizedAsOwnerOnly);
            expect(ctx.currencyCode).toBe(fixture.requestCurrency);
        },
    );
});
