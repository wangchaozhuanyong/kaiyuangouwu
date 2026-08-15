import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { StorefrontCartCheckoutLine } from './entities/storefront-cart-checkout-line.entity';
import { StorefrontCartCheckout } from './entities/storefront-cart-checkout.entity';
import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import { shopApiExtensions } from './api-extensions';
import { StorefrontCartLifecycleService } from './storefront-cart-lifecycle.service';
import { storefrontCartOrderProcess } from './storefront-cart-order-process';
import {
    StorefrontCartEntityResolver,
    StorefrontCartLineEntityResolver,
    StorefrontCartShopResolver,
} from './storefront-cart.resolver';
import { StorefrontCartService } from './storefront-cart.service';
import { StorefrontProductSalesService } from './storefront-product-sales.service';
import { reconcileStorefrontCartCheckoutsTask } from './storefront-cart-tasks';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [StorefrontCart, StorefrontCartLine, StorefrontCartCheckout, StorefrontCartCheckoutLine],
    providers: [StorefrontCartService, StorefrontCartLifecycleService, StorefrontProductSalesService],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            StorefrontCartShopResolver,
            StorefrontCartEntityResolver,
            StorefrontCartLineEntityResolver,
        ],
    },
    configuration: config => {
        config.orderOptions.process.push(storefrontCartOrderProcess);
        config.schedulerOptions.tasks.push(reconcileStorefrontCartCheckoutsTask);
        return config;
    },
    compatibility: '^3.7.0',
})
export class StorefrontCartPlugin {}
