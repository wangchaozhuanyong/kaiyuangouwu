import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminPermissionsProvider } from '../../src/components/admin-permissions-context';
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialog';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { CustomFieldsContext } from '../../src/custom-fields/custom-fields-context';
import { defineNextAdminExtension } from '../../src/extensions/extension-api';
import '../../src/index.css';
import { OrderEditor } from '../../src/pages/Sales/OrderEditor';
import { OrderOperationsBlock } from '../../src/pages/Sales/OrderOperationsBlock';
import { ModifyOrderEditor } from '../../src/pages/Sales/OrderWorkflowEditor';
import { SalesModule } from '../../src/pages/Sales/SalesModule';

// Formal pages, synthetic Apollo transport. No HttpLink, SMTP, payment processor, or production data.
const params = new URLSearchParams(location.search);
const now = '2026-10-04T08:00:00.000Z';
const activeChannel = {
    __typename: 'Channel',
    id: 'fixture-store',
    code: '合成验收店铺',
    customFields: { storefrontNameZh: '合成验收店铺', storefrontNameEn: 'Synthetic demo store' },
};
const fixture = {
    writes: [] as any[],
    reads: [] as string[],
    finishAttempts: 0,
    shipmentAttempts: 0,
    refundRetryAttempts: 0,
    appendChecks: [] as Array<{
        originalCount: number;
        addedCount: number;
        totalCount: number;
        originalsRetained: boolean;
    }>,
};
const refundRetryResults = new Map<string, any>();
const address = {
    fullName: '合成验收买家',
    company: null,
    streetLine1: '示例地址 1 号',
    streetLine2: null,
    city: '示例市',
    province: '示例区',
    postalCode: '00000',
    country: '示例国家',
    countryCode: 'MY',
    phoneNumber: null,
};
function makeOrder(id: string, type: 'digital' | 'physical', mode = 'manual_service') {
    const lineId = id + '-line';
    const test = id === 'TEST';
    const cancelled = id === 'CANCELLED';
    const modifying = id === 'MODIFY';
    const order: any = {
        __typename: 'Order',
        id,
        code: 'SYNTHETIC-' + id,
        createdAt: now,
        updatedAt: now,
        orderPlacedAt: now,
        state: cancelled ? 'Cancelled' : modifying ? 'Modifying' : 'PaymentSettled',
        active: false,
        type: 'Regular',
        nextStates: cancelled
            ? []
            : modifying
              ? ['PaymentSettled', 'ArrangingAdditionalPayment']
              : ['Modifying', 'Cancelled'],
        totalQuantity: cancelled ? 0 : 1,
        totalWithTax: cancelled ? 0 : 1000,
        subTotalWithTax: cancelled ? 0 : 1000,
        shippingWithTax: 0,
        currencyCode: 'CNY',
        couponCodes: [],
        discounts: [],
        salesChannel: activeChannel,
        channels: [{ ...activeChannel, token: 'synthetic-channel-no-access' }],
        customer: {
            __typename: 'Customer',
            id: 'fixture-buyer-' + id,
            firstName: '买家',
            lastName: '合成',
            emailAddress: 'synthetic@example.invalid',
            phoneNumber: null,
        },
        shippingAddress: type === 'physical' ? address : null,
        billingAddress: null,
        shippingLines: [],
        customFields: {},
        sellerOrders: [],
        storeCouponAllocations: [],
        history: {
            totalItems: 1,
            items: [
                {
                    id: id + '-history',
                    type: 'ORDER_STATE_TRANSITION',
                    createdAt: now,
                    isPublic: false,
                    administrator: null,
                    data: { from: 'ArrangingPayment', to: 'PaymentSettled' },
                },
            ],
        },
        payments: [
            {
                __typename: 'Payment',
                id: id + '-payment',
                createdAt: now,
                state: 'Settled',
                nextStates: ['Cancelled'],
                method: test ? 'controlled-test-payment-2' : 'bank-transfer',
                transactionId: 'SYNTHETIC-NO-FUNDS-' + id,
                amount: 1000,
                errorMessage: null,
                refunds: [],
            },
        ],
        lines: [
            {
                __typename: 'OrderLine',
                id: lineId,
                quantity: cancelled ? 0 : 1,
                featuredAsset: null,
                unitPriceWithTax: 1000,
                proratedUnitPriceWithTax: 1000,
                linePriceWithTax: cancelled ? 0 : 1000,
                discountedLinePriceWithTax: cancelled ? 0 : 1000,
                fulfillmentLines: [],
                customFields: {
                    fulfillmentTypeSnapshot: type,
                    digitalDeliveryModeSnapshot: type === 'digital' ? mode : null,
                },
                productVariant: {
                    __typename: 'ProductVariant',
                    id: id + '-variant',
                    name: type === 'digital' ? '人工数字成品（合成商品）' : '实物商品（合成商品）',
                    sku: 'SYNTHETIC-' + id,
                    product: {
                        __typename: 'Product',
                        id: id + '-product',
                        name: type === 'digital' ? '人工数字成品（合成商品）' : '实物商品（合成商品）',
                    },
                    options: [],
                    customFields: {
                        fulfillmentType: type,
                        digitalDeliveryMode: type === 'digital' ? mode : null,
                    },
                },
            },
        ],
        fulfillments: [],
        processingSummary: {
            __typename: 'OrderProcessingSummary',
            orderId: id,
            kind: type === 'digital' ? 'DIGITAL' : 'PHYSICAL',
            businessState: cancelled ? 'Cancelled' : modifying ? 'Modifying' : 'PaymentSettled',
            paymentStatus: test ? 'TEST' : 'PAID',
            paymentLabel: test ? '模拟付款，无真实收款' : '已收款',
            fulfillmentStatus: cancelled ? 'CANCELLED' : 'WAITING',
            fulfillmentLabel: cancelled ? '已停止交付' : '待处理交付',
            afterSalesStatus: 'NONE',
            afterSalesLabel: '无待处理售后',
            isTestOrder: test,
            needsProcessing: !test,
            hasException: false,
            canManage: true,
            blockedReason: test ? '模拟订单不执行真实退款' : null,
            settledAmount: test ? 0 : 1000,
            pendingRefundAmount: 0,
            refundedAmount: 0,
            refundableAmount: test ? 0 : 1000,
            refundableShippingAmount: 0,
            outstandingAmount: 0,
            remainingDigitalQuantity: type === 'digital' && !cancelled ? 1 : 0,
            remainingPhysicalQuantity: type === 'physical' && !cancelled ? 1 : 0,
            remainingPhysicalLines: type === 'physical' ? [{ orderLineId: lineId, quantity: 1 }] : [],
            canRefund: !test,
            refundBlockedReason: test ? '模拟付款没有真实资金可退' : null,
            paymentCapabilities: [
                {
                    paymentId: id + '-payment',
                    canRefund: !test,
                    refundableAmount: test ? 0 : 1000,
                    refundBlockedReason: test ? '模拟支付禁止退款' : null,
                    canCancel: false,
                    refundSettlementMode: test ? 'unsupported' : 'manual',
                },
            ],
            nextAction: test
                ? {
                      code: 'VIEW_ORDER',
                      label: '查看模拟记录',
                      enabled: false,
                      reason: '仅用于合成验收',
                      targetId: null,
                  }
                : cancelled
                  ? {
                        code: 'PROCESS_REFUND',
                        label: '处理退款',
                        enabled: true,
                        reason: '订单已取消，真实收款仍待处理（合成）',
                        targetId: null,
                    }
                  : modifying
                    ? {
                          code: 'FINISH_MODIFICATION',
                          label: '结束修改',
                          enabled: true,
                          reason: null,
                          targetId: null,
                      }
                    : {
                          code: type === 'digital' ? 'PREPARE_DELIVERY' : 'SHIP_PHYSICAL',
                          label: type === 'digital' ? '准备交付' : '填写运单',
                          enabled: true,
                          reason: null,
                          targetId: type === 'digital' ? id + '-task' : null,
                      },
            lines: [
                {
                    orderLineId: lineId,
                    productName: type === 'digital' ? '人工数字成品（合成商品）' : '实物商品（合成商品）',
                    sku: 'SYNTHETIC-' + id,
                    fulfillmentType: type,
                    digitalDeliveryMode: type === 'digital' ? mode : null,
                    quantity: cancelled ? 0 : 1,
                    requiredQuantity: cancelled ? 0 : 1,
                    refundableQuantity: 1,
                    deliveredQuantity: 0,
                    pendingQuantity: cancelled ? 0 : 1,
                    pendingDispatchQuantity: 0,
                    status: cancelled ? 'CANCELLED' : 'WAITING',
                    notificationStatus: 'NONE',
                    claimStatus: 'UNKNOWN',
                    claimedQuantity: null,
                    taskId: type === 'digital' ? id + '-task' : null,
                    recipientEmail: type === 'digital' ? 'synthetic@example.invalid' : null,
                },
            ],
        },
    };
    return order;
}
const orders = Object.fromEntries(
    [
        makeOrder('DIGITAL', 'digital'),
        makeOrder('CANCELLED', 'digital'),
        makeOrder('TEST', 'digital'),
        makeOrder('PHYSICAL', 'physical'),
        makeOrder('MODIFY', 'physical'),
        makeOrder('RETRY', 'digital'),
    ].map(order => [order.id, order]),
);
const retryOrder = orders.RETRY;
retryOrder.state = retryOrder.processingSummary.businessState = 'Delivered';
retryOrder.nextStates = [];
retryOrder.payments[0].refunds = [
    {
        __typename: 'Refund',
        id: 'fixture-failed-refund',
        createdAt: now,
        state: 'Failed',
        total: 500,
        reason: '原商品退款（合成）',
        transactionId: null,
    },
];
const retrySummary = retryOrder.processingSummary;
retrySummary.paymentStatus = 'REFUND_FAILED';
retrySummary.paymentLabel = '退款失败，需处理原申请';
retrySummary.fulfillmentStatus = 'COMPLETE';
retrySummary.fulfillmentLabel = '已完成交付';
retrySummary.remainingDigitalQuantity = 0;
retrySummary.hasException = true;
retrySummary.lines[0].status = 'COMPLETE';
retrySummary.lines[0].notificationStatus = 'SENT';
retrySummary.lines[0].claimStatus = 'CLAIMED';
retrySummary.lines[0].claimedQuantity = 1;
retrySummary.lines[0].deliveredQuantity = 1;
retrySummary.lines[0].pendingQuantity = 0;
retrySummary.paymentCapabilities[0].refundSettlementMode = params.get('retry-mode') || 'manual';
retrySummary.nextAction = {
    code: 'RETRY_REFUND',
    label: '处理原失败退款',
    enabled: true,
    reason: null,
    targetId: 'fixture-failed-refund',
};
if (params.has('batch')) {
    const order = orders.DIGITAL;
    order.totalQuantity = 3;
    order.totalWithTax = order.subTotalWithTax = 3000;
    order.payments[0].amount = 3000;
    order.lines[0].quantity = 3;
    order.lines[0].linePriceWithTax = order.lines[0].discountedLinePriceWithTax = 3000;
    const summary = order.processingSummary;
    summary.settledAmount = summary.refundableAmount = summary.paymentCapabilities[0].refundableAmount = 3000;
    summary.remainingDigitalQuantity = 3;
    const line = summary.lines[0];
    line.quantity = line.requiredQuantity = line.refundableQuantity = line.pendingQuantity = 3;
}
orders.PHYSICAL.fulfillments = [
    {
        __typename: 'Fulfillment',
        id: 'fixture-package',
        state: 'Created',
        nextStates: ['Pending'],
        handlerCode: 'manual-fulfillment',
        method: '',
        trackingCode: '',
        deliveryEvidence: null,
        lines: [{ orderLineId: 'PHYSICAL-line', quantity: 1 }],
    },
];
orders.PHYSICAL.processingSummary.remainingPhysicalLines = [];
orders.PHYSICAL.processingSummary.lines[0].pendingDispatchQuantity = 1;
orders.PHYSICAL.processingSummary.nextAction = {
    code: 'DISPATCH_PHYSICAL',
    label: '发出已有包裹',
    enabled: true,
    reason: '补充原包裹资料后继续发出',
    targetId: 'fixture-package',
};
const tasks: Record<string, any> = Object.fromEntries(
    Object.values(orders)
        .filter((order: any) => order.processingSummary.kind === 'DIGITAL')
        .map((order: any) => [
            order.id + '-task',
            {
                __typename: 'ManualDigitalDelivery',
                id: order.id + '-task',
                updatedAt: now,
                state: 'WAITING_PROCESSING',
                recipientEmail: 'synthetic@example.invalid',
                productName: order.lines[0].productVariant.name,
                sku: order.lines[0].productVariant.sku,
                quantity: order.lines[0].quantity,
                eligibleQuantity: order.processingSummary.lines[0].requiredQuantity,
                hasContent: false,
                expectedAt: now,
                overdue: false,
                attemptCount: 0,
                lastError: null,
                sentAt: null,
                order: { __typename: 'Order', id: order.id, code: order.code },
                packages: [],
                events: [],
            },
        ]),
);
if (params.has('existing')) {
    tasks['DIGITAL-task'].hasContent = true;
    tasks['DIGITAL-task'].state = 'DRAFT';
    tasks['DIGITAL-task'].packages = [
        {
            fields: [
                { key: 'account', label: '账号', value: 'SYNTHETIC-EXISTING', secret: false },
                { key: 'password', label: '密钥/密码', value: 'dummy-a-no-credential', secret: true },
            ],
            note: '已有合成成品，禁止空表覆盖',
            attachmentAssetIds: [],
        },
    ];
}
if (params.has('append-one') || params.has('eligible-one')) {
    const order = orders.DIGITAL;
    const task = tasks['DIGITAL-task'];
    const appendOnly = params.has('append-one');
    const purchased = appendOnly ? 3 : 2;
    const eligible = appendOnly ? 3 : 1;
    order.totalQuantity = order.lines[0].quantity = purchased;
    order.totalWithTax =
        order.subTotalWithTax =
        order.lines[0].linePriceWithTax =
        order.lines[0].discountedLinePriceWithTax =
            purchased * 1000;
    order.payments[0].amount = purchased * 1000;
    const summary = order.processingSummary;
    summary.settledAmount = purchased * 1000;
    summary.remainingDigitalQuantity = 1;
    summary.lines[0].quantity = purchased;
    summary.lines[0].requiredQuantity = eligible;
    summary.lines[0].pendingQuantity = 1;
    task.quantity = 2;
    task.eligibleQuantity = eligible;
    if (appendOnly) {
        task.hasContent = true;
        task.state = 'SENT';
        task.packages = [
            {
                fields: [{ key: 'account', label: '账号', value: 'SYNTHETIC-OLD-A', secret: false }],
                note: '原成品A保留',
                attachmentAssetIds: [],
            },
            {
                fields: [
                    { key: 'password', label: '密钥/密码', value: 'dummy-old-no-credential', secret: true },
                ],
                note: '原成品B保留',
                attachmentAssetIds: [],
            },
        ];
        summary.lines[0].deliveredQuantity = 2;
        summary.lines[0].claimStatus = 'PARTIAL';
        summary.lines[0].claimedQuantity = 1;
        summary.lines[0].notificationStatus = 'SENT';
        summary.fulfillmentStatus = 'PARTIAL';
        summary.fulfillmentLabel = '已发布2件，需补交1件';
        summary.nextAction.label = '补交新增成品';
    } else {
        summary.refundedAmount = 1000;
        summary.refundableAmount = summary.paymentCapabilities[0].refundableAmount = 1000;
        summary.paymentStatus = 'PARTIALLY_REFUNDED';
        summary.paymentLabel = '已按件退款1件';
        summary.lines[0].refundableQuantity = 1;
        order.payments[0].refunds = [
            {
                __typename: 'Refund',
                id: 'fixture-item-refund',
                createdAt: now,
                state: 'Settled',
                total: 1000,
                reason: '购买2件按件退款1件（合成）',
                transactionId: 'SYNTHETIC-NO-FUNDS',
            },
        ];
    }
}
function summaryUpdate(order: any) {
    order.updatedAt = new Date().toISOString();
    order.processingSummary.businessState = order.state;
}
if (params.has('resource-review')) {
    const summary = orders.DIGITAL.processingSummary;
    summary.hasException = true;
    summary.blockedReason = '付款已记录，交付资源不足，请补货后重试（合成）';
    summary.fulfillmentStatus = 'EXCEPTION';
    summary.fulfillmentLabel = '交付异常待处理';
    summary.nextAction = {
        code: 'RETRY_RESOURCE_DELIVERY',
        label: '重试交付',
        enabled: true,
        reason: null,
        targetId: 'DIGITAL',
    };
}
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                const name = operation.operationName;
                const input = operation.variables.input ?? {};
                let data: any;
                fixture.reads.push(name);
                switch (name) {
                    case 'RetryCheckoutDelivery': {
                        const order = orders[operation.variables.orderId];
                        fixture.writes.push({ operation: name, orderId: order.id });
                        const failed = params.has('resource-retry-failure');
                        if (!failed) {
                            order.processingSummary.hasException = false;
                            order.processingSummary.blockedReason = null;
                            order.processingSummary.fulfillmentLabel = '待数字交付';
                            order.processingSummary.nextAction = {
                                code: 'PREPARE_DELIVERY',
                                label: '准备交付',
                                enabled: true,
                                targetId: order.id + '-task',
                            };
                        }
                        data = {
                            retryCheckoutDelivery: {
                                __typename: 'CheckoutDeliveryException',
                                id: 'resource-hold',
                                orderId: order.id,
                                state: failed ? 'REVIEW' : 'CONFIRMED',
                                reviewReason: failed ? '库存仍不足，请补货后重试（合成）' : null,
                            },
                        };
                        break;
                    }
                    case 'GetSalesOrders': {
                        let items: any[] = Object.values(orders);
                        const category = operation.variables.options?.category ?? 'PENDING';
                        if (category === 'PENDING')
                            items = items.filter(item => item.processingSummary.needsProcessing);
                        if (category === 'AFTER_SALES')
                            items = items.filter(
                                item =>
                                    item.processingSummary.paymentStatus === 'REFUND_FAILED' ||
                                    item.processingSummary.afterSalesStatus !== 'NONE',
                            );
                        if (category === 'DIGITAL')
                            items = items.filter(
                                item =>
                                    item.processingSummary.kind === 'DIGITAL' &&
                                    item.processingSummary.needsProcessing,
                            );
                        if (category === 'PHYSICAL')
                            items = items.filter(
                                item =>
                                    item.processingSummary.kind === 'PHYSICAL' &&
                                    item.processingSummary.needsProcessing,
                            );
                        if (category === 'CANCELLED')
                            items = items.filter(item => item.state === 'Cancelled');
                        if (['EXCEPTIONS', 'AFTER_SALES'].includes(category)) items = [];
                        data = {
                            activeChannel,
                            orders: { __typename: 'OrderProcessingList', items, totalItems: items.length },
                            orderProcessingCounts: {
                                pending: 4,
                                digital: 2,
                                physical: 2,
                                exceptions: 0,
                                afterSales: 0,
                            },
                        };
                        break;
                    }
                    case 'GetSalesOrder':
                        data = {
                            activeChannel,
                            order: orders[operation.variables.id],
                            fulfillmentHandlers: [{ code: 'manual-fulfillment', args: [] }],
                        };
                        break;
                    case 'NextAdminOrderOperations':
                        data = { activeChannel, order: orders[operation.variables.id] };
                        break;
                    case 'NextAdminPaymentMethodsForManualPayment':
                        data = {
                            paymentMethods: {
                                items: [
                                    {
                                        id: 'fixture-payment-method',
                                        name: '人工转账（合成）',
                                        code: 'bank-transfer',
                                        description: '合成验收',
                                        enabled: true,
                                    },
                                ],
                                totalItems: 1,
                            },
                        };
                        break;
                    case 'NextAdminManualDelivery':
                        data = { manualDigitalDelivery: { ...tasks[operation.variables.id], packages: [] } };
                        break;
                    case 'NextAdminRevealManualDelivery':
                        data = { revealMyManualDigitalDelivery: tasks[operation.variables.id] };
                        break;
                    case 'SearchSalesOrderVariants':
                        data = { productVariants: { items: [], totalItems: 0 } };
                        break;
                    case 'NextAdminSaveManualDeliveryDraft':
                    case 'NextAdminPublishManualDelivery': {
                        const task = tasks[input.id];
                        fixture.writes.push({
                            operation: name,
                            input: { id: input.id, packageCount: input.packages.length },
                        });
                        task.packages = structuredClone(input.packages);
                        task.hasContent = true;
                        task.state = name === 'NextAdminPublishManualDelivery' ? 'SENDING' : 'DRAFT';
                        if (task.state === 'SENDING') task.quantity = input.packages.length;
                        task.updatedAt = new Date().toISOString();
                        if (task.state === 'SENDING') {
                            const order = orders[task.order.id];
                            order.processingSummary.lines[0].notificationStatus = 'QUEUED';
                            order.processingSummary.lines[0].status = 'READY';
                            order.processingSummary.lines[0].deliveredQuantity = task.quantity;
                            order.processingSummary.lines[0].pendingQuantity = 0;
                            order.processingSummary.nextAction = null;
                            order.processingSummary.fulfillmentLabel = '交付已发布，通知发送中（合成）';
                            summaryUpdate(order);
                        }
                        data = {
                            [name === 'NextAdminPublishManualDelivery'
                                ? 'publishManualDigitalDelivery'
                                : 'saveManualDigitalDeliveryDraft']: task,
                        };
                        break;
                    }
                    case 'NextAdminAppendManualDelivery': {
                        const task = tasks[input.id];
                        if (
                            !['SENT', 'EMAIL_FAILED', 'MANUAL_REVIEW'].includes(task.state) ||
                            input.packages.length !== Math.max(0, task.eligibleQuantity - task.quantity)
                        )
                            throw new Error('Synthetic append requires exactly the missing eligible units');
                        const originals = structuredClone(task.packages);
                        fixture.writes.push({
                            operation: name,
                            input: { id: input.id, packageCount: input.packages.length },
                        });
                        task.packages.push(...structuredClone(input.packages));
                        task.quantity += input.packages.length;
                        task.state = 'SENDING';
                        task.updatedAt = new Date().toISOString();
                        fixture.appendChecks.push({
                            originalCount: originals.length,
                            addedCount: input.packages.length,
                            totalCount: task.packages.length,
                            originalsRetained:
                                JSON.stringify(task.packages.slice(0, originals.length)) ===
                                JSON.stringify(originals),
                        });
                        const summary = orders[task.order.id].processingSummary;
                        summary.remainingDigitalQuantity = summary.lines[0].pendingQuantity = 0;
                        summary.lines[0].deliveredQuantity = task.quantity;
                        summary.lines[0].notificationStatus = 'QUEUED';
                        summary.nextAction = null;
                        data = { appendManualDigitalDelivery: task };
                        break;
                    }
                    case 'RefundSalesOrder': {
                        fixture.writes.push({ operation: name, input: structuredClone(input) });
                        const order = Object.values(orders).find((item: any) =>
                            item.payments.some((payment: any) => payment.id === input.paymentId),
                        ) as any;
                        const refund = {
                            __typename: 'Refund',
                            id: 'synthetic-refund-' + fixture.writes.length,
                            createdAt: now,
                            state: 'Pending',
                            total: input.amount,
                            reason: input.reason,
                            transactionId: null,
                        };
                        order.payments[0].refunds.push(refund);
                        order.processingSummary.pendingRefundAmount += input.amount;
                        order.processingSummary.refundableAmount -= input.amount;
                        order.processingSummary.paymentCapabilities[0].refundableAmount -= input.amount;
                        order.processingSummary.paymentStatus = 'REFUND_PENDING';
                        order.processingSummary.paymentLabel = '退款处理中（合成）';
                        data = { refundOrder: refund };
                        break;
                    }
                    case 'NextAdminRetryRefund': {
                        fixture.writes.push({ operation: name, input: structuredClone(input) });
                        fixture.refundRetryAttempts++;
                        const previous = refundRetryResults.get(input.idempotencyKey);
                        if (previous) {
                            data = { retryRefund: previous };
                            break;
                        }
                        const refund = retryOrder.payments[0].refunds.find(
                            (item: any) => item.id === input.refundId,
                        );
                        if (!refund || refund.state !== 'Failed')
                            throw new Error('Only the original failed refund can retry');
                        if (params.has('retry-known-failure') && fixture.refundRetryAttempts === 1) {
                            refundRetryResults.set(input.idempotencyKey, structuredClone(refund));
                            data = { retryRefund: refund };
                            break;
                        }
                        refund.state = 'Pending';
                        retrySummary.pendingRefundAmount = refund.total;
                        retrySummary.refundableAmount =
                            retrySummary.paymentCapabilities[0].refundableAmount = 500;
                        retrySummary.paymentStatus = 'REFUND_PENDING';
                        retrySummary.paymentLabel = '退款处理中（合成）';
                        retrySummary.nextAction = null;
                        refundRetryResults.set(input.idempotencyKey, structuredClone(refund));
                        summaryUpdate(retryOrder);
                        if (params.has('retry-response-loss') && fixture.refundRetryAttempts === 1) {
                            observer.error(new Error('合成网络回执丢失，请沿用原请求编号重试'));
                            return;
                        }
                        data = { retryRefund: refund };
                        break;
                    }
                    case 'NextAdminPrepareFulfillmentShipment': {
                        fixture.writes.push({ operation: name, input: structuredClone(input) });
                        const fulfillment = orders.PHYSICAL.fulfillments[0];
                        fulfillment.method = input.carrier;
                        fulfillment.trackingCode = input.trackingCode;
                        data = { prepareFulfillmentShipment: fulfillment };
                        break;
                    }
                    case 'TransitionSalesFulfillment': {
                        fixture.writes.push({ operation: name, input: structuredClone(operation.variables) });
                        const fulfillment = orders.PHYSICAL.fulfillments[0];
                        const requestedState = operation.variables.state;
                        if (!fulfillment.nextStates.includes(requestedState)) {
                            data = {
                                transitionFulfillmentToState: {
                                    __typename: 'FulfillmentStateTransitionError',
                                    errorCode: 'FULFILLMENT_STATE_TRANSITION_ERROR',
                                    message: '合成验收严格执行 Created → Pending → Shipped',
                                },
                            };
                            break;
                        }
                        if (requestedState === 'Pending') {
                            fulfillment.state = 'Pending';
                            fulfillment.nextStates = ['Shipped'];
                            data = { transitionFulfillmentToState: fulfillment };
                            break;
                        }
                        fixture.shipmentAttempts++;
                        if (params.has('dispatch-failure') && fixture.shipmentAttempts === 1)
                            data = {
                                transitionFulfillmentToState: {
                                    __typename: 'FulfillmentStateTransitionError',
                                    errorCode: 'FULFILLMENT_STATE_TRANSITION_ERROR',
                                    message: '合成包裹首次发出失败，保留原包裹',
                                    transitionError: 'synthetic failure',
                                },
                            };
                        else {
                            fulfillment.state = 'Shipped';
                            fulfillment.nextStates = ['Delivered'];
                            orders.PHYSICAL.state = 'Shipped';
                            orders.PHYSICAL.processingSummary.remainingPhysicalQuantity = 0;
                            orders.PHYSICAL.processingSummary.lines[0].pendingDispatchQuantity = 0;
                            orders.PHYSICAL.processingSummary.lines[0].pendingQuantity = 0;
                            orders.PHYSICAL.processingSummary.lines[0].status = 'IN_TRANSIT';
                            orders.PHYSICAL.processingSummary.fulfillmentLabel = '实物运输中（合成）';
                            orders.PHYSICAL.processingSummary.nextAction = {
                                code: 'TRACK_SHIPMENT',
                                label: '跟进物流',
                                enabled: true,
                                reason: null,
                                targetId: fulfillment.id,
                            };
                            summaryUpdate(orders.PHYSICAL);
                            data = { transitionFulfillmentToState: fulfillment };
                        }
                        break;
                    }
                    case 'ModifySalesOrder': {
                        const order = orders[input.orderId];
                        const next = structuredClone(order);
                        for (const changed of input.adjustOrderLines ?? [])
                            next.lines.find((line: any) => line.id === changed.orderLineId).quantity =
                                changed.quantity;
                        next.totalQuantity = next.lines.reduce(
                            (sum: number, line: any) => sum + line.quantity,
                            0,
                        );
                        next.totalWithTax = next.totalQuantity * 1000;
                        for (const line of next.lines) {
                            line.linePriceWithTax = line.quantity * 1000;
                            line.discountedLinePriceWithTax = line.linePriceWithTax;
                        }
                        if (!input.dryRun) {
                            fixture.writes.push({ operation: name, input: structuredClone(input) });
                            Object.assign(order, next);
                            summaryUpdate(order);
                        }
                        data = { modifyOrder: next };
                        break;
                    }
                    case 'FinishOrderModification': {
                        fixture.writes.push({ operation: name, input: structuredClone(operation.variables) });
                        fixture.finishAttempts++;
                        if (params.has('finish-failure') && fixture.finishAttempts === 1) {
                            observer.error(new Error('合成结束修改首次失败'));
                            return;
                        }
                        const order = orders[operation.variables.orderId];
                        order.state =
                            order.totalWithTax > 1000 ? 'ArrangingAdditionalPayment' : 'PaymentSettled';
                        order.nextStates = ['Modifying', 'Cancelled'];
                        summaryUpdate(order);
                        data = { finishOrderModification: order };
                        break;
                    }
                    default:
                        observer.error(new Error('合成验收未配置操作：' + name));
                        return;
                }
                observer.next({ data: structuredClone(data) });
                observer.complete();
            }),
    ),
});
Object.assign(window, {
    orderProcessingFixture: fixture,
    orderProcessingCacheContainsSyntheticSecret: () =>
        JSON.stringify(client.cache.extract()).includes('dummy-a-no-credential'),
    orderProcessingTaskMetadata: (id: string) => ({
        quantity: tasks[id].quantity,
        eligibleQuantity: tasks[id].eligibleQuantity,
        state: tasks[id].state,
        packageCount: tasks[id].packages.length,
    }),
});
defineNextAdminExtension({
    id: 'order-processing-browser-fixture',
    pageBlocks: [
        {
            id: 'fixture-payments',
            pageId: 'order-detail',
            component: OrderOperationsBlock,
            permissions: ['ReadOrder'],
        },
    ],
});
const orderId = params.get('order') ?? 'DIGITAL';
const entry = params.has('list')
    ? '/sales/orders?tab=pending'
    : params.has('modify')
      ? '/sales/orders/' + orderId + '/modify'
      : '/sales/orders/' + orderId;
