import { Injectable, OnModuleInit } from '@nestjs/common';
import { CartCommandService, StorefrontCartService } from '@vendure/storefront-cart-plugin';

import { AutoCardService } from './auto-card.service';
import {
    CustomerDeliveryEmailService,
    SetActiveOrderDeliveryEmailInput,
} from './customer-delivery-email.service';
import { DigitalProductService } from './digital-product.service';

@Injectable()
export class CartDeliveryCommandAdapter implements OnModuleInit {
    constructor(
        private readonly commands: CartCommandService,
        private readonly emails: CustomerDeliveryEmailService,
        private readonly carts: StorefrontCartService,
        private readonly autoCards: AutoCardService,
        private readonly digitalProducts: DigitalProductService,
    ) {}

    onModuleInit(): void {
        this.carts.registerStockResolver(async (ctx, variant) => {
            const digital = await this.digitalProducts.available(ctx, variant);
            if (digital !== undefined) return digital === null ? Number.MAX_SAFE_INTEGER : digital;
            if (
                variant.customFields.fulfillmentType !== 'digital' ||
                variant.customFields.digitalDeliveryMode !== 'auto_card'
            )
                return undefined;
            return (await this.autoCards.availableStockForVariant(ctx, variant.id)) ?? 0;
        });
        this.commands.register('deliveryEmail', (ctx, value) =>
            this.emails.setActiveOrderEmail(ctx, value as SetActiveOrderDeliveryEmailInput),
        );
    }
}
