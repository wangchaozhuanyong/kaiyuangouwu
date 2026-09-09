import { Injectable, OnModuleInit } from '@nestjs/common';
import { CartCommandService, StorefrontCartService } from '@vendure/storefront-cart-plugin';

import { AutoCardService } from './auto-card.service';
import {
    CustomerDeliveryEmailService,
    SetActiveOrderDeliveryEmailInput,
} from './customer-delivery-email.service';

@Injectable()
export class CartDeliveryCommandAdapter implements OnModuleInit {
    constructor(
        private readonly commands: CartCommandService,
        private readonly emails: CustomerDeliveryEmailService,
        private readonly carts: StorefrontCartService,
        private readonly autoCards: AutoCardService,
    ) {}

    onModuleInit(): void {
        this.carts.registerStockResolver(async (ctx, variant) => {
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
