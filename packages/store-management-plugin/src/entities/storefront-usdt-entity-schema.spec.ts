import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { StoreUsdtReconciliationAction } from './store-usdt-reconciliation-action.entity';
import { StorefrontUsdtCheckoutQuote } from './storefront-usdt-checkout-quote.entity';
import { StorefrontUsdtPaymentIntent } from './storefront-usdt-payment-intent.entity';

function foreignKeyNames(
    target: typeof StorefrontUsdtCheckoutQuote | typeof StorefrontUsdtPaymentIntent,
): Record<string, string | undefined> {
    return Object.fromEntries(
        getMetadataArgsStorage()
            .joinColumns.filter(column => column.target === target)
            .map(column => [column.propertyName, column.foreignKeyConstraintName]),
    );
}

describe('storefront USDT entity schema', () => {
    it('uses the stable checkout quote foreign-key names created by the migration', () => {
        expect(foreignKeyNames(StorefrontUsdtCheckoutQuote)).toEqual({
            channel: 'FK_storefront_usdt_quote_channel',
            order: 'FK_storefront_usdt_quote_order',
        });
    });

    it('uses the stable payment intent foreign-key names created by the migration', () => {
        expect(foreignKeyNames(StorefrontUsdtPaymentIntent)).toEqual({
            channel: 'FK_storefront_usdt_intent_channel',
            order: 'FK_storefront_usdt_intent_order',
            quote: 'FK_storefront_usdt_intent_quote',
            payment: 'FK_storefront_usdt_intent_payment',
        });
    });

    it('keeps reconciliation evidence indexed by intent, channel and unique chain transaction', () => {
        const indices = getMetadataArgsStorage().indices.filter(
            index => index.target === StoreUsdtReconciliationAction,
        );
        expect(indices.map(index => index.name)).toEqual(
            expect.arrayContaining([
                'IDX_store_usdt_reconciliation_intent_created',
                'IDX_store_usdt_reconciliation_channel_created',
                'IDX_store_usdt_reconciliation_transaction',
            ]),
        );
        expect(
            indices.find(index => index.name === 'IDX_store_usdt_reconciliation_transaction'),
        ).toMatchObject({ unique: true });
    });
});
