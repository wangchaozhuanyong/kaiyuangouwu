import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { EventBus, OrderLine, OrderLineEvent, TransactionalConnection } from '@vendure/core';

@Injectable()
export class FulfillmentModelService implements OnApplicationBootstrap {
    constructor(
        private readonly eventBus: EventBus,
        private readonly connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap(): void {
        this.eventBus.registerBlockingEventHandler({
            event: OrderLineEvent,
            id: 'commerce-fulfillment-snapshot-order-line-type',
            handler: event => this.snapshotOrderLineType(event),
        });
    }

    private async snapshotOrderLineType(event: OrderLineEvent): Promise<void> {
        if (event.type !== 'created') {
            return;
        }
        const fulfillmentType = event.orderLine.productVariant.customFields?.fulfillmentType ?? 'physical';
        event.orderLine.customFields = {
            ...event.orderLine.customFields,
            fulfillmentTypeSnapshot: fulfillmentType,
        };
        await this.connection.getRepository(event.ctx, OrderLine).save(event.orderLine, { reload: false });
    }
}
