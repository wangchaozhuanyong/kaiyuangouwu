import { LanguageCode, RefundOrderInput, RefundReasonType } from '@vendure/common/lib/generated-types';
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';

import { PaymentMethodHandler, RefundSettlementMode } from '../../config/payment/payment-method-handler';
import { Order } from '../../entity/order/order.entity';
import { RefundLine } from '../../entity/order-line-reference/refund-line.entity';
import { Payment } from '../../entity/payment/payment.entity';
import { Refund } from '../../entity/refund/refund.entity';
import { PaymentAttemptEvent } from '../../event-bus/events/payment-attempt-event';
import { orderPlacedQuantityAfterModification } from '../helpers/order-modifier/modification-quantities';

import { OrderService } from './order.service';
import { PaymentService } from './payment.service';
function setup(mode: RefundSettlementMode = 'automatic') {
    const ctx = { channelId: 'store-1', activeUserId: 'admin-1' } as any;
    const order = {
        id: 'order-1',
        salesChannelId: ctx.channelId,
        state: 'PaymentSettled',
        shippingWithTax: 200,
        totalWithTax: 1000,
        currencyCode: 'CNY',
        payments: [],
        lines: [{ id: 'line-1', quantity: 3, orderPlacedQuantity: 3 }],
    } as unknown as Order;
    const payment = new Payment({
        id: 'payment-1',
        state: 'Settled',
        amount: 1000,
        method: 'receipt-method',
        metadata: {},
        refunds: [],
        order,
    });
    order.payments = [payment];
    const provider = vi.fn().mockResolvedValue({ state: 'Settled', transactionId: 'refund-receipt-1' });
    const handler = new PaymentMethodHandler({
        code: 'receipt-handler',
        description: [{ languageCode: LanguageCode.en, value: 'Receipt handler' }],
        args: {},
        createPayment: () => ({ state: 'Settled', amount: 1000 }),
        settlePayment: () => ({ success: true }),
        createRefund: mode === 'automatic' ? provider : undefined,
        refundSettlementMode: mode,
    });
    let nextId = 1;
    const save = vi.fn((refund: Refund) => {
        return Promise.resolve().then(() => {
            if (!refund.id) {
                refund.id = `refund-${nextId++}`;
                payment.refunds.push(refund);
            }
            return refund;
        });
    });
    const queryBuilder: any = {};
    for (const method of ['relation', 'of', 'update', 'set', 'where'])
        queryBuilder[method] = vi.fn(() => queryBuilder);
    queryBuilder.add = vi.fn().mockResolvedValue(undefined);
    let relationTarget: Refund;
    queryBuilder.of = vi.fn((refund: Refund) => {
        relationTarget = refund;
        return queryBuilder;
    });
    queryBuilder.add = vi.fn((lines: RefundLine[] | Payment) => {
        return Promise.resolve().then(() => {
            if (Array.isArray(lines)) relationTarget.lines = lines;
        });
    });
    queryBuilder.execute = vi.fn().mockResolvedValue({ affected: 1 });
    const connection = {
        getEntityOrThrow: vi.fn((_ctx, entity, id) => {
            return Promise.resolve().then(() => {
                if (entity === Order) return order;
                if (entity === Payment) return payment;
                if (entity === Refund) return payment.refunds.find(refund => refund.id === id);
                throw new Error('Unexpected entity');
            });
        }),
        getRepository: vi.fn((_ctx, entity) => ({
            save:
                entity === RefundLine
                    ? (line: RefundLine) => Promise.resolve(line)
                    : entity === Payment
                      ? (incoming: Payment) => {
                            return Promise.resolve().then(() => {
                                incoming.id ||= 'new-payment';
                                return incoming;
                            });
                        }
                      : save,
            createQueryBuilder: () => queryBuilder,
            find: ({ where }: any) =>
                Promise.resolve(
                    payment.refunds.filter(refund => refund.transactionId === where.transactionId),
                ),
        })),
        withTransaction: vi.fn((_ctx, work) => Promise.resolve(work(ctx))),
    };
    const refundStateMachine = {
        transitionForRetry: vi.fn((_ctx, _order, refund) => {
            return Promise.resolve().then(() => {
                if (refund.state !== 'Failed') throw new Error('Only failed refunds may retry');
                refund.state = 'Pending';
                return { finalize: vi.fn().mockResolvedValue(undefined) };
            });
        }),
        transition: vi.fn((_ctx, _order, refund, state) => {
            return Promise.resolve().then(() => {
                if (refund.state !== 'Pending') throw new Error('Only Pending refunds may transition');
                if (refund.state === state) throw new Error('Refund cannot transition to its current state');
                refund.state = state;
                return { finalize: vi.fn().mockResolvedValue(undefined) };
            });
        }),
    };
    const methods = {
        getMethodAndOperations: vi
            .fn()
            .mockResolvedValue({ handler, paymentMethod: { id: 'method-1', handler: { args: [] } } }),
    };
    const events = { publish: vi.fn().mockResolvedValue(undefined) };
    const service = new PaymentService(
        connection as any,
        {
            transition: (_ctx: any, _order: any, incoming: Payment, state: any) => {
                return Promise.resolve().then(() => {
                    incoming.state = state;
                    return { finalize: () => Promise.resolve(undefined) };
                });
            },
        } as any,
        refundStateMachine as any,
        methods as any,
        events as any,
    );
    const orders = Object.assign(Object.create(OrderService.prototype), {
        connection,
        paymentService: service,
        paymentMethodService: methods,
        refundStateMachine,
        eventBus: events,
        withOrderMutationTransaction: (_ctx: any, work: any) => Promise.resolve(work(ctx)),
        lockOrderForRefund: vi.fn().mockResolvedValue(undefined),
    }) as OrderService;
    const input: RefundOrderInput = {
        paymentId: payment.id,
        amount: 300,
        reason: 'Customer request',
        idempotencyKey: 'request-1',
    };
    return { ctx, order, payment, handler, provider, save, service, orders, input, methods, events };
}
describe('refund money and receipt safety', () => {
    it('emits payment attempt lifecycle without gateway payloads', async () => {
        const test = setup();
        await test.service.createPayment(test.ctx, test.order, 1000, test.payment.method, {});
        const attempts = test.events.publish.mock.calls
            .map(([event]) => event)
            .filter(event => event instanceof PaymentAttemptEvent);
        expect(attempts.map(event => event.phase)).toEqual(['STARTED', 'RETURNED']);
        expect(attempts[1].resultState).toBe('Settled');
        expect(attempts.every(event => !('metadata' in event) && !('gatewayResponse' in event))).toBe(true);
    });
    it('emits FAILED on an unknown gateway exception without fabricating a payment result', async () => {
        const test = setup();
        vi.spyOn(test.handler, 'createPayment').mockRejectedValueOnce(new Error('gateway outcome unknown'));
        await expect(
            test.service.createPayment(test.ctx, test.order, 1000, test.payment.method, {}),
        ).rejects.toThrow('gateway outcome unknown');
        const attempts = test.events.publish.mock.calls
            .map(([event]) => event)
            .filter(event => event instanceof PaymentAttemptEvent);
        expect(attempts.map(event => event.phase)).toEqual(['STARTED', 'FAILED']);
        expect(attempts[1].resultState).toBeUndefined();
    });
    it('lets the checkout resource gate reject before the external gateway is called', async () => {
        const test = setup();
        const gateway = vi.spyOn(test.handler, 'createPayment');
        test.events.publish.mockImplementation(event => {
            return Promise.resolve().then(() => {
                if (event instanceof PaymentAttemptEvent && event.phase === 'STARTED')
                    throw new Error('hold expired');
            });
        });
        await expect(
            test.service.createPayment(test.ctx, test.order, 1000, test.payment.method, {}),
        ).rejects.toThrow('hold expired');
        expect(gateway).not.toHaveBeenCalled();
    });
    it('retries a confirmed failed automatic refund in place and replays one attempt without another transfer', async () => {
        const test = setup();
        test.provider
            .mockResolvedValueOnce({ state: 'Failed', transactionId: 'failed-provider-job' })
            .mockResolvedValueOnce({ state: 'Settled', transactionId: 'successful-retry-receipt' });
        const first = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        const retried = await test.orders.retryRefund(test.ctx, {
            refundId: first.id,
            idempotencyKey: 'attempt-1',
        });
        expect(retried).toBe(first);
        expect(first).toMatchObject({
            state: 'Settled',
            transactionId: 'successful-retry-receipt',
            metadata: {
                refundRequest: { key: test.input.idempotencyKey },
                refundAttempts: [
                    { key: 'attempt-1', state: 'Settled', previousTransactionId: 'failed-provider-job' },
                ],
            },
        });
        expect(test.order.payments[0].refunds).toHaveLength(1);
        const providerKey = test.provider.mock.calls[1][1].idempotencyKey;
        expect(providerKey).toMatch(/^refund-retry:[a-f0-9]{64}$/u);
        expect(
            await test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' }),
        ).toBe(first);
        expect(test.provider).toHaveBeenCalledTimes(2);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Vitest inspects the existing mock without invoking the method.
        expect(test.orders.lockOrderForRefund).toHaveBeenCalledTimes(2);
    });
    it('keeps a failed retry explicit and issues only a newly reviewed attempt with a new stable provider key', async () => {
        const test = setup();
        test.provider.mockResolvedValue({ state: 'Failed', transactionId: 'failed-receipt' });
        const first = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        await test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' });
        await test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' });
        expect(first.state).toBe('Failed');
        expect(test.provider).toHaveBeenCalledTimes(2);
        await test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-2' });
        expect(test.provider).toHaveBeenCalledTimes(3);
        expect(test.provider.mock.calls[2][1].idempotencyKey).not.toBe(
            test.provider.mock.calls[1][1].idempotencyKey,
        );
        expect(first.metadata.refundAttempts).toHaveLength(2);
    });
    it('reserves an uncertain retry as Pending and refuses a second attempt while its outcome is unknown', async () => {
        const test = setup();
        test.provider
            .mockResolvedValueOnce({ state: 'Failed' })
            .mockRejectedValueOnce(new Error('transport unavailable'));
        const first = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        await test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' });
        expect(first).toMatchObject({
            state: 'Pending',
            metadata: {
                refundRequest: {
                    outcomeUnknown: true,
                    requiresReconciliation: true,
                },
            },
        });
        await test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' });
        await expect(
            test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-2' }),
        ).rejects.toThrow('处理中或成功');
        expect(test.provider).toHaveBeenCalledTimes(2);
    });
    it('closes the retry audit and unknown outcome only after a verified channel receipt', async () => {
        const test = setup();
        test.provider
            .mockResolvedValueOnce({ state: 'Failed' })
            .mockRejectedValueOnce(new Error('transport unavailable'));
        const first = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        await test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' });
        const receipt = 'verified-retry-receipt';
        await test.orders.settleRefund(
            test.ctx,
            { id: first.id, transactionId: receipt },
            {
                source: 'provider-callback',
                paymentId: test.payment.id,
                amount: first.total,
                transactionId: receipt,
                evidenceReference: 'verified-provider-callback',
            },
        );
        expect(first).toMatchObject({
            state: 'Settled',
            metadata: {
                refundRequest: { outcomeUnknown: false, requiresReconciliation: false },
                refundAttempts: [
                    { key: 'attempt-1', state: 'Settled', outcomeUnknown: false, transactionId: receipt },
                ],
            },
        });
        expect(test.provider).toHaveBeenCalledTimes(2);
        expect(test.payment.refunds).toHaveLength(1);
    });
    it.each(['manual', 'verified-external'] as RefundSettlementMode[])(
        'returns a failed %s refund to its dedicated receipt workflow without calling an automatic provider',
        async mode => {
            const test = setup(mode);
            const first = (await test.service.createRefund(
                test.ctx,
                test.input,
                test.order,
                test.payment,
            )) as Refund;
            first.state = 'Failed';
            const result = await test.orders.retryRefund(test.ctx, {
                refundId: first.id,
                idempotencyKey: 'attempt-1',
            });
            expect(result).toBe(first);
            expect(first.state).toBe('Pending');
            expect(test.provider).not.toHaveBeenCalled();
            expect(test.payment.refunds).toHaveLength(1);
        },
    );
    it('rechecks payment balance released by a failed request before taking its budget back', async () => {
        const test = setup();
        test.provider.mockResolvedValueOnce({ state: 'Failed' });
        const first = (await test.service.createRefund(
            test.ctx,
            { ...test.input, amount: 600 },
            test.order,
            test.payment,
        )) as Refund;
        await test.service.createRefund(
            test.ctx,
            { ...test.input, amount: 500, idempotencyKey: 'separate-request' },
            test.order,
            test.payment,
        );
        const result = await test.orders.retryRefund(test.ctx, {
            refundId: first.id,
            idempotencyKey: 'attempt-1',
        });
        expect(result).toHaveProperty('maximumRefundable', 500);
        expect(first.state).toBe('Failed');
        expect(test.provider).toHaveBeenCalledTimes(2);
    });
    it('rechecks item units released by a failed request before retrying its original scope', async () => {
        const test = setup();
        test.provider.mockResolvedValueOnce({ state: 'Failed' });
        const first = (await test.service.createRefund(
            test.ctx,
            {
                ...test.input,
                amount: 100,
                reasonType: RefundReasonType.Items,
                lines: [{ orderLineId: 'line-1', quantity: 2 }],
            },
            test.order,
            test.payment,
        )) as Refund;
        await test.service.createRefund(
            test.ctx,
            {
                ...test.input,
                amount: 100,
                idempotencyKey: 'separate-request',
                reasonType: RefundReasonType.Items,
                lines: [{ orderLineId: 'line-1', quantity: 2 }],
            },
            test.order,
            test.payment,
        );
        await expect(
            test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' }),
        ).rejects.toThrow('退款份数超过');
        expect(first.state).toBe('Failed');
        expect(test.provider).toHaveBeenCalledTimes(2);
    });
    it('rechecks shipping released by a failed request and refuses to exceed the collected budget', async () => {
        const test = setup();
        test.provider.mockResolvedValueOnce({ state: 'Failed' });
        const first = (await test.service.createRefund(
            test.ctx,
            { ...test.input, amount: 200, shipping: 200, reasonType: RefundReasonType.Shipping },
            test.order,
            test.payment,
        )) as Refund;
        await test.service.createRefund(
            test.ctx,
            {
                ...test.input,
                amount: 100,
                shipping: 100,
                idempotencyKey: 'separate-request',
                reasonType: RefundReasonType.Shipping,
            },
            test.order,
            test.payment,
        );
        await expect(
            test.orders.retryRefund(test.ctx, { refundId: first.id, idempotencyKey: 'attempt-1' }),
        ).rejects.toThrow('未退余额');
        expect(first.state).toBe('Failed');
        expect(test.provider).toHaveBeenCalledTimes(2);
    });
    it('retains the original after-sales scope and passes the failed record as server-only validator context', async () => {
        const test = setup();
        const expectedRefund: { current?: Refund } = {};
        const validator = vi.fn((_ctx, _order, input, current) => {
            return Promise.resolve().then(() => {
                expect(input.afterSalesId).toBe('review-1');
                if (expectedRefund.current) {
                    expect(current).toBe(expectedRefund.current);
                    expect(current.state).toBe('Failed');
                    throw new Error('approval no longer available');
                }
            });
        });
        test.service.registerRefundRequestValidator('after-sales', validator);
        test.provider.mockResolvedValueOnce({ state: 'Failed' });
        const failedRefund = (await test.service.createRefund(
            test.ctx,
            { ...test.input, afterSalesId: 'review-1' },
            test.order,
            test.payment,
        )) as Refund;
        expectedRefund.current = failedRefund;
        await expect(
            test.orders.retryRefund(test.ctx, { refundId: failedRefund.id, idempotencyKey: 'attempt-1' }),
        ).rejects.toThrow('approval no longer available');
        expect(test.provider).toHaveBeenCalledTimes(1);
        expect(failedRefund.state).toBe('Failed');
    });
    it('preserves a provider Pending response without attempting an invalid Pending-to-Pending transition', async () => {
        const test = setup();
        test.provider.mockResolvedValue({ state: 'Pending', transactionId: 'pending-provider-job' });
        const refund = await test.service.createRefund(test.ctx, test.input, test.order, test.payment);
        expect(refund).toMatchObject({ state: 'Pending', transactionId: 'pending-provider-job' });
        expect(test.events.publish).not.toHaveBeenCalled();
    });
    it('allows refunding additional units after an existing order line is increased', async () => {
        const test = setup();
        const line = test.order.lines[0];
        line.orderPlacedQuantity = orderPlacedQuantityAfterModification(
            line.orderPlacedQuantity,
            line.quantity,
            5,
        );
        line.quantity = 5;
        const first = await test.service.createRefund(
            test.ctx,
            {
                ...test.input,
                amount: 400,
                reasonType: RefundReasonType.Items,
                lines: [{ orderLineId: line.id, quantity: 4 }],
            },
            test.order,
            test.payment,
        );
        expect(first).toMatchObject({ lines: [{ orderLineId: line.id, quantity: 4 }] });
        await expect(
            test.service.createRefund(
                test.ctx,
                {
                    ...test.input,
                    idempotencyKey: 'second-request',
                    amount: 200,
                    reasonType: RefundReasonType.Items,
                    lines: [{ orderLineId: line.id, quantity: 2 }],
                },
                test.order,
                test.payment,
            ),
        ).rejects.toThrow('退款份数超过');
    });
    it('preflights a shared after-sales amount before any split refund is transferred', async () => {
        const test = setup();
        const validator = vi.fn((_ctx, _order, input: RefundOrderInput) => {
            return Promise.resolve().then(() => {
                if ((input.amount ?? input.shipping ?? 0) > 150) throw new Error('exceeds approved amount');
            });
        });
        test.service.registerRefundRequestValidator('approval', validator);
        await expect(
            test.service.validateRefundBatch(
                test.ctx,
                [
                    {
                        ...test.input,
                        amount: 100,
                        afterSalesId: 'approval-1',
                        reasonType: RefundReasonType.Items,
                        lines: [{ orderLineId: 'line-1', quantity: 1 }],
                    },
                    {
                        ...test.input,
                        amount: null,
                        shipping: 100,
                        afterSalesId: 'approval-1',
                        reasonType: RefundReasonType.Shipping,
                        lines: [],
                    },
                ],
                test.order,
                [test.payment],
            ),
        ).rejects.toThrow('exceeds approved amount');
        expect(validator).toHaveBeenLastCalledWith(
            test.ctx,
            test.order,
            expect.objectContaining({
                afterSalesId: 'approval-1',
                amount: 200,
                shipping: 100,
                lines: [{ orderLineId: 'line-1', quantity: 1 }],
            }),
        );
        expect(test.provider).not.toHaveBeenCalled();
    });
    it('combines approved item quantities across separate source payments in batch preflight', async () => {
        const test = setup();
        const secondPayment = new Payment({ ...test.payment, id: 'payment-2', amount: 1000, refunds: [] });
        test.order.payments.push(secondPayment);
        test.service.registerRefundRequestValidator('approval', (_ctx, _order, input) => {
            return Promise.resolve().then(() => {
                if ((input.lines?.[0].quantity ?? 0) > 1) throw new Error('exceeds approved units');
            });
        });
        await expect(
            test.service.validateRefundBatch(
                test.ctx,
                [
                    {
                        ...test.input,
                        amount: 100,
                        afterSalesId: 'approval-1',
                        reasonType: RefundReasonType.Items,
                        lines: [{ orderLineId: 'line-1', quantity: 1 }],
                    },
                    {
                        ...test.input,
                        paymentId: secondPayment.id,
                        amount: 100,
                        afterSalesId: 'approval-1',
                        reasonType: RefundReasonType.Items,
                        lines: [{ orderLineId: 'line-1', quantity: 1 }],
                    },
                ],
                test.order,
                [test.payment, secondPayment],
            ),
        ).rejects.toThrow('exceeds approved units');
        expect(test.provider).not.toHaveBeenCalled();
    });
    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid refund amount %s before invoking the provider',
        async amount => {
            const test = setup();
            await expect(
                test.service.createRefund(test.ctx, { ...test.input, amount }, test.order, test.payment),
            ).rejects.toThrow();
            expect(test.provider).not.toHaveBeenCalled();
            expect(test.save).not.toHaveBeenCalled();
        },
    );
    it.each(['Created', 'Authorized', 'Declined', 'Error', 'Cancelled'])(
        'never refunds an unsettled %s source',
        async state => {
            const test = setup();
            test.payment.state = state as any;
            await expect(
                test.service.createRefund(test.ctx, test.input, test.order, test.payment),
            ).rejects.toThrow('只能对已到账');
            expect(test.provider).not.toHaveBeenCalled();
        },
    );
    it('rejects a simulated payment even when it uses Settled', async () => {
        const test = setup();
        test.payment.metadata = { public: { testPayment: true } };
        await expect(
            test.service.createRefund(test.ctx, test.input, test.order, test.payment),
        ).rejects.toThrow('没有真实款项');
        expect(test.provider).not.toHaveBeenCalled();
    });
    it.each([
        [{ orderLineId: 'another-order-line', quantity: 1 }],
        [{ orderLineId: 'line-1', quantity: 0 }],
        [{ orderLineId: 'line-1', quantity: -1 }],
        [{ orderLineId: 'line-1', quantity: 1.5 }],
        [{ orderLineId: 'line-1', quantity: 4 }],
        [
            { orderLineId: 'line-1', quantity: 2 },
            { orderLineId: 'line-1', quantity: 2 },
        ],
    ])('rejects invalid or repeated refundable item units %#', async (...lineInputs) => {
        const test = setup();
        // it.each spreads the rows; retain each complete selection here.
        const lines = lineInputs.flat();
        await expect(
            test.service.createRefund(
                test.ctx,
                { ...test.input, reasonType: RefundReasonType.Items, lines },
                test.order,
                test.payment,
            ),
        ).rejects.toThrow();
        expect(test.provider).not.toHaveBeenCalled();
    });
    it('persists item RefundLines in amount mode and reserves Pending units after cancellation', async () => {
        const test = setup('manual');
        test.order.lines[0].quantity = 0;
        const first = (await test.service.createRefund(
            test.ctx,
            {
                ...test.input,
                reasonType: RefundReasonType.Items,
                lines: [{ orderLineId: 'line-1', quantity: 2 }],
            },
            test.order,
            test.payment,
        )) as Refund;
        expect(first.lines).toMatchObject([{ orderLineId: 'line-1', quantity: 2 }]);
        expect(first.metadata.refundRequest.reasonType).toBe('ITEMS');
        await expect(
            test.service.createRefund(
                test.ctx,
                {
                    ...test.input,
                    idempotencyKey: 'request-2',
                    reasonType: RefundReasonType.Items,
                    lines: [{ orderLineId: 'line-1', quantity: 2 }],
                },
                test.order,
                test.payment,
            ),
        ).rejects.toThrow('成交份数');
        first.state = 'Failed';
        await expect(
            test.service.createRefund(
                test.ctx,
                {
                    ...test.input,
                    idempotencyKey: 'reviewed-request-2',
                    reasonType: RefundReasonType.Items,
                    lines: [{ orderLineId: 'line-1', quantity: 2 }],
                },
                test.order,
                test.payment,
            ),
        ).resolves.toMatchObject({ total: 300 });
    });
    it('requires selected units for ITEMS while compensation may leave lines empty', async () => {
        const test = setup();
        await expect(
            test.service.createRefund(
                test.ctx,
                { ...test.input, reasonType: RefundReasonType.Items, lines: [] },
                test.order,
                test.payment,
            ),
        ).rejects.toThrow('必须选择商品');
        await expect(
            test.service.createRefund(
                test.ctx,
                { ...test.input, reasonType: RefundReasonType.Compensation, lines: [] },
                test.order,
                test.payment,
            ),
        ).resolves.toMatchObject({ total: 300 });
    });
    it('records a server-owned shipping budget on both normal and manual payment creation', async () => {
        const normal = setup();
        const payment = (await normal.service.createPayment(
            normal.ctx,
            normal.order,
            1000,
            normal.payment.method,
            {},
        )) as Payment;
        expect(payment.metadata.refundBudget).toMatchObject({
            shippingWithTax: 200,
            orderTotalWithTax: 1000,
            currencyCode: 'CNY',
        });
        const manual = setup();
        const recorded = await manual.service.createManualPayment(manual.ctx, manual.order, 1000, {
            orderId: manual.order.id,
            method: manual.payment.method,
            transactionId: 'manual-payment',
            metadata: { refundBudget: { shippingWithTax: 999999 } },
        });
        expect(recorded.metadata.refundBudget.shippingWithTax).toBe(200);
    });
    it('refunds canceled-order shipping using the retained paid snapshot and reserves Pending shipping', async () => {
        const test = setup('manual');
        Object.assign(test.order, { shippingWithTax: 0 });
        test.payment.metadata.refundBudget = { shippingWithTax: 200 };
        const request = {
            ...test.input,
            amount: 150,
            shipping: 150,
            reasonType: RefundReasonType.Shipping,
            lines: [],
        };
        const first = (await test.service.createRefund(
            test.ctx,
            request,
            test.order,
            test.payment,
        )) as Refund;
        expect(first.shipping).toBe(150);
        await expect(
            test.service.createRefund(
                test.ctx,
                { ...request, idempotencyKey: 'request-2', amount: 51, shipping: 51 },
                test.order,
                test.payment,
            ),
        ).rejects.toThrow('未退余额');
        first.state = 'Failed';
        await expect(
            test.service.createRefund(
                test.ctx,
                { ...request, idempotencyKey: 'reviewed-request-2', amount: 200, shipping: 200 },
                test.order,
                test.payment,
            ),
        ).resolves.toMatchObject({ shipping: 200 });
    });
    it('does not invent historic shipping after a legacy order was canceled without a snapshot', async () => {
        const test = setup();
        Object.assign(test.order, { shippingWithTax: 0 });
        await expect(
            test.service.createRefund(
                test.ctx,
                { ...test.input, amount: 1, shipping: 1, reasonType: RefundReasonType.Shipping },
                test.order,
                test.payment,
            ),
        ).rejects.toThrow('未退余额');
        expect(test.provider).not.toHaveBeenCalled();
    });
    it.each([
        { amount: 100, shipping: 101, reasonType: RefundReasonType.Shipping },
        { amount: 100, shipping: 1, reasonType: RefundReasonType.Compensation },
        {
            amount: 100,
            shipping: 1,
            reasonType: RefundReasonType.Items,
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
        },
    ])('rejects mixed or inconsistent shipping purposes %#', async changes => {
        const test = setup();
        await expect(
            test.service.createRefund(test.ctx, { ...test.input, ...changes }, test.order, test.payment),
        ).rejects.toThrow();
        expect(test.provider).not.toHaveBeenCalled();
    });
    it('preflights the whole modification batch before calling providers when a source budget is overallocated', async () => {
        const test = setup();
        const inputs = [
            { ...test.input, amount: 600 },
            { ...test.input, amount: 600, idempotencyKey: 'request-2' },
        ];
        await expect(
            test.service.validateRefundBatch(test.ctx, inputs, test.order, [test.payment]),
        ).rejects.toThrow('合计超过');
        expect(test.provider).not.toHaveBeenCalled();
        expect(test.save).not.toHaveBeenCalled();
    });
    it('preflights aggregate shipping and unit budgets across otherwise valid individual requests', async () => {
        const test = setup();
        const shipping = {
            ...test.input,
            amount: 101,
            shipping: 101,
            reasonType: RefundReasonType.Shipping,
            lines: [],
        };
        await expect(
            test.service.validateRefundBatch(
                test.ctx,
                [shipping, { ...shipping, idempotencyKey: 'request-2' }],
                test.order,
                [test.payment],
            ),
        ).rejects.toThrow('运费退款合计');
        const items = {
            ...test.input,
            amount: 100,
            reasonType: RefundReasonType.Items,
            lines: [{ orderLineId: 'line-1', quantity: 2 }],
        };
        await expect(
            test.service.validateRefundBatch(
                test.ctx,
                [items, { ...items, idempotencyKey: 'request-2' }],
                test.order,
                [test.payment],
            ),
        ).rejects.toThrow('商品退款合计');
        expect(test.provider).not.toHaveBeenCalled();
    });
    it('runs plugin ownership and digital-shipping checks through the shared payment preflight', async () => {
        const test = setup();
        const validator = vi
            .fn()
            .mockRejectedValue(new Error('After-sales request belongs to another store'));
        test.service.registerRefundRequestValidator('ownership', validator);
        await expect(
            test.service.validateRefundBatch(
                test.ctx,
                [{ ...test.input, afterSalesId: 'foreign-request' }],
                test.order,
                [test.payment],
            ),
        ).rejects.toThrow('another store');
        expect(test.provider).not.toHaveBeenCalled();
        expect(validator).toHaveBeenCalledTimes(1);
    });
    it('returns the same successful partial refund on replay without refunding again', async () => {
        const test = setup();
        const first = await test.service.createRefund(test.ctx, test.input, test.order, test.payment);
        const second = await test.service.createRefund(test.ctx, test.input, test.order, test.payment);
        expect(second).toBe(first);
        expect(test.provider).toHaveBeenCalledTimes(1);
        expect(test.payment.refunds).toHaveLength(1);
        expect(test.provider.mock.calls[0][1].idempotencyKey).toBe('request-1');
    });
    it('safely deduplicates legacy callers with identical requests instead of issuing a new transfer', async () => {
        const test = setup();
        const input = { ...test.input, idempotencyKey: undefined };
        const first = await test.service.createRefund(test.ctx, input, test.order, test.payment);
        expect(await test.service.createRefund(test.ctx, input, test.order, test.payment)).toBe(first);
        expect(test.provider).toHaveBeenCalledTimes(1);
        expect(test.provider.mock.calls[0][1].idempotencyKey).toMatch(/^refund-legacy:/);
    });
    it('rejects a replay whose amount or reason changes', async () => {
        const test = setup();
        await test.service.createRefund(test.ctx, test.input, test.order, test.payment);
        await expect(
            test.service.createRefund(test.ctx, { ...test.input, amount: 400 }, test.order, test.payment),
        ).rejects.toThrow('已用于不同');
        expect(test.provider).toHaveBeenCalledTimes(1);
    });
    it('keeps an uncertain transfer Pending and reserved; replay never calls the provider again', async () => {
        const test = setup();
        test.provider.mockRejectedValue(new Error('Network response lost'));
        const first = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        expect(first.state).toBe('Pending');
        expect(first.metadata.refundRequest.outcomeUnknown).toBe(true);
        expect(first.metadata).not.toHaveProperty('errorMessage');
        expect(await test.service.createRefund(test.ctx, test.input, test.order, test.payment)).toBe(first);
        const excess = await test.service.createRefund(
            test.ctx,
            { ...test.input, amount: 800, idempotencyKey: 'request-2' },
            test.order,
            test.payment,
        );
        expect(excess).toMatchObject({ errorCode: 'REFUND_AMOUNT_ERROR', maximumRefundable: 700 });
        expect(test.provider).toHaveBeenCalledTimes(1);
    });
    it('returns the original Failed request and releases its budget for a separately reviewed new request', async () => {
        const test = setup();
        test.provider.mockResolvedValueOnce({ state: 'Failed', transactionId: 'failed-receipt' });
        const first = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        expect(first.state).toBe('Failed');
        expect(await test.service.createRefund(test.ctx, test.input, test.order, test.payment)).toBe(first);
        expect(test.provider).toHaveBeenCalledTimes(1);
        const next = await test.service.createRefund(
            test.ctx,
            { ...test.input, amount: 1000, idempotencyKey: 'reviewed-request-2' },
            test.order,
            test.payment,
        );
        expect(next).toMatchObject({ state: 'Settled', total: 1000 });
    });
    it('does not declare automatic refund success without a provider receipt', async () => {
        const test = setup();
        test.provider.mockResolvedValue({ state: 'Settled' });
        const result = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        expect(result.state).toBe('Pending');
        expect(result.metadata.refundRequest.requiresReconciliation).toBe(true);
    });
    it('rejects cancellation of settled money before looking up or invoking a handler', async () => {
        const test = setup();
        await expect(test.service.cancelPayment(test.ctx, test.payment.id)).rejects.toThrow('必须通过退款');
        expect(test.methods.getMethodAndOperations).not.toHaveBeenCalled();
    });
    it('does not claim authorization revoked when the provider lacks cancellation support', async () => {
        const test = setup();
        test.payment.state = 'Authorized';
        await expect(test.service.cancelPayment(test.ctx, test.payment.id)).rejects.toThrow('不支持撤销');
        expect(test.payment.state).toBe('Authorized');
    });
    it.each(['automatic', 'verified-external', 'manual'] as const)(
        'rejects generic manual settlement of %s refunds',
        async mode => {
            const test = setup(mode);
            const refund = new Refund({
                id: 'refund-1',
                state: 'Pending',
                total: 300,
                payment: test.payment,
                metadata: {},
            });
            test.payment.refunds.push(refund);
            await expect(
                test.orders.settleRefund(test.ctx, { id: refund.id, transactionId: 'unverified-receipt' }),
            ).rejects.toThrow();
            expect(refund.state).toBe('Pending');
            expect(test.events.publish).not.toHaveBeenCalled();
        },
    );
    it('rejects forged metadata instead of treating it as verified external proof', async () => {
        const test = setup('verified-external');
        const refund = new Refund({
            id: 'refund-1',
            state: 'Pending',
            total: 300,
            payment: test.payment,
            metadata: {},
        });
        refund.metadata = { settlementEvidence: { source: 'verified-external', reference: 'forged' } };
        test.payment.refunds.push(refund);
        await expect(
            test.orders.settleRefund(test.ctx, { id: refund.id, transactionId: 'unverified-receipt' }),
        ).rejects.toThrow('专用流程');
        expect(refund.state).toBe('Pending');
    });
    it('accepts exact server-verified external evidence and rejects a mismatched amount', async () => {
        const test = setup('verified-external');
        const refund = new Refund({
            id: 'refund-1',
            state: 'Pending',
            total: 300,
            payment: test.payment,
            metadata: {},
        });
        test.payment.refunds.push(refund);
        const evidence = {
            source: 'verified-external' as const,
            paymentId: test.payment.id,
            amount: 300,
            transactionId: 'verified-receipt',
            evidenceReference: 'chain:verified-receipt',
        };
        await expect(
            test.orders.settleRefund(
                test.ctx,
                { id: refund.id, transactionId: evidence.transactionId },
                { ...evidence, amount: 301 },
            ),
        ).rejects.toThrow();
        const settled = await test.orders.settleRefund(
            test.ctx,
            { id: refund.id, transactionId: evidence.transactionId },
            evidence,
        );
        expect(settled.state).toBe('Settled');
        expect(settled.metadata.settlementEvidence).toMatchObject({
            source: 'verified-external',
            reference: 'chain:verified-receipt',
        });
        expect(
            await test.orders.settleRefund(test.ctx, {
                id: refund.id,
                transactionId: evidence.transactionId,
            }),
        ).toBe(settled);
        await expect(
            test.orders.settleRefund(test.ctx, { id: refund.id, transactionId: 'different-receipt' }),
        ).rejects.toThrow('不能改写');
    });
    it('accepts a verified automatic provider callback while the generic admin action remains blocked', async () => {
        const test = setup();
        test.provider.mockResolvedValue({ state: 'Pending', transactionId: 'provider-job' });
        const refund = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        const evidence = {
            source: 'provider-callback' as const,
            paymentId: test.payment.id,
            amount: 300,
            transactionId: 'provider-settled-receipt',
            evidenceReference: 'verified-event:refund-1',
        };
        const settled = await test.orders.settleRefund(
            test.ctx,
            { id: refund.id, transactionId: evidence.transactionId },
            evidence,
        );
        expect(settled.state).toBe('Settled');
        expect(settled.metadata.settlementEvidence.source).toBe('provider-callback');
    });
    it('requires a separate manual receipt workflow and preserves its audit', async () => {
        const test = setup('manual');
        const refund = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        const result = await test.orders.recordManualRefund(test.ctx, {
            refundId: refund.id,
            transactionId: 'bank-refund-1',
            evidenceReference: 'private-document:receipt-1',
            note: 'Checked bank refund statement',
        });
        expect(result.state).toBe('Settled');
        expect(result.metadata.manualReceiptNote).toBe('Checked bank refund statement');
        expect(result.metadata.settlementEvidence).toMatchObject({
            source: 'manual-registration',
            recordedBy: 'admin-1',
        });
        expect(test.provider).not.toHaveBeenCalled();
    });
    it('cannot use the manual receipt workflow for automatic or chain-verified channels', async () => {
        const test = setup('verified-external');
        const refund = (await test.service.createRefund(
            test.ctx,
            test.input,
            test.order,
            test.payment,
        )) as Refund;
        await expect(
            test.orders.recordManualRefund(test.ctx, {
                refundId: refund.id,
                transactionId: 'bank-refund-1',
                evidenceReference: 'receipt-1',
                note: 'Reviewed',
            }),
        ).rejects.toThrow('专用凭证');
    });
});
// organize-imports-ignore -- Preserve ESLint ordering of parent and hyphenated entity paths.
