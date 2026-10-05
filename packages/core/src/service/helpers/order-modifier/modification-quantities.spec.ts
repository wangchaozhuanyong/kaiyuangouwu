import type { ModifyOrderInput } from '@vendure/common/lib/generated-types';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { Order } from '../../../entity/order/order.entity';

import { orderPlacedQuantityAfterModification } from './modification-quantities';
import { OrderModifier } from './order-modifier';
function setupQuantities(limit: number, quantities = [3, 3]) {
    const ctx = {} as any;
    const order = {
        id: 'order-1',
        state: 'Modifying',
        active: false,
        updatedAt: new Date('2026-10-04T00:00:00Z'),
        totalWithTax: 1000,
        shippingWithTax: 0,
        shippingLines: [],
        surcharges: [],
        couponCodes: [],
        lines: quantities.map((quantity, index) => ({
            id: `line-${index + 1}`,
            quantity,
            orderPlacedQuantity: quantity,
            productVariantId: `variant-${index + 1}`,
            productVariant: { id: `variant-${index + 1}` },
            customFields: {},
        })),
    } as unknown as Order;
    const save = vi.fn(entity => Promise.resolve(entity));
    const modifier = Object.assign(Object.create(OrderModifier.prototype), {
        connection: { getRepository: () => ({ save }) },
        configService: {
            orderOptions: {
                orderItemsLimit: limit,
                orderItemPriceCalculationStrategy: {
                    calculateUnitPrice: () => Promise.resolve({ price: 100, priceIncludesTax: true }),
                },
            },
        },
        orderCalculator: { applyPriceAdjustments: vi.fn().mockResolvedValue(undefined) },
        promotionService: {
            getActivePromotionsInChannel: () => Promise.resolve([]),
            getActivePromotionsOnOrder: () => Promise.resolve([]),
            runPromotionSideEffects: () => Promise.resolve(undefined),
        },
        productVariantService: { applyChannelPriceAndTax: variant => Promise.resolve(variant) },
        eventBus: { publish: () => Promise.resolve(undefined) },
        constrainQuantityToSaleable: (_ctx, _variant, quantity) => Promise.resolve(quantity),
        getOrCreateOrderLine: (_ctx, owner, variantId) =>
            Promise.resolve(owner.lines.find(line => line.productVariantId === variantId)),
        updateOrderLineQuantity: async (_ctx, line, quantity) => {
            line.quantity = quantity;
            await save(line);
            return line;
        },
        cancelOrderByOrderLines: () => Promise.resolve(undefined),
    }) as OrderModifier;
    const modify = (input: Partial<ModifyOrderInput>) =>
        modifier.modifyOrder(ctx, { orderId: order.id, ...input }, order);
    return { order, modifier, save, modify };
}
describe('sold quantity after order modification', () => {
    it('records added units as a positive modification and persists the increased sold baseline', async () => {
        const test = setupQuantities(10, [3]);
        const result = await test.modify({ addItems: [{ productVariantId: 'variant-1', quantity: 2 }] });
        expect(result).toMatchObject({ modification: { lines: [{ quantity: 2 }] } });
        expect(test.order.lines[0]).toMatchObject({ quantity: 5, orderPlacedQuantity: 5 });
    });
    it('validates successive adjusted rows using the resulting whole-order quantity', async () => {
        const test = setupQuantities(8);
        const result = await test.modify({
            adjustOrderLines: [
                { orderLineId: 'line-1', quantity: 4 },
                { orderLineId: 'line-2', quantity: 4 },
            ],
        });
        expect(result).toHaveProperty('modification');
        expect(test.order.lines.map(line => line.quantity)).toEqual([4, 4]);
        expect(test.order.lines.map(line => line.orderPlacedQuantity)).toEqual([4, 4]);
    });
    it('releases the quantity-limit space from an earlier reduced row for a later increase', async () => {
        const test = setupQuantities(6);
        const result = await test.modify({
            adjustOrderLines: [
                { orderLineId: 'line-1', quantity: 2 },
                { orderLineId: 'line-2', quantity: 4 },
            ],
        });
        expect(result).toHaveProperty('modification');
        expect(test.order.lines.map(line => line.quantity)).toEqual([2, 4]);
        expect(test.order.lines.map(line => line.orderPlacedQuantity)).toEqual([3, 4]);
    });
    it('keeps the persisted historical baseline untouched while previewing an increase', async () => {
        const test = setupQuantities(10, [3]);
        await test.modify({ dryRun: true, addItems: [{ productVariantId: 'variant-1', quantity: 2 }] });
        expect(test.order.lines[0].orderPlacedQuantity).toBe(3);
        expect(
            test.save.mock.calls
                .filter(([row]) => !Array.isArray(row) && row?.id === 'line-1')
                .every(([row]) => row.orderPlacedQuantity === 3),
        ).toBe(true);
    });
    it('initializes the baseline for a newly added line during a committed modification', async () => {
        const test = setupQuantities(10, [0]);
        await test.modify({ addItems: [{ productVariantId: 'variant-1', quantity: 2 }] });
        expect(test.order.lines[0]).toMatchObject({ quantity: 2, orderPlacedQuantity: 2 });
    });
    it('includes newly added units in delivery and refund eligibility for an existing line', () => {
        const placed = orderPlacedQuantityAfterModification(3, 3, 5);
        expect(placed).toBe(5);
        expect(Math.min(5, placed)).toBe(5);
    });
    it('retains already refunded units when an existing line gains additional quantities', () => {
        const refunded = 1;
        const placed = orderPlacedQuantityAfterModification(3, 2, 4);
        expect(placed).toBe(5);
        expect(Math.min(4, placed - refunded)).toBe(4);
        expect(orderPlacedQuantityAfterModification(placed, 4, 3)).toBe(5);
        expect(Math.min(3, placed - refunded - 1)).toBe(3);
    });
    it('initializes new modification lines and legacy zero-baseline lines from the actual quantities', () => {
        expect(orderPlacedQuantityAfterModification(0, 0, 2)).toBe(2);
        expect(orderPlacedQuantityAfterModification(0, 3, 5)).toBe(5);
    });
    it('keeps the historic baseline on cancellation and zero-change edits', () => {
        expect(orderPlacedQuantityAfterModification(5, 3, 2)).toBe(5);
        expect(orderPlacedQuantityAfterModification(5, 3, 3)).toBe(5);
    });
});
