import { APP_INTERCEPTOR } from '@nestjs/core';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { shopApiExtensions } from './api-extensions';
import { CartCommandService } from './cart-command.service';
import { StorefrontCartCheckoutLine } from './entities/storefront-cart-checkout-line.entity';
import { StorefrontCartCheckout } from './entities/storefront-cart-checkout.entity';
import { StorefrontCartCommandReceipt } from './entities/storefront-cart-command-receipt.entity';
import { StorefrontCartLine } from './entities/storefront-cart-line.entity';
import { StorefrontCart } from './entities/storefront-cart.entity';
import { StorefrontPaymentAttempt } from './entities/storefront-payment-attempt.entity';
import { StorefrontCartLifecycleService } from './storefront-cart-lifecycle.service';
import { storefrontCartOrderProcess } from './storefront-cart-order-process';
import { reconcileStorefrontCartCheckoutsTask } from './storefront-cart-tasks';
import {
    StorefrontCartEntityResolver,
    StorefrontCartLineEntityResolver,
    StorefrontCartShopResolver,
} from './storefront-cart.resolver';
import { StorefrontCartService } from './storefront-cart.service';
import { StorefrontPaymentAttemptInterceptor } from './storefront-payment-attempt.interceptor';
import { StorefrontPaymentAttemptResolver } from './storefront-payment-attempt.resolver';
import { StorefrontPaymentAttemptService } from './storefront-payment-attempt.service';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [
        StorefrontCartCommandReceipt,
        StorefrontCart,
        StorefrontCartLine,
        StorefrontCartCheckout,
        StorefrontCartCheckoutLine,
        StorefrontPaymentAttempt,
    ],
    exports: [CartCommandService, StorefrontCartService, StorefrontCartLifecycleService],
    providers: [
        CartCommandService,
        StorefrontCartService,
        StorefrontCartLifecycleService,
        StorefrontPaymentAttemptService,
        { provide: APP_INTERCEPTOR, useClass: StorefrontPaymentAttemptInterceptor },
    ],
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [
            StorefrontCartShopResolver,
            StorefrontCartEntityResolver,
            StorefrontCartLineEntityResolver,
            StorefrontPaymentAttemptResolver,
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
