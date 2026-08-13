import { Order, OrderState, RequestContext, StockAllocationStrategy } from '@vendure/core';

/** Stock allocation is performed per physical order line by commerceOrderProcess. */
export class PhysicalOnlyStockAllocationStrategy implements StockAllocationStrategy {
    shouldAllocateStock(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean {
        return false;
    }
}
