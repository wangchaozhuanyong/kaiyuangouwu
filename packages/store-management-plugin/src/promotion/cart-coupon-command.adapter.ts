import { Injectable, OnModuleInit } from '@nestjs/common';
import { OrderService } from '@vendure/core';
import { CartCommandService } from '@vendure/storefront-cart-plugin';

import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';

interface CouponCommand {
    action: 'APPLY' | 'REMOVE' | 'BEST' | 'APPLY_CODE' | 'REMOVE_CODE';
    couponId?: string;
    code?: string;
}

@Injectable()
export class CartCouponCommandAdapter implements OnModuleInit {
    constructor(
        private readonly commands: CartCommandService,
        private readonly coupons: StoreCouponLifecycleService,
        private readonly orders: OrderService,
    ) {}

    onModuleInit(): void {
        this.commands.register('coupon', async (ctx, input, cart) => {
            const command = input as CouponCommand;
            if (command.action === 'BEST') return this.coupons.applyBest(ctx);
            if (command.action === 'APPLY' && command.couponId)
                return this.coupons.apply(ctx, command.couponId);
            if (command.action === 'REMOVE' && command.couponId)
                return this.coupons.remove(ctx, command.couponId);
            if (cart.checkoutOrderId && command.code) {
                if (command.action === 'APPLY_CODE')
                    return this.orders.applyCouponCode(ctx, cart.checkoutOrderId, command.code);
                if (command.action === 'REMOVE_CODE')
                    return this.orders.removeCouponCode(ctx, cart.checkoutOrderId, command.code);
            }
            return { errorCode: 'INVALID_CART_COMMAND', message: 'Invalid coupon operation.' };
        });
    }
}
