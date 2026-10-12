import {
    ID,
    Injector,
    LanguageCode,
    Order,
    OrderPlacedStrategy,
    OrderProcess,
    OrderService,
    PaymentMethod,
    PaymentMethodEligibilityChecker,
    PaymentMethodHandler,
    PaymentProcess,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    isGraphQlErrorResult,
} from '@vendure/core';
import { sensitiveStoreFinancePermission, verifyOfflinePaymentProof } from '@vendure/store-management-plugin';

import { CheckoutResourcesService } from './checkout-resources.service';

declare module '@vendure/core/dist/service/helpers/payment-state-machine/payment-state' {
    interface PaymentStates {
        PendingManual: never;
    }
}
declare module '@vendure/core/dist/service/helpers/order-state-machine/order-state' {
    interface OrderStates {
        AwaitingManualPayment: never;
    }
}

export const OFFLINE_MANUAL_HANDLER = 'offline-manual-payment-handler';
export const OFFLINE_MANUAL_CHECKER = 'offline-manual-payment-checker';

export function offlineReceiptMatches(
    ctx: RequestContext,
    order: Order,
    payment: {
        id: ID;
        amount: number;
        transactionId?: string;
        metadata?: any;
    },
): boolean {
    const receipt = verifyOfflinePaymentProof(payment.metadata?.offlineManual?.receiptProof);
    return Boolean(
        receipt &&
        receipt.paymentId === String(payment.id) &&
        receipt.orderId === String(order.id) &&
        receipt.channelId === String(order.salesChannelId) &&
        receipt.channelId === String(ctx.channelId) &&
        receipt.currencyCode === String(order.currencyCode) &&
        receipt.amount === payment.amount &&
        receipt.transactionId === payment.transactionId,
    );
}

export function createOfflineManualPayment() {
    let connection: TransactionalConnection;
    let orders: OrderService;
    let resources: CheckoutResourcesService;
    const init = (injector: Injector) => {
        connection = injector.get(TransactionalConnection);
        orders = injector.get(OrderService);
        resources = injector.get(CheckoutResourcesService);
    };
    const checker = new PaymentMethodEligibilityChecker({
        code: OFFLINE_MANUAL_CHECKER,
        description: [{ languageCode: LanguageCode.zh_Hans, value: '正式提交订单，客服核实实际收款后交付' }],
        args: {},
        check: (ctx, order) =>
            String(order.salesChannelId) === String(ctx.channelId) &&
            order.active &&
            order.state === 'ArrangingPayment',
    });
    const handler = new PaymentMethodHandler({
        code: OFFLINE_MANUAL_HANDLER,
        description: [
            { languageCode: LanguageCode.zh_Hans, value: '客服核款支付（正式订单，收款确认前不交付）' },
        ],
        args: {},
        init,
        refundSettlementMode: 'manual',
        async createPayment(ctx, order, amount) {
            const current = await connection.findOneInChannel(ctx, Order, order.id, ctx.channelId);
            if (
                !current?.active ||
                current.state !== 'ArrangingPayment' ||
                String(current.salesChannelId) !== String(ctx.channelId) ||
                !Number.isSafeInteger(amount) ||
                amount < 0
            )
                throw new UserInputError('订单已变化，请重新核对后提交');
            return {
                amount,
                state: 'PendingManual',
                metadata: {
                    offlineManual: { kind: 'OFFLINE_MANUAL', submittedAt: new Date().toISOString() },
                    public: { paymentKind: 'OFFLINE_MANUAL', message: '订单已提交，待客服确认收款' },
                },
            };
        },
        settlePayment(ctx, order, payment) {
            if (!authorizedFinance(ctx) || !offlineReceiptMatches(ctx, order, payment))
                throw new UserInputError('请通过客服核款操作登记实际到账凭证');
            return { success: true };
        },
        cancelPayment(_ctx, _order, payment) {
            if (
                payment.metadata?.offlineManual?.receiptProof ||
                payment.metadata?.manualReview?.receivedState === 'Settled'
            )
                throw new UserInputError('已登记实际到账的款项必须通过退款处理');
            return { success: true };
        },
    });
    const paymentProcess: PaymentProcess<'PendingManual'> = {
        init,
        transitions: {
            Created: { to: ['PendingManual'], mergeStrategy: 'merge' },
            PendingManual: { to: ['Settled', 'Cancelled', 'Error'] },
            Error: { to: ['Settled'], mergeStrategy: 'merge' },
        },
        async onTransitionStart(from, to, { ctx, order, payment }) {
            const method = await connection
                .getRepository(ctx, PaymentMethod)
                .findOne({ where: { code: payment.method } });
            const offline = method?.handler.code === OFFLINE_MANUAL_HANDLER;
            if (offline && payment.metadata?.offlineManual?.kind !== 'OFFLINE_MANUAL')
                return '人工支付必须通过正式提交和客服核款流程';
            if (payment.metadata?.offlineManual?.kind !== 'OFFLINE_MANUAL') {
                if (to === 'PendingManual' || (from === 'Error' && to === 'Settled'))
                    return '该支付不能进入人工核款流程';
                return;
            }
            if (to === 'Settled' && (!authorizedFinance(ctx) || !offlineReceiptMatches(ctx, order, payment)))
                return '实际收款必须由受保护的客服核款操作确认';
            if (to === 'Cancelled' && payment.metadata?.offlineManual?.receiptProof)
                return '实际收款不能取消，请处理退款';
        },
        async onTransitionEnd(_from, to, { ctx, order }) {
            if (to !== 'PendingManual') return;
            await resources.awaitManualPayment(ctx, order.id);
            const result = await orders.transitionToState(ctx, order.id, 'AwaitingManualPayment');
            if (isGraphQlErrorResult(result)) throw new UserInputError(result.message);
        },
    };
    const orderProcess: OrderProcess<'AwaitingManualPayment'> = {
        init,
        transitions: {
            ArrangingPayment: { to: ['AwaitingManualPayment'], mergeStrategy: 'merge' },
            AwaitingManualPayment: { to: ['PaymentSettled', 'Cancelled'] },
        },
        async onTransitionStart(_from, to, { ctx, order }) {
            if (to !== 'AwaitingManualPayment') return;
            const payments = await orders.getOrderPayments(ctx, order.id);
            if (
                !payments.some(
                    payment =>
                        payment.state === 'PendingManual' &&
                        payment.metadata?.offlineManual?.kind === 'OFFLINE_MANUAL',
                )
            )
                return '提交人工订单前必须建立待核款记录';
        },
    };
    return { handler, checker, paymentProcess, orderProcess };
}

export function withOfflineOrderPlacement(delegate: OrderPlacedStrategy): OrderPlacedStrategy {
    return {
        init: injector => delegate.init?.(injector),
        shouldSetAsPlaced: (ctx, from, to, order) =>
            (from === 'ArrangingPayment' && to === 'AwaitingManualPayment') ||
            delegate.shouldSetAsPlaced(ctx, from, to, order),
    };
}

function authorizedFinance(ctx: RequestContext): boolean {
    return (
        ctx.apiType === 'admin' &&
        Boolean(ctx.activeUserId) &&
        ctx.userHasPermissions([Permission.UpdateOrder]) &&
        ctx.userHasPermissions([sensitiveStoreFinancePermission.Permission])
    );
}
