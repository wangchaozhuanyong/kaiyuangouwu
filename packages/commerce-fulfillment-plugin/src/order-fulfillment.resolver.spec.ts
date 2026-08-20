import { describe, expect, it, vi } from 'vitest';

import { OrderFulfillmentResolver } from './order-fulfillment.resolver';

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
            shippingLines: [{ shippingMethod, discountedPriceWithTax: 123 }],
        });
        const resolver = new OrderFulfillmentResolver({ getEntityOrThrow } as any, {} as any);

        await expect(
            resolver.checkoutShipping({ languageCode: 'zh_Hans' } as any, { id: 'order-1' } as any),
        ).resolves.toEqual({
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
        await expect(
            resolver.checkoutShipping({ languageCode: 'zh_Hans' } as any, { id: 'order-1' } as any),
        ).resolves.toEqual(expect.objectContaining({ methodName: 'store-test-standard-delivery' }));
    });
});
