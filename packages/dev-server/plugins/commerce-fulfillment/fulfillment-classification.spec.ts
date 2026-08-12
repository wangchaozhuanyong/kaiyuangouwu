import { describe, expect, it } from 'vitest';

import { hasCompleteShippingAddress, summarizeOrderFulfillment } from './fulfillment-classification';

function line(type: 'physical' | 'digital') {
    return {
        customFields: { fulfillmentTypeSnapshot: type },
        productVariant: { customFields: { fulfillmentType: type } },
    } as any;
}

describe('summarizeOrderFulfillment', () => {
    it('does not require address or shipping for a digital-only order', () => {
        expect(summarizeOrderFulfillment({ lines: [line('digital')] } as any)).toEqual({
            fulfillmentType: 'DIGITAL',
            containsPhysicalProducts: false,
            containsDigitalProducts: true,
            requiresShippingAddress: false,
            requiresShippingMethod: false,
        });
    });

    it('requires address and shipping for a mixed order', () => {
        expect(summarizeOrderFulfillment({ lines: [line('digital'), line('physical')] } as any)).toEqual({
            fulfillmentType: 'MIXED',
            containsPhysicalProducts: true,
            containsDigitalProducts: true,
            requiresShippingAddress: true,
            requiresShippingMethod: true,
        });
    });
});

describe('hasCompleteShippingAddress', () => {
    const completeAddress = {
        fullName: '测试用户',
        streetLine1: '南京西路 100 号',
        city: '上海市',
        province: '上海市',
        postalCode: '200000',
        countryCode: 'CN',
        phoneNumber: '13800000000',
    } as any;

    it('accepts a complete mainland China address for the China channel', () => {
        const ctx = { channel: { code: 'cn-mainland' } } as any;
        expect(hasCompleteShippingAddress(ctx, completeAddress)).toBe(true);
    });

    it('rejects an address whose country does not match the active channel', () => {
        const ctx = { channel: { code: 'my-malaysia' } } as any;
        expect(hasCompleteShippingAddress(ctx, completeAddress)).toBe(false);
    });
});
