import { Args, Mutation, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    Order,
    Permission,
    RequestContext,
    ShippingMethod,
    Transaction,
    TransactionalConnection,
} from '@vendure/core';

import { CustomerOrderCancellationService } from './customer-order-cancellation.service';
import { summarizeOrderFulfillment } from './fulfillment-classification';
import { DigitalDeliveryService } from './digital-delivery.service';

@Resolver('Order')
export class OrderFulfillmentResolver {
    constructor(
        private readonly connection: TransactionalConnection,
        private readonly digitalDeliveryService: DigitalDeliveryService,
    ) {}

    @ResolveField()
    async checkoutFulfillment(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const orderWithLines = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: ['lines', 'lines.productVariant'],
        });
        return summarizeOrderFulfillment(orderWithLines);
    }

    @ResolveField()
    async checkoutShipping(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        const orderWithShipping = await this.connection.getEntityOrThrow(ctx, Order, order.id, {
            relations: [
                'lines',
                'lines.productVariant',
                'shippingLines',
                'shippingLines.shippingMethod',
                'shippingLines.shippingMethod.translations',
            ],
        });
        const shippingLine = orderWithShipping.shippingLines?.[0];
        if (!shippingLine?.shippingMethod) {
            return null;
        }
        const calculation = await shippingLine.shippingMethod.apply(ctx, orderWithShipping);
        const metadata = (calculation?.metadata ?? {}) as Record<string, unknown>;
        const estimateMinDays = optionalNonNegativeInteger(metadata.estimateMinDays);
        const estimateMaxDays = optionalNonNegativeInteger(metadata.estimateMaxDays);
        const freeShippingThreshold = optionalNonNegativeInteger(metadata.freeShippingThreshold);
        return {
            methodCode: shippingLine.shippingMethod.code,
            methodName: checkoutShippingMethodName(ctx, shippingLine.shippingMethod),
            priceWithTax: shippingLine.discountedPriceWithTax,
            estimateMinDays,
            estimateMaxDays,
            freeShippingThreshold,
            freeShippingApplied:
                typeof metadata.freeShippingApplied === 'boolean'
                    ? metadata.freeShippingApplied
                    : shippingLine.discountedPriceWithTax === 0,
        };
    }

    @ResolveField()
    async digitalDeliveries(@Ctx() ctx: RequestContext, @Parent() order: Order) {
        return this.digitalDeliveryService.deliveriesForOrder(ctx, String(order.id));
    }
}

@Resolver()
export class CustomerOrderCancellationResolver {
    constructor(private readonly cancellationService: CustomerOrderCancellationService) {}

    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    cancelMyAuthorizedOrder(
        @Ctx() ctx: RequestContext,
        @Args('orderId') orderId: string,
        @Args('reason') reason: string,
    ) {
        return this.cancellationService.cancelAuthorizedPhysicalOrder(ctx, orderId, reason);
    }
}

function checkoutShippingMethodName(ctx: RequestContext, shippingMethod: ShippingMethod): string {
    const translations = shippingMethod.translations ?? [];
    const localizedName = translations
        .find(translation => translation.languageCode === ctx.languageCode)
        ?.name?.trim();
    const directName = shippingMethod.name?.trim();
    const translatedName = translations
        .map(translation => translation.name?.trim())
        .find((name): name is string => Boolean(name));
    return localizedName || directName || translatedName || shippingMethod.code;
}

function optionalNonNegativeInteger(value: unknown): number | null {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
}