createRoot(document.getElementById('root')!).render(
    React.createElement(
        React.Fragment,
        null,
        <ApolloProvider client={client}>
            <AdminPermissionsProvider
                permissions={[
                    'ReadOrder',
                    'UpdateOrder',
                    'ReadPaymentMethod',
                    'SensitiveStoreFinance',
                    ...(params.has('no-reveal') ? [] : ['ReadSoldAutoCards']),
                ]}
            >
                <CustomFieldsContext.Provider value={{ availableLanguages: ['zh_Hans'], entities: [] }}>
                    <FeatureHelpProvider>
                        <ConfirmDialogProvider>
                            <div className="flex h-screen min-w-0 flex-col">
                                <div className="shrink-0 bg-amber-100 px-4 py-1.5 text-xs text-amber-900">
                                    本地合成验收 · 正式订单页面 · 没有生产、资金或邮件连接
                                </div>
                                <MemoryRouter initialEntries={[entry]}>
                                    <Routes>
                                        <Route path="/sales/orders" element={<SalesModule />} />
                                        <Route path="/sales/orders/:id" element={<OrderEditor />} />
                                        <Route
                                            path="/sales/orders/:id/modify"
                                            element={<ModifyOrderEditor />}
                                        />
                                        <Route path="*" element={<p>合成验收辅助入口</p>} />
                                    </Routes>
                                </MemoryRouter>
                            </div>
                        </ConfirmDialogProvider>
                    </FeatureHelpProvider>
                </CustomFieldsContext.Provider>
            </AdminPermissionsProvider>
        </ApolloProvider>,
    ),
);
