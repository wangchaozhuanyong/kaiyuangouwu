import { Injectable, OnModuleInit } from '@nestjs/common';
import { CartCommandService } from '@vendure/storefront-cart-plugin';

import {
    CustomerDeliveryEmailService,
    SetActiveOrderDeliveryEmailInput,
} from './customer-delivery-email.service';

@Injectable()
export class CartDeliveryCommandAdapter implements OnModuleInit {
    constructor(
        private readonly commands: CartCommandService,
        private readonly emails: CustomerDeliveryEmailService,
    ) {}

    onModuleInit(): void {
        this.commands.register('deliveryEmail', (ctx, value) =>
            this.emails.setActiveOrderEmail(ctx, value as SetActiveOrderDeliveryEmailInput),
        );
    }
}
