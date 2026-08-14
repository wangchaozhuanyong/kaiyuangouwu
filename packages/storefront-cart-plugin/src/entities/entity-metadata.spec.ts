import 'reflect-metadata';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { StorefrontCartCheckoutLine } from './storefront-cart-checkout-line.entity';
import { StorefrontCartCheckout } from './storefront-cart-checkout.entity';
import { StorefrontCartLine } from './storefront-cart-line.entity';
import { StorefrontCart } from './storefront-cart.entity';

describe('storefront cart entity metadata', () => {
    it('registers all four plugin entities', () => {
        const targets = getMetadataArgsStorage().tables.map(table => table.target);

        expect(targets).toEqual(
            expect.arrayContaining([
                StorefrontCart,
                StorefrontCartLine,
                StorefrontCartCheckout,
                StorefrontCartCheckoutLine,
            ]),
        );
    });

    it('enforces one cart per owner and one cart per active order', () => {
        const indices = getMetadataArgsStorage().indices.filter(index => index.target === StorefrontCart);
        const ownerIndex = indices.find(index => index.name === 'IDX_storefront_cart_owner');

        expect(indices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: 'IDX_storefront_cart_owner', unique: true }),
                expect.objectContaining({
                    name: 'IDX_storefront_cart_active_order',
                    unique: true,
                }),
            ]),
        );
        expect(ownerIndex?.columns).toEqual(['channelId', 'ownerType', 'ownerId']);
    });

    it('keeps checkout snapshots when their source cart line is removed', () => {
        const relation = getMetadataArgsStorage().relations.find(
            item => item.target === StorefrontCartCheckoutLine && item.propertyName === 'cartLine',
        );

        expect(relation?.options).toMatchObject({ nullable: true, onDelete: 'SET NULL' });
    });
});
