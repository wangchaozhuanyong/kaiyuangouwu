import { describe, expect, it, vi } from 'vitest';

import { defaultPaymentProcess } from '../../config/payment/default-payment-process';
import { OrderModification } from '../../entity/order-modification/order-modification.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { totalCoveredByActualPayments } from '../helpers/utils/order-utils';

import { OrderService } from './order.service';
async function fixture() {
    const phases: string[] = [];
    const order: any = {
        id: 'order',
        salesChannelId: 'store',
        state: 'ArrangingAdditionalPayment',
        orderPlacedAt: new Date(),
        totalWithTax: 1500,
        couponCodes: [],
        payments: [
            new Payment({
                id: 'original',
                method: 'receipt',
                state: 'Settled',
                amount: 1000,
                metadata: {},
                refunds: [{ state: 'Settled', total: 100, lines: [] }] as any,
            }),
        ],
    };
    const modification = new OrderModification({ id: 'modification', priceChange: 500 });
    const repository: any = {
        save: vi.fn(() => {
            return Promise.resolve().then(() => {
                phases.push('associate');
            });
        }),
    };
    const query: any = { relation: () => query, of: () => query, add: vi.fn() };
    repository.createQueryBuilder = () => query;
    const service: any = Object.assign(Object.create(OrderService.prototype), {
        connection: { getRepository: () => repository },
        assertInTransaction: vi.fn(),
        lockOrderForRefund: vi.fn(() => {
            return Promise.resolve().then(() => {
                phases.push('lock');
            });
        }),
        getOrderOrThrow: vi.fn(() => Promise.resolve(order)),
        getOrderPayments: vi.fn(() => Promise.resolve(order.payments)),
        getOrderModifications: vi.fn(() => Promise.resolve([modification])),
        checkoutValidators: new Map(),
        revalidateCouponCodesForOrder: vi.fn(() => Promise.resolve([])),
        canAddPaymentToOrder: vi.fn(() => true),
        findOne: vi.fn(() => Promise.resolve(order)),
        transitionToState: vi.fn((_ctx, _id, state) => {
            return Promise.resolve().then(() => {
                expect(modification.payment).toBeDefined();
                phases.push('restore');
                order.state = state;
                return order;
            });
        }),
    });
    await defaultPaymentProcess.init?.({
        get(providerValue: any) {
            if (providerValue.name === 'OrderService') return service;
            return { createHistoryEntryForOrder: vi.fn() };
        },
    } as any);
    return { order, modification, service, phases };
}
function provider(test: Awaited<ReturnType<typeof fixture>>, state: string, metadata = {}, amount = 500) {
    return vi.fn(async (ctx, order, due, inputOrMethod, metadataOrCallback, callback) => {
        expect(due).toBe(500); // A 100 compensation never turns the new 500 price into a 600 charge.
        const payment = new Payment({
            id: 'topup',
            method: typeof inputOrMethod === 'string' ? inputOrMethod : inputOrMethod.method,
            state: state as any,
            metadata,
            amount,
            refunds: [],
        });
        test.phases.push('confirmed-save');
        test.order.payments.push(payment);
        await (callback ?? metadataOrCallback)(ctx, payment);
        test.phases.push('finalize');
        await defaultPaymentProcess.onTransitionEnd?.('Created', state as any, { ctx, order, payment });
        return payment;
    });
}
describe('additional payment completion', () => {
    describe.each(['manual', 'gateway'] as const)('initial placed-order %s collection', source => {
        it.each(['none', 'Cancelled', 'Declined'] as const)(
            'collects the full price when prior attempts are %s without claiming funds already exist',
            async previous => {
                const test = await fixture();
                test.order.state = previous === 'none' ? 'ArrangingPayment' : 'ArrangingAdditionalPayment';
                test.order.payments =
                    previous === 'none'
                        ? []
                        : [new Payment({ method: 'receipt', state: previous, amount: 1500 })];
                test.service.getOrderModifications.mockResolvedValue([]);
                const collect = vi.fn((_ctx: unknown, _order: unknown, _amount: number) =>
                    Promise.resolve(new Payment({ method: 'receipt', state: 'Settled', amount: 1500 })),
                );
                test.service.paymentService = { createManualPayment: collect, createPayment: collect };
                expect(totalCoveredByActualPayments(test.order)).toBeNaN();
                if (source === 'manual') {
                    await test.service.addManualPaymentToOrder(
                        {},
                        { orderId: 'order', method: 'receipt', transactionId: 'synthetic-first-receipt' },
                    );
                } else {
                    await test.service.addPaymentToOrder({}, 'order', { method: 'receipt', metadata: {} });
                }
                expect(collect).toHaveBeenCalledOnce();
                expect(collect.mock.calls[0][2]).toBe(1500);
            },
        );
        it.each([
            { name: 'pending custom validation', state: 'Validating', amount: 1500 },
            { name: 'unknown provider outcome', state: 'Created', amount: 1500 },
            { name: 'provider error without a receipt', state: 'Error', amount: 1500 },
            {
                name: 'failed authorization cancellation',
                state: 'Error',
                amount: 1500,
                transactionId: 'synthetic-authorization-not-revoked',
            },
            {
                name: 'controlled test',
                state: 'Settled',
                amount: 1500,
                method: 'controlled-test-payment-synthetic',
            },
            {
                name: 'test metadata',
                state: 'Settled',
                amount: 1500,
                metadata: { public: { testPayment: true } },
            },
            {
                name: 'manual review',
                state: 'Settled',
                amount: 1500,
                metadata: { manualReview: { required: true } },
            },
            { name: 'negative receipt', state: 'Settled', amount: -1 },
            { name: 'fractional receipt', state: 'Settled', amount: 0.5 },
            { name: 'unsafe receipt', state: 'Settled', amount: Number.MAX_SAFE_INTEGER + 1 },
            { name: 'overpayment', state: 'Settled', amount: 1600 },
        ])('rejects $name before starting another collection', async previous => {
            const test = await fixture();
            const priorPayment = new Payment({
                method: 'method' in previous ? previous.method : 'receipt',
                amount: previous.amount,
                state: previous.state as Payment['state'],
                transactionId: 'transactionId' in previous ? previous.transactionId : undefined,
            });
            priorPayment.metadata = 'metadata' in previous ? (previous.metadata ?? {}) : {};
            test.order.payments = [priorPayment];
            test.service.getOrderModifications.mockResolvedValue([]);
            const collect = vi.fn();
            test.service.paymentService = { createManualPayment: collect, createPayment: collect };
            const operation =
                source === 'manual'
                    ? test.service.addManualPaymentToOrder(
                          {},
                          { orderId: 'order', method: 'receipt', transactionId: 'synthetic-first-receipt' },
                      )
                    : test.service.addPaymentToOrder({}, 'order', { method: 'receipt', metadata: {} });
            await expect(operation).rejects.toThrow();
            expect(collect).not.toHaveBeenCalled();
        });
    });

    it.each(['PartiallyShipped', 'Shipped', 'PartiallyDelivered', 'Delivered', 'Cancelled'])(
        'preserves fulfillment history when funds settle on %s',
        async state => {
            const test = await fixture();
            test.order.state = state;
            test.order.payments.push(
                new Payment({ id: 'capture', method: 'receipt', state: 'Settled', amount: 500 }),
            );
            await defaultPaymentProcess.onTransitionEnd?.('Authorized', 'Settled', {
                ctx: {},
                order: test.order,
                payment: test.order.payments[1],
            } as any);
            expect(test.order.state).toBe(state);
            expect(test.service.transitionToState).not.toHaveBeenCalled();
        },
    );
    it.each(['manual', 'gateway'])(
        'associates a confirmed %s top-up before hooks restore the paid state',
        async source => {
            const test = await fixture();
            const create = provider(test, 'Settled');
            test.service.paymentService = { createManualPayment: create, createPayment: create };
            const result =
                source === 'manual'
                    ? await test.service.addManualPaymentToOrder(
                          {},
                          { orderId: 'order', method: 'receipt', transactionId: 'synthetic' },
                      )
                    : await test.service.addPaymentToOrder({}, 'order', { method: 'receipt', metadata: {} });
            expect(result.state).toBe('PaymentSettled');
            expect(test.modification.payment?.id).toBe('topup');
            expect(test.phases).toEqual(['lock', 'confirmed-save', 'associate', 'finalize', 'restore']);
        },
    );
    it('restores PaymentAuthorized for actual authorization without claiming settled funds', async () => {
        const test = await fixture();
        test.service.paymentService = { createPayment: provider(test, 'Authorized') };
        await test.service.addPaymentToOrder({}, 'order', { method: 'receipt', metadata: {} });
        expect(test.order.state).toBe('PaymentAuthorized');
        expect(totalCoveredByActualPayments(test.order, ['Settled'])).toBe(1000);
    });
    it.each(['pending', 'review', 'test-metadata', 'test-prefix', 'partial'])(
        'does not associate or restore %s money',
        async kind => {
            const test = await fixture();
            const metadata =
                kind === 'review'
                    ? { manualReview: { required: true } }
                    : kind === 'test-metadata'
                      ? { public: { testPayment: true } }
                      : {};
            test.service.paymentService = {
                createPayment: provider(
                    test,
                    kind === 'pending' ? 'Created' : 'Settled',
                    metadata,
                    kind === 'partial' ? 400 : 500,
                ),
            };
            await test.service.addPaymentToOrder({}, 'order', {
                method: kind === 'test-prefix' ? 'controlled-test-payment-synthetic' : 'receipt',
                metadata: {},
            });
            expect(test.modification.payment).toBeUndefined();
            expect(test.order.state).toBe('ArrangingAdditionalPayment');
            expect(test.service.transitionToState).not.toHaveBeenCalled();
        },
    );
    describe.each(['manual', 'gateway'] as const)('uncertain existing %s top-up', source => {
        it.each(['Created', 'Error', 'Validating'] as const)(
            'rejects another collection while the prior %s attempt remains unresolved',
            async state => {
                const test = await fixture();
                test.order.payments.push(
                    new Payment({
                        id: 'unknown',
                        method: 'receipt',
                        state: state as Payment['state'],
                        amount: 500,
                        transactionId: 'synthetic-unresolved-authorization',
                    }),
                );
                const collect = vi.fn();
                test.service.paymentService = { createManualPayment: collect, createPayment: collect };
                const operation =
                    source === 'manual'
                        ? test.service.addManualPaymentToOrder(
                              {},
                              {
                                  orderId: 'order',
                                  method: 'receipt',
                                  transactionId: 'synthetic-repeated-receipt',
                              },
                          )
                        : test.service.addPaymentToOrder({}, 'order', { method: 'receipt', metadata: {} });
                await expect(operation).rejects.toThrow('不能重复收取补款');
                expect(collect).not.toHaveBeenCalled();
            },
        );
    });
    it('keeps a direct creation hook pending until outstanding modifications have been associated', async () => {
        const test = await fixture();
        test.order.payments.push(
            new Payment({ id: 'topup', method: 'receipt', state: 'Settled', amount: 500 }),
        );
        await defaultPaymentProcess.onTransitionEnd?.('Created', 'Settled', {
            ctx: {},
            order: test.order,
            payment: test.order.payments[1],
        } as any);
        expect(test.service.transitionToState).not.toHaveBeenCalled();
    });
});
