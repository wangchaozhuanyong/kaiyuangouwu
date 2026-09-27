import { OrderService, RequestContext } from '@vendure/core';
import { CartCommandService, StorefrontCart } from '@vendure/storefront-cart-plugin';
import { expect, it, vi } from 'vitest';

import { CartCouponCommandAdapter } from './cart-coupon-command.adapter';
import { StoreCouponLifecycleService } from './store-coupon-lifecycle.service';

it('reprojects the cart after BEST removes an ineligible locked coupon', async () => {
    const register = vi.fn<CartCommandService['register']>();
    const applyBest = vi.fn<StoreCouponLifecycleService['applyBest']>().mockResolvedValue(null);
    const adapter = new CartCouponCommandAdapter(
        { register } as unknown as CartCommandService,
        { applyBest } as unknown as StoreCouponLifecycleService,
        {} as OrderService,
    );
    adapter.onModuleInit();
    const [name, handler] = register.mock.calls[0];
    expect(name).toBe('coupon');
    const ctx = {} as RequestContext;
    const result = await handler(ctx, { action: 'BEST' }, {} as StorefrontCart);
    // CartCommandService treats null as no change and would keep the discounted projection.
    expect(result).not.toBeNull();
    expect(applyBest).toHaveBeenCalledWith(ctx);
});
