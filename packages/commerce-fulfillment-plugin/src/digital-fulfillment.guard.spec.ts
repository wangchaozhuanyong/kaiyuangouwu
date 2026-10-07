import type { Fulfillment, Order } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import {
    DIGITAL_FULFILLMENT_HANDLER_BY_MODE,
    guardDigitalFulfillment,
    type DigitalFulfillmentOrderSource,
} from './digital-fulfillment.guard';

function fixture(mode: keyof typeof DIGITAL_FULFILLMENT_HANDLER_BY_MODE = 'manual_service') {
    const current = {
        id: 'current',
        state: 'Created',
        handlerCode: DIGITAL_FULFILLMENT_HANDLER_BY_MODE[mode] as string,
        lines: [{ orderLineId: 'line-1', quantity: 2 }],
    };
    const order = {
        active: false as boolean,
        orderPlacedAt: new Date('2026-10-01T00:00:00Z') as Date | null,
        state: 'PaymentSettled',
        totalWithTax: 1000,
        lines: [
            {
                id: 'line-1',
                quantity: 2,
                orderPlacedQuantity: 2,
                customFields: { fulfillmentTypeSnapshot: 'digital', digitalDeliveryModeSnapshot: mode },
            },
        ],
        payments: [
            {
                state: 'Settled',
                amount: 1000,
                method: 'fixture-payment',
                metadata: { public: { testPayment: false } },
                refunds: [] as Array<{
                    state: string;
                    lines: Array<{ orderLineId: string; quantity: number }>;
                }>,
            },
        ],
        fulfillments: [current],
    } satisfies DigitalFulfillmentOrderSource;
    const statuses = [{ orderLineId: 'line-1', eligibleQuantity: 2, readyQuantity: 2, state: 'READY' }];
    return {
        order,
        current,
        statuses,
        check: (target: 'Pending' | 'Delivered' = 'Pending') =>
            guardDigitalFulfillment(order, current, statuses, target),
    };
}

