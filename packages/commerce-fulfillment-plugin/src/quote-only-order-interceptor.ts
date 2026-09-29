import {
    EntityHydrator,
    Injector,
    Order,
    OrderInterceptor,
    RequestContext,
    WillAddItemToOrderInput,
    WillAdjustOrderLineInput,
} from '@vendure/core';

const quoteOnlyMessage = '此商品仅供展示，请联系客服询价，暂不能下单';

/** Protects every Vendure order API, including clients outside the storefront cart. */
export class QuoteOnlyOrderInterceptor implements OrderInterceptor {
    private entityHydrator: EntityHydrator;

    init(injector: Injector): void {
        this.entityHydrator = injector.get(EntityHydrator);
    }

    willAddItemToOrder(_ctx: RequestContext, _order: Order, input: WillAddItemToOrderInput): string | void {
        if (input.productVariant.product?.customFields?.pricingMode === 'QUOTE_ONLY') {
            return quoteOnlyMessage;
        }
    }

    async willAdjustOrderLine(
        ctx: RequestContext,
        _order: Order,
        input: WillAdjustOrderLineInput,
    ): Promise<string | void> {
        if (input.quantity <= 0 || !input.orderLine.productVariant) return;
        await this.entityHydrator.hydrate(ctx, input.orderLine.productVariant, { relations: ['product'] });
        if (input.orderLine.productVariant.product?.customFields?.pricingMode === 'QUOTE_ONLY') {
            return quoteOnlyMessage;
        }
    }
}
