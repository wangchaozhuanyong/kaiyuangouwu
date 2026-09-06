import {
    ConfigService,
    FulfillmentProcess,
    ID,
    Injector,
    LanguageCode,
    Order,
    OrderProcess,
    PaymentMethod,
    PaymentMethodEligibilityChecker,
    PaymentMethodHandler,
    PaymentProcess,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { totalCoveredByPayments } from '@vendure/core/dist/service/helpers/utils/order-utils';
import { StorefrontCartService } from '@vendure/storefront-cart-plugin';
import { randomUUID } from 'node:crypto';

declare module '@vendure/core/dist/service/helpers/payment-state-machine/payment-state' {
    interface PaymentStates {
        TestSettled: never;
    }
}

declare module '@vendure/core/dist/service/helpers/order-state-machine/order-state' {
    interface OrderStates {
        TestPaymentSettled: never;
    }
}

export const CONTROLLED_TEST_PAYMENT_HANDLER = 'controlled-test-payment-handler';
export const CONTROLLED_TEST_PAYMENT_CHECKER = 'controlled-test-payment-checker';
export const CONTROLLED_TEST_PAYMENT_PREFIX = 'controlled-test-payment-';

export function testPaymentArguments(method: PaymentMethod) {
    return Object.fromEntries(
        method.handler.args.map(arg => {
            // Next Admin serializes text arguments as JSON strings; the standard API also accepts raw text.
            let value = String(arg.value);
            try {
                const parsed: unknown = JSON.parse(value);
                if (typeof parsed === 'string') value = parsed;
            } catch {
                /* Raw configurable-operation text. */
            }
            return [arg.name, value];
        }),
    );
}

/** Simulate the server-calculated payment while using the normal paid-order workflow. */
export function createControlledTestPayment(enabled: boolean) {
    let connection: TransactionalConnection;
    let config: ConfigService;
    let carts: StorefrontCartService;
    const init = (injector: Injector) => {
        connection = injector.get(TransactionalConnection);
        config = injector.get(ConfigService);
        carts = injector.get(StorefrontCartService);
    };

    const lockPayableOrder = async (ctx: RequestContext, orderId: ID): Promise<boolean> => {
        await carts.lockForOrder(ctx, orderId);
        // UPDATE evaluates the current committed row even under MySQL REPEATABLE READ.
        // A SELECT after waiting for the lock can still return the transaction's older snapshot.
        const result = await connection
            .getRepository(ctx, Order)
            .update({ id: orderId, active: true, state: 'ArrangingPayment' }, { id: orderId });
        return result.affected === 1;
    };

    async function payableOrder(
        ctx: RequestContext,
        orderId: ID,
        method: PaymentMethod,
        locked = false,
    ): Promise<Order | undefined> {
        if (!enabled || ctx.apiType !== 'shop') return;
        const lock = locked ? { mode: 'pessimistic_write' as const } : undefined;
        const currentMethod = await connection.findOneInChannel(
            ctx,
            PaymentMethod,
            method.id,
            ctx.channelId,
            {
                lock,
            },
        );
        if (!currentMethod?.enabled || currentMethod.handler.code !== CONTROLLED_TEST_PAYMENT_HANDLER) return;
        const args = testPaymentArguments(currentMethod);
        const channelId = String(
            (config.entityOptions.entityIdStrategy ?? config.entityIdStrategy).encodeId(ctx.channelId),
        );
        if (
            args.channelId !== channelId ||
            currentMethod.code !== `${CONTROLLED_TEST_PAYMENT_PREFIX}${channelId}` ||
            currentMethod.checker?.code !== CONTROLLED_TEST_PAYMENT_CHECKER
        )
            return;
        // Shop API applies the normal session/order ownership rules. No test-customer whitelist is required.
        // A joined locking read avoids stale payment totals under MySQL REPEATABLE READ.
        const order = await connection.findOneInChannel(ctx, Order, orderId, ctx.channelId, {
            relations: ['payments', 'payments.refunds'],
            relationLoadStrategy: 'join',
            lock,
        });
        if (!order?.active || order.state !== 'ArrangingPayment') return;
        const amount = order.totalWithTax - totalCoveredByPayments(order);
        if (!Number.isSafeInteger(amount) || amount < 0) return;
        return order;
    }

    const checker = new PaymentMethodEligibilityChecker({
        code: CONTROLLED_TEST_PAYMENT_CHECKER,
        description: [
            {
                languageCode: LanguageCode.zh_Hans,
                value: '开启后所有客户均可按正常结账流程使用测试支付',
            },
        ],
        args: {},
        init,
        check: async (ctx, order, _args, method) => Boolean(await payableOrder(ctx, order.id, method)),
    });

    const handler = new PaymentMethodHandler({
        code: CONTROLLED_TEST_PAYMENT_HANDLER,
        description: [
            {
                languageCode: LanguageCode.zh_Hans,
                value: '测试支付：按订单应付金额模拟付款成功，进入正常已付款订单流程，无需真实转账',
            },
        ],
        args: {
            channelId: {
                type: 'string',
                required: true,
                label: [{ languageCode: LanguageCode.zh_Hans, value: '本店 Channel ID' }],
            },
        },
        init,
        createPayment: async (ctx, order, amount, _args, _metadata, method) => {
            const current = await payableOrder(ctx, order.id, method);
            if (!current || amount !== current.totalWithTax - totalCoveredByPayments(current)) {
                throw new UserInputError('测试支付未开启或订单应付金额已变化，请重新加载订单');
            }
            return {
                amount,
                state: 'Settled',
                transactionId: `test-${randomUUID()}`,
                metadata: { public: { testPayment: true, message: '测试支付成功，未发生真实转账' } },
            };
        },
        settlePayment: () => ({ success: true }),
        cancelPayment: () => ({ success: true }),
        createRefund: () => {
            throw new UserInputError('测试支付没有真实款项，不能退款');
        },
    });

    const paymentProcess: PaymentProcess<'TestSettled'> = {
        init,
        // Keep historical test payments terminal; new payments use the standard Settled state.
        transitions: { TestSettled: { to: [] } },
        async onTransitionStart(from, to, { ctx, order, payment }) {
            if (from === 'TestSettled' || to === 'TestSettled') return '历史测试支付不能转为真实付款';
            if (!payment.method.startsWith(CONTROLLED_TEST_PAYMENT_PREFIX) || to !== 'Settled') return;
            if (from !== 'Created' || !(await lockPayableOrder(ctx, order.id)))
                return '测试订单已完成或已不允许付款';
            const method = await connection.getRepository(ctx, PaymentMethod).findOne({
                where: { code: payment.method },
            });
            const current = method && (await payableOrder(ctx, order.id, method, true));
            if (!current || payment.amount !== current.totalWithTax - totalCoveredByPayments(current)) {
                return '测试支付条件或应付金额已变化，请重新加载订单';
            }
        },
    };

    const orderProcess: OrderProcess<'TestPaymentSettled'> = {
        // Preserve old records without reactivating them or giving them a fulfillment path.
        transitions: { TestPaymentSettled: { to: [] } },
        onTransitionStart(from, to) {
            if (from === 'TestPaymentSettled' || to === 'TestPaymentSettled')
                return '历史测试订单已结束，不能重新付款或发货';
        },
    };
    const fulfillmentProcess: FulfillmentProcess<string> = {
        onTransitionStart(_from, _to, { orders: fulfillmentOrders }) {
            if (fulfillmentOrders.some(order => order.state === 'TestPaymentSettled')) {
                return '测试订单不能创建真实交付或扣减库存';
            }
        },
    };
    return { handler, checker, paymentProcess, orderProcess, fulfillmentProcess };
}