describe('digital fulfillment readiness guard', () => {
    it('accepts existing core entity types without a projection cast', () => {
        const typedGuard: (
            order: Order,
            current: Fulfillment,
            statuses: Parameters<typeof guardDigitalFulfillment>[2],
            target: 'Pending' | 'Delivered',
        ) => string | void = guardDigitalFulfillment;
        expect(typedGuard).toBe(guardDigitalFulfillment);
    });

    it.each(['file_download', 'manual_service', 'auto_card'] as const)(
        'permits %s only through its matching handler with prepared content',
        mode => {
            const test = fixture(mode);
            expect(test.check()).toBeUndefined();
            test.current.state = 'Pending';
            expect(test.check('Delivered')).toBeUndefined();
        },
    );

    it('blocks a paid manual order without published content for both entry and completion', () => {
        const test = fixture();
        test.statuses[0].state = 'WAITING';
        test.statuses[0].readyQuantity = 0;
        expect(test.check()).toContain('成品尚未准备好');
        test.current.state = 'Pending';
        expect(test.check('Delivered')).toContain('成品尚未准备好');
    });

    it('does not accept notification success as proof of published content', () => {
        const test = fixture();
        test.statuses[0].state = 'SENT';
        expect(test.check()).toContain('成品尚未准备好');
    });

    it.each(['file_download', 'manual_service', 'auto_card'] as const)(
        'rejects a different digital handler for %s',
        mode => {
            const test = fixture(mode);
            test.current.handlerCode =
                mode === 'file_download' ? 'manual-service-fulfillment' : 'digital-fulfillment';
            expect(test.check()).toContain('交付方式不匹配');
        },
    );

    it.each(['physical', 'unknown'])('rejects %s fulfillment types', type => {
        const test = fixture();
        test.order.lines[0].customFields.fulfillmentTypeSnapshot = type;
        expect(test.check()).toContain('不能使用数字履约');
    });

    it('rejects a missing or invalid mode instead of choosing a manual default', () => {
        const test = fixture();
        test.order.lines[0].customFields.digitalDeliveryModeSnapshot = '';
        expect(test.check()).toContain('缺少有效数字交付方式');
    });

    it.each([
        'Cancelled',
        'Modifying',
        'ArrangingAdditionalPayment',
        'ArrangingPayment',
        'PaymentAuthorized',
    ])('rejects order state %s even with historical settled funds', state => {
        const test = fixture();
        test.order.state = state;
        expect(test.check()).toBeTypeOf('string');
    });

    it('requires a placed inactive order', () => {
        const test = fixture();
        test.order.active = true;
        expect(test.check()).toContain('尚未完成实际付款');
        test.order.active = false;
        test.order.orderPlacedAt = null;
        expect(test.check()).toContain('尚未完成实际付款');
    });

    it('rejects authorized funds and an outstanding top-up for digital content', () => {
        const test = fixture();
        test.order.payments[0].state = 'Authorized';
        expect(test.check()).toContain('足额实际收款');
        test.order.payments[0].state = 'Settled';
        test.order.totalWithTax = 1500;
        expect(test.check()).toContain('先处理补款');
    });

    it('excludes both controlled test methods and historical public test metadata', () => {
        const test = fixture();
        test.order.payments[0].method = 'controlled-test-payment-fixture';
        expect(test.check()).toContain('模拟付款');
        test.order.payments[0].method = 'fixture-payment';
        test.order.payments[0].metadata.public.testPayment = true;
        expect(test.check()).toContain('模拟付款');
    });

    it.each(
        (['file_download', 'manual_service', 'auto_card'] as const).flatMap(mode =>
            ['Settled', 'Authorized', 'Declined', 'Cancelled'].flatMap(state =>
                ['method', 'server-marker'].map(identity => ({ mode, state, identity })),
            ),
        ),
    )(
        'rejects $mode delivery with full real funds and $state test identity via $identity',
        ({ mode, state, identity }) => {
            const test = fixture(mode);
            test.order.payments.push({
                state,
                amount: 1000,
                method: identity === 'method' ? 'controlled-test-payment-platform' : 'historical-provider',
                metadata: { public: { testPayment: identity === 'server-marker' } },
                refunds: [],
            });
            expect(test.check()).toContain('模拟付款');
            test.current.state = 'Pending';
            expect(test.check('Delivered')).toContain('模拟付款');
        },
    );

    it.each(['Created', 'TestSettled', 'unknown', 'manual-review'])(
        'rejects review evidence %s even when another genuine payment covers the total',
        evidence => {
            const test = fixture();
            const order: DigitalFulfillmentOrderSource = {
                ...test.order,
                payments: [
                    ...test.order.payments,
                    {
                        state: evidence === 'manual-review' ? 'Settled' : evidence,
                        amount: 1,
                        method: 'real-provider',
                        metadata: { manualReview: { required: evidence === 'manual-review' } },
                        refunds: [],
                    },
                ],
            };
            expect(guardDigitalFulfillment(order, test.current, test.statuses, 'Pending')).toContain(
                '待核验',
            );
            test.current.state = 'Pending';
            expect(guardDigitalFulfillment(order, test.current, test.statuses, 'Delivered')).toContain(
                '待核验',
            );
        },
    );

    it('keeps genuinely funded historical orders eligible after declined real payment attempts', () => {
        const test = fixture();
        test.order.payments.push({
            state: 'Declined',
            amount: 1000,
            method: 'real-provider',
            metadata: { public: { testPayment: false } },
            refunds: [],
        });
        expect(test.check()).toBeUndefined();
    });

    it('allows a genuinely settled zero-price order but requires its real payment record', () => {
        const test = fixture();
        test.order.totalWithTax = 0;
        test.order.payments[0].amount = 0;
        expect(test.check()).toBeUndefined();
        test.order.payments.length = 0;
        expect(test.check()).toContain('实际收款');
    });

    it.each([NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid captured amount %s', amount => {
        const test = fixture();
        test.order.payments[0].amount = amount;
        expect(test.check()).toContain('收款金额记录异常');
    });

    it.each(['Pending', 'Settled'])('buy two refund one in %s permits precisely one prepared unit', state => {
        const test = fixture();
        test.order.payments[0].refunds.push({ state, lines: [{ orderLineId: 'line-1', quantity: 1 }] });
        test.statuses[0].eligibleQuantity = 1;
        test.statuses[0].readyQuantity = 1;
        expect(test.check()).toContain('超过有效成品剩余份数');
        test.current.lines[0].quantity = 1;
        expect(test.check()).toBeUndefined();
        test.current.state = 'Pending';
        expect(test.check('Delivered')).toBeUndefined();
    });

    it('does not subtract an item refund twice after quantity reduction', () => {
        const test = fixture();
        test.order.lines[0].quantity = 1;
        test.order.payments[0].refunds.push({
            state: 'Pending',
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
        });
        test.statuses[0].eligibleQuantity = test.statuses[0].readyQuantity = 1;
        test.current.lines[0].quantity = 1;
        expect(test.check()).toBeUndefined();
    });

    it('compensation without RefundLines and failed item refunds preserve both units', () => {
        const test = fixture();
        test.order.payments[0].refunds.push(
            { state: 'Settled', lines: [] },
            { state: 'Failed', lines: [{ orderLineId: 'line-1', quantity: 1 }] },
        );
        expect(test.check()).toBeUndefined();
    });

    it('requires refreshed projection after a Pending refund instead of trusting stale eligible units', () => {
        const test = fixture();
        test.order.payments[0].refunds.push({
            state: 'Pending',
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
        });
        expect(test.check()).toContain('资格已变化');
    });

    it('uses current quantity as the conservative historical baseline when placed quantity is zero', () => {
        const test = fixture();
        test.order.lines[0].orderPlacedQuantity = 0;
        test.order.payments[0].refunds.push({
            state: 'Pending',
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
        });
        test.statuses[0].eligibleQuantity =
            test.statuses[0].readyQuantity =
            test.current.lines[0].quantity =
                1;
        expect(test.check()).toBeUndefined();
    });

    it('requires exactly one private metadata record for each requested line', () => {
        const test = fixture();
        expect(guardDigitalFulfillment(test.order, test.current, [], 'Pending')).toContain(
            '成品记录缺失或重复',
        );
        test.statuses.push({ ...test.statuses[0] });
        expect(test.check()).toContain('成品记录缺失或重复');
    });

    it.each([NaN, -1, 1.5, 3])('rejects invalid or inflated ready units %s', ready => {
        const test = fixture();
        test.statuses[0].readyQuantity = ready;
        expect(test.check()).toContain('成品份数记录异常');
    });

    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects nonpositive or unsafe requested units %s',
        quantity => {
            const test = fixture();
            test.current.lines[0].quantity = quantity;
            expect(test.check()).toContain('份数必须是正整数');
        },
    );

    it('sums repeated references to the same order line before enforcing its ready budget', () => {
        const test = fixture();
        test.current.lines = [
            { orderLineId: 'line-1', quantity: 1 },
            { orderLineId: 'line-1', quantity: 1 },
        ];
        expect(test.check()).toBeUndefined();
        test.current.lines.push({ orderLineId: 'line-1', quantity: 1 });
        expect(test.check()).toContain('超过有效成品剩余份数');
    });

    it('rejects another order line and mixed physical content', () => {
        const test = fixture();
        test.current.lines.push({ orderLineId: 'other-order-line', quantity: 1 });
        expect(test.check()).toContain('不属于该订单');
        test.order.lines.push({
            ...test.order.lines[0],
            id: 'other-order-line',
            customFields: { ...test.order.lines[0].customFields, fulfillmentTypeSnapshot: 'physical' },
        });
        expect(test.check()).toContain('不能使用数字履约');
    });

    it.each(['Created', 'Pending', 'Shipped', 'Delivered'])(
        'reserves units occupied by another %s fulfillment',
        state => {
            const test = fixture();
            test.order.fulfillments.push({
                ...test.current,
                id: 'other',
                state,
                lines: [
                    { orderLineId: 'line-1', quantity: 1 },
                    { orderLineId: 'line-1', quantity: 1 },
                ],
            });
            test.current.lines[0].quantity = 1;
            expect(test.check()).toContain('超过有效成品剩余份数');
        },
    );

    it('ignores cancelled records and excludes the current record from its own reservation', () => {
        const test = fixture();
        test.order.fulfillments.push({ ...test.current, id: 'cancelled', state: 'Cancelled' });
        expect(test.check()).toBeUndefined();
        test.current.state = 'Pending';
        expect(test.check('Delivered')).toBeUndefined();
    });

    it('requires one additional published unit after two delivered units are extended to three', () => {
        const test = fixture();
        test.order.lines[0].quantity = test.order.lines[0].orderPlacedQuantity = 3;
        test.statuses[0].eligibleQuantity = 3;
        test.current.lines[0].quantity = 1;
        test.order.fulfillments.push({
            ...test.current,
            id: 'previous',
            state: 'Delivered',
            lines: [{ orderLineId: 'line-1', quantity: 2 }],
        });
        expect(test.check()).toContain('超过有效成品剩余份数');
        test.statuses[0].readyQuantity = 3;
        expect(test.check()).toBeUndefined();
    });

    it('rejects the second package after a locked reread includes the first Created reservation', () => {
        const test = fixture();
        test.statuses[0].readyQuantity = 1;
        test.current.lines[0].quantity = 1;
        expect(test.check()).toBeUndefined();
        test.order.fulfillments.push({ ...test.current, id: 'first-package' });
        expect(test.check()).toContain('超过有效成品剩余份数');
    });

    it('fails closed when the caller omitted refunds or fulfillment relations', () => {
        const test = fixture();
        expect(
            guardDigitalFulfillment(
                {
                    ...test.order,
                    payments: test.order.payments.map(payment => ({ ...payment, refunds: undefined })),
                },
                test.current,
                test.statuses,
                'Pending',
            ),
        ).toContain('退款记录未加载完整');
        expect(
            guardDigitalFulfillment(
                { ...test.order, fulfillments: undefined },
                test.current,
                test.statuses,
                'Pending',
            ),
        ).toContain('履约占用记录未加载完整');
    });

    it('does not mutate the order, fulfillment, or metadata', () => {
        const test = fixture();
        const before = JSON.stringify({ order: test.order, current: test.current, statuses: test.statuses });
        expect(test.check()).toBeUndefined();
        expect(JSON.stringify({ order: test.order, current: test.current, statuses: test.statuses })).toBe(
            before,
        );
    });
});
