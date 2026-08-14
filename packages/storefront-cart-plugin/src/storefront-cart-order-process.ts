import { idsAreEqual, OrderProcess, TransactionalConnection } from '@vendure/core';

import { StorefrontCartCheckout } from './entities/storefront-cart-checkout.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';

let connection: TransactionalConnection;

export const storefrontCartOrderProcess: OrderProcess<string> = {
    init(injector) {
        connection = injector.get(TransactionalConnection);
    },

    async onTransitionStart(fromState, toState, { ctx, order }) {
        if (fromState !== 'AddingItems' || toState !== 'ArrangingPayment') {
            return;
        }
        const cart = await connection.getRepository(ctx, StorefrontCart).findOne({
            where: { channelId: ctx.channelId, checkoutOrderId: order.id },
            relations: ['lines'],
        });
        if (!cart) {
            return;
        }
        const checkout = await connection.getRepository(ctx, StorefrontCartCheckout).findOne({
            where: {
                cartId: cart.id,
                orderId: order.id,
                cartRevision: cart.revision,
                state: 'PREPARED',
            },
            relations: ['lines'],
        });
        if (!checkout) {
            return 'The storefront cart must be prepared before payment.';
        }
        const selectedLines = cart.lines.filter(line => line.selected);
        if (
            selectedLines.length !== checkout.lines.length ||
            selectedLines.length !== order.lines.length ||
            selectedLines.some(cartLine => {
                const snapshotLine = checkout.lines.find(line =>
                    idsAreEqual(line.productVariantId, cartLine.productVariantId),
                );
                const orderLine = order.lines.find(line =>
                    idsAreEqual(line.productVariantId, cartLine.productVariantId),
                );
                return snapshotLine?.quantity !== cartLine.quantity || orderLine?.quantity !== cartLine.quantity;
            })
        ) {
            return 'The storefront cart checkout snapshot does not match the order.';
        }
    },
};
