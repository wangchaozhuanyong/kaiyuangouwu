import { describe, expect, it } from 'vitest';

import { type Order, type StorefrontCart, type StorefrontCheckoutSession } from '../types';

import {
    checkoutContinuationIsCurrent,
    checkoutContinuationOwnerMatches,
    claimCheckoutContinuation,
    registerCheckoutContinuationOwner,
} from './checkout-continuation';

const order = {
    id: 'order-a',
    state: 'AddingItems',
    currencyCode: 'MYR',
    customer: { id: 'customer-a' },
} as Order;
const cart = { id: 'cart-a', revision: 8, state: 'OPEN', checkoutOrder: order } as StorefrontCart;
const session: StorefrontCheckoutSession = { cart, order, checkout: null };

describe('checkout continuation ownership', () => {
    it('accepts only a matched current purchase projection', () => {
        expect(checkoutContinuationIsCurrent(session, cart, 'customer-a', 'buyNow')).toBe(true);
        expect(checkoutContinuationIsCurrent(session, cart, 'customer-a', 'beginCheckout')).toBe(true);
    });

    it.each([
        ['account', session, cart, 'customer-b'],
        ['anonymous account', session, cart, undefined],
        ['cart', session, { ...cart, id: 'cart-b' }, 'customer-a'],
        ['revision', session, { ...cart, revision: 9 }, 'customer-a'],
        ['order', session, { ...cart, checkoutOrder: { ...order, id: 'order-b' } }, 'customer-a'],
        ['missing customer', { ...session, order: { ...order, customer: null } }, cart, 'customer-a'],
        ['state', { ...session, order: { ...order, state: 'Cancelled' } }, cart, 'customer-a'],
    ] as const)('rejects a mismatched %s', (_reason, candidate, latest, customerId) => {
        expect(checkoutContinuationIsCurrent(candidate, latest, customerId, 'buyNow')).toBe(false);
    });

    it('requires a prepared payment session at the same revision', () => {
        const paymentOrder = { ...order, state: 'ArrangingPayment' };
        const paymentCart: StorefrontCart = {
            ...cart,
            state: 'PAYMENT_PENDING',
            checkoutOrder: paymentOrder,
        };
        const payment: StorefrontCheckoutSession = {
            cart: paymentCart,
            order: paymentOrder,
            checkout: { id: 'checkout-a', state: 'PREPARED', cartRevision: 8, completedAt: null },
        };
        expect(checkoutContinuationIsCurrent(payment, paymentCart, 'customer-a', 'preparePayment')).toBe(
            true,
        );
        expect(checkoutContinuationIsCurrent(payment, paymentCart, 'customer-a', 'buyNow')).toBe(false);
        const checkout = payment.checkout;
        if (!checkout) throw new Error('Missing prepared fixture checkout');
        expect(
            checkoutContinuationIsCurrent(
                { ...payment, checkout: { ...checkout, state: 'ABANDONED' } },
                paymentCart,
                'customer-a',
                'preparePayment',
            ),
        ).toBe(false);
    });

    it('allows one navigation per command for the same controller, without leaking to another store', () => {
        const storeA = {};
        const storeB = {};
        expect(claimCheckoutContinuation(storeA, 'command-a')).toBe(true);
        expect(claimCheckoutContinuation(storeA, 'command-a')).toBe(false);
        expect(claimCheckoutContinuation(storeB, 'command-a')).toBe(true);
        expect(claimCheckoutContinuation(storeA, 'command-b')).toBe(true);
    });

    it('retains the original API owner when another API observes its pending command', () => {
        const controller = {};
        const apiA = {};
        const apiB = {};
        registerCheckoutContinuationOwner(controller, 'command-a', apiA);
        registerCheckoutContinuationOwner(controller, 'command-a', apiB);
        expect(checkoutContinuationOwnerMatches(controller, 'command-a', apiA)).toBe(true);
        expect(checkoutContinuationOwnerMatches(controller, 'command-a', apiB)).toBe(false);
    });

    it('rejects a changed order currency even when the cart revision and order identity match', () => {
        const otherCurrencyCart = { ...cart, checkoutOrder: { ...order, currencyCode: 'CNY' } };
        expect(checkoutContinuationIsCurrent(session, otherCurrencyCart, 'customer-a', 'buyNow')).toBe(false);
        expect(
            checkoutContinuationIsCurrent(
                { ...session, cart: otherCurrencyCart },
                cart,
                'customer-a',
                'buyNow',
            ),
        ).toBe(false);
    });
});
