import { describe, expect, it } from 'vitest';
import {
    getDraftOrderIncompleteReason,
    hasCompletePhysicalShippingAddress,
    orderLinesRequireShipping,
} from './draft-order-readiness.js';

describe('draft order readiness', () => {
    it('allows a digital-only draft without an address or shipping method', () => {
        expect(
            getDraftOrderIncompleteReason({
                hasCustomer: true,
                hasLines: true,
                requiresShipping: false,
                hasCompleteShippingAddress: false,
                hasShippingMethod: false,
                isDraftState: true,
            }),
        ).toBeNull();
    });

    it('requires a complete address before a shipping method for physical orders', () => {
        expect(
            getDraftOrderIncompleteReason({
                hasCustomer: true,
                hasLines: true,
                requiresShipping: true,
                hasCompleteShippingAddress: false,
                hasShippingMethod: true,
                isDraftState: true,
            }),
        ).toBe('shippingAddress');
    });

    it('treats missing phone numbers as an incomplete physical shipping address', () => {
        expect(
            hasCompletePhysicalShippingAddress({
                fullName: '测试客户',
                streetLine1: '中山路 123 号',
                city: '上海',
                province: '上海市',
                postalCode: '200000',
                countryCode: 'CN',
                phoneNumber: '',
            }),
        ).toBe(false);
    });

    it('requires shipping unless every order line is digital', () => {
        expect(orderLinesRequireShipping([{ customFields: { fulfillmentTypeSnapshot: 'digital' } }])).toBe(
            false,
        );
        expect(orderLinesRequireShipping([{ customFields: { fulfillmentTypeSnapshot: 'physical' } }])).toBe(
            true,
        );
        expect(orderLinesRequireShipping([{}])).toBe(true);
    });
});
