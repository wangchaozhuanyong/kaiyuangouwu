import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    EventBus,
    OrderLine,
    OrderLineEvent,
    ProductVariant,
    ProductVariantEvent,
    TransactionalConnection,
} from '@vendure/core';

@Injectable()
export class FulfillmentModelService implements OnApplicationBootstrap {
    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus.registerBlockingEventHandler({
            event: ProductVariantEvent,
            id: 'commerce-fulfillment-sync-digital-inventory',
            handler: event => this.syncDigitalInventory(event),
        });
        this.eventBus.registerBlockingEventHandler({
            event: OrderLineEvent,
            id: 'commerce-fulfillment-snapshot-order-line-type',
            handler: event => this.snapshotOrderLineType(event),
        });
    }

    private async syncDigitalInventory(event: ProductVariantEvent): Promise<void> {
        if (event.type === 'deleted') {
            return;
        }
        const digitalVariants = event.entity.filter(
            variant => variant.customFields?.fulfillmentType === 'digital',
        );
        for (const variant of digitalVariants) {
            if (variant.trackInventory === GlobalFlag.FALSE) {
                continue;
            }
            variant.trackInventory = GlobalFlag.FALSE;
            await this.connection.getRepository(event.ctx, ProductVariant).save(variant, { reload: false });
        }
    }

    private async snapshotOrderLineType(event: OrderLineEvent): Promise<void> {
        if (event.type !== 'created') {
            return;
        }
        const fulfillmentType = event.orderLine.productVariant.customFields?.fulfillmentType ?? 'physical';
        const digitalDeliveryMode =
            event.orderLine.productVariant.customFields?.digitalDeliveryMode ?? 'manual_service';
        event.orderLine.customFields = {
            ...event.orderLine.customFields,
            fulfillmentTypeSnapshot: fulfillmentType,
            digitalDeliveryModeSnapshot: digitalDeliveryMode,
        };
        await this.connection.getRepository(event.ctx, OrderLine).save(event.orderLine, { reload: false });
    }
}
