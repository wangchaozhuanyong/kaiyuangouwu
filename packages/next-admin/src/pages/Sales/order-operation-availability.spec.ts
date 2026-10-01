import { describe, expect, it } from 'vitest';

import { canAddManualPayment, canCreatePhysicalFulfillment } from './order-operation-availability';

describe('canAddManualPayment', () => {
    it.each(['ArrangingPayment', 'ArrangingAdditionalPayment'])('allows manual payment in %s', state => {
        expect(canAddManualPayment(state, 100)).toBe(true);
    });

    it.each(['Draft', 'AddingItems', 'PaymentSettled', 'Cancelled'])('hides manual payment in %s', state => {
        expect(canAddManualPayment(state, 100)).toBe(false);
    });

    it('hides manual payment when no balance is outstanding', () => {
        expect(canAddManualPayment('ArrangingPayment', 0)).toBe(false);
    });
});

describe('canCreatePhysicalFulfillment', () => {
    it.each(['PaymentAuthorized', 'PaymentSettled', 'PartiallyShipped', 'PartiallyDelivered'])(
        'allows fulfillment in %s',
        state => {
            expect(canCreatePhysicalFulfillment(state)).toBe(true);
        },
    );

    it.each(['ArrangingPayment', 'ArrangingAdditionalPayment', 'Draft', 'Cancelled'])(
        'blocks fulfillment in %s',
        state => {
            expect(canCreatePhysicalFulfillment(state)).toBe(false);
        },
    );
});
