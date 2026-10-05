// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PaymentCard } from './OrderOperationsBlock';
import { OrderProcessingSummaryPanel } from './OrderProcessingSummaryPanel';
import { OrderRefundScopeFields } from './OrderRefundScopeFields';
import { buildCompatibleRefundOrderInput, type OrderProcessingSummary } from './sales-utils';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const summary = (overrides: Partial<OrderProcessingSummary> = {}): OrderProcessingSummary => ({
    orderId: 'order-1',
    kind: 'DIGITAL',
    businessState: 'PaymentSettled',
    paymentStatus: 'PAID',
    paymentLabel: '已付款',
    fulfillmentStatus: 'WAITING',
    fulfillmentLabel: '待数字交付',
    afterSalesStatus: 'NONE',
    afterSalesLabel: '无售后',
    isTestOrder: false,
    needsProcessing: true,
    hasException: false,
    canManage: true,
    settledAmount: 1000,
    pendingRefundAmount: 0,
    refundedAmount: 0,
    refundableAmount: 1000,
    refundableShippingAmount: 0,
    outstandingAmount: 0,
    remainingDigitalQuantity: 1,
    remainingPhysicalQuantity: 0,
    canRefund: true,
    paymentCapabilities: [],
    remainingPhysicalLines: [],
    nextAction: { code: 'PREPARE_DELIVERY', label: '准备成品', enabled: true, targetId: 'task-1' },
    lines: [
        {
            orderLineId: 'line-1',
            productName: '数字成品',
            sku: 'DIGITAL-1',
            fulfillmentType: 'digital',
            digitalDeliveryMode: 'manual_service',
            quantity: 1,
            requiredQuantity: 1,
            refundableQuantity: 1,
            deliveredQuantity: 0,
            pendingQuantity: 1,
            pendingDispatchQuantity: 0,
            status: 'WAITING',
            notificationStatus: 'UNKNOWN',
            claimStatus: 'UNKNOWN',
            taskId: 'task-1',
        },
    ],
    ...overrides,
});

async function withView(element: ReactElement, check: (host: HTMLDivElement) => Promise<void> | void) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(element));
        await check(host);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
}

describe('order processing summary', () => {
    it('shows uncertainty and offers no fabricated completion action when summary is unavailable', async () => {
        await withView(
            <OrderProcessingSummaryPanel currencyCode="CNY" canOperate busy={false} onAction={vi.fn()} />,
            host => {
                expect(host.textContent).toContain('尚未取得');
                expect(host.querySelector('button')).toBeNull();
            },
        );
    });

    it('keeps four progress axes and directs the one primary action to the server target', async () => {
        const onAction = vi.fn();
        const record = summary();
        await withView(
            <OrderProcessingSummaryPanel
                summary={record}
                currencyCode="CNY"
                canOperate
                busy={false}
                onAction={onAction}
            />,
            async host => {
                expect([...host.querySelectorAll('dt')].map(item => item.textContent)).toEqual([
                    '付款',
                    '交付',
                    '售后',
                    '通知',
                ]);
                expect(host.textContent).toContain('通知结果待核实');
                expect(host.textContent).toContain('发送渠道已接收');
                const buttons = [...host.querySelectorAll('button')];
                expect(buttons).toHaveLength(1);
                await act(async () => buttons[0].click());
                expect(onAction).toHaveBeenCalledExactlyOnceWith(record.nextAction);
            },
        );
    });

    it('blocks disabled server actions even for an editor', async () => {
        await withView(
            <OrderProcessingSummaryPanel
                summary={summary({
                    nextAction: {
                        code: 'PREPARE_DELIVERY',
                        label: '准备成品',
                        enabled: false,
                        reason: '退款核验中',
                    },
                })}
                currencyCode="CNY"
                canOperate
                busy={false}
                onAction={vi.fn()}
            />,
            host => {
                expect(host.querySelector('button')?.disabled).toBe(true);
                expect(host.textContent).toContain('退款核验中');
            },
        );
    });
});

const payment = {
    id: 'payment-1',
    createdAt: '2026-10-04T08:00:00Z',
    state: 'Settled',
    nextStates: ['Cancelled'],
    method: 'bank-transfer',
    transactionId: 'fixture-transaction',
    amount: 1000,
    errorMessage: null,
    refunds: [
        {
            id: 'refund-1',
            createdAt: '2026-10-04T08:05:00Z',
            state: 'Pending',
            total: 1000,
            reason: 'fixture',
            transactionId: null,
        },
    ],
};

describe('payment capabilities in the order', () => {
    it('offers protected retry only for the original failed real refund with sensitive finance capability', async () => {
        const failed = {
            ...payment,
            refunds: payment.refunds.map(refund => ({ ...refund, state: 'Failed' })),
        };
        const onRetry = vi.fn();
        await withView(
            <PaymentCard
                payment={failed}
                currencyCode="CNY"
                canOperate
                canRetryRefund
                canCancel={false}
                isTestOrder={false}
                refundSettlementMode="manual"
                onAction={vi.fn()}
                onSettleRefund={vi.fn()}
                onRetryRefund={onRetry}
            />,
            async host => {
                await act(async () => host.querySelector('button')!.click());
                expect(onRetry).toHaveBeenCalledExactlyOnceWith('refund-1');
                expect(host.textContent).not.toContain('登记人工退款凭证');
            },
        );
        for (const blocked of [
            { canRetryRefund: false, canOperate: true, isTestOrder: false, refundSettlementMode: 'manual' },
            { canRetryRefund: true, canOperate: false, isTestOrder: false, refundSettlementMode: 'manual' },
            { canRetryRefund: true, canOperate: true, isTestOrder: true, refundSettlementMode: 'manual' },
            {
                canRetryRefund: true,
                canOperate: true,
                isTestOrder: false,
                refundSettlementMode: 'unsupported',
            },
        ])
            await withView(
                <PaymentCard
                    payment={failed}
                    currencyCode="CNY"
                    canCancel={false}
                    onAction={vi.fn()}
                    onSettleRefund={vi.fn()}
                    onRetryRefund={onRetry}
                    {...blocked}
                />,
                host => {
                    expect(host.querySelector('button')).toBeNull();
                },
            );
    });
    it('never offers cancellation for settled money despite legacy nextStates', async () => {
        await withView(
            <PaymentCard
                payment={payment}
                currencyCode="CNY"
                canOperate
                canCancel
                isTestOrder={false}
                refundSettlementMode="automatic"
                onAction={vi.fn()}
                onSettleRefund={vi.fn()}
            />,
            host => {
                expect(host.textContent).not.toContain('取消支付授权');
                expect(host.textContent).toContain('等待支付渠道退款回执');
                expect(host.querySelector('button')).toBeNull();
            },
        );
    });

    it('sends pending verified-external refunds to the dedicated verification screen', async () => {
        await withView(
            <MemoryRouter>
                <PaymentCard
                    payment={payment}
                    currencyCode="CNY"
                    canOperate
                    canCancel={false}
                    isTestOrder={false}
                    refundSettlementMode="verified-external"
                    onAction={vi.fn()}
                    onSettleRefund={vi.fn()}
                />
            </MemoryRouter>,
            host => {
                expect(host.querySelector('a')?.getAttribute('href')).toBe('/settings/usdt-payments');
                expect(host.textContent).not.toContain('登记人工退款凭证');
                expect(host.textContent).not.toContain('结算退款');
            },
        );
    });

    it('offers a manual evidence workflow only for a real manual refund', async () => {
        const onSettleRefund = vi.fn();
        await withView(
            <PaymentCard
                payment={payment}
                currencyCode="CNY"
                canOperate
                canCancel={false}
                isTestOrder={false}
                refundSettlementMode="manual"
                onAction={vi.fn()}
                onSettleRefund={onSettleRefund}
            />,
            async host => {
                await act(async () => host.querySelector('button')!.click());
                expect(onSettleRefund).toHaveBeenCalledExactlyOnceWith('refund-1');
            },
        );
        await withView(
            <PaymentCard
                payment={{ ...payment, method: 'controlled-test-payment-2' }}
                currencyCode="CNY"
                canOperate
                canCancel={false}
                isTestOrder={false}
                refundSettlementMode="manual"
                onAction={vi.fn()}
                onSettleRefund={vi.fn()}
            />,
            host => {
                expect(host.querySelector('button')).toBeNull();
                expect(host.textContent).toContain('不能手工标记成功');
            },
        );
    });

    it('exposes authorization cancellation only when the server allows it', async () => {
        const onAction = vi.fn();
        await withView(
            <PaymentCard
                payment={{ ...payment, state: 'Authorized', refunds: [] }}
                currencyCode="CNY"
                canOperate
                canCancel
                isTestOrder={false}
                onAction={onAction}
                onSettleRefund={vi.fn()}
            />,
            async host => {
                await act(async () => host.querySelector('button')!.click());
                expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancel-payment' }));
            },
        );
    });
});

describe('refund purpose and entitlement units', () => {
    it('provides per-item quantity budgets while excluding physical shipping from digital orders', async () => {
        await withView(
            <OrderRefundScopeFields
                summary={summary({ refundableShippingAmount: 300 })}
                scope="ITEMS"
                quantities={{ 'line-1': 1 }}
                onScopeChange={vi.fn()}
                onQuantityChange={vi.fn()}
            />,
            host => {
                expect([...host.querySelectorAll('option')].map(item => item.value)).toEqual([
                    'ITEMS',
                    'COMPENSATION',
                ]);
                const field = host.querySelector('input')!;
                expect(field.max).toBe('1');
                expect(field.value).toBe('1');
                expect(host.textContent).toContain('退款中的对应份数暂停交付');
            },
        );
    });

    it('offers physical shipping separately from the units and compensation', async () => {
        await withView(
            <OrderRefundScopeFields
                summary={summary({ kind: 'MIXED', refundableShippingAmount: 300 })}
                scope="SHIPPING"
                quantities={{}}
                onScopeChange={vi.fn()}
                onQuantityChange={vi.fn()}
            />,
            host => {
                expect([...host.querySelectorAll('option')].map(item => item.value)).toEqual([
                    'ITEMS',
                    'SHIPPING',
                    'COMPENSATION',
                ]);
                expect(host.querySelector('input')).toBeNull();
                expect(host.textContent).toContain('不撤销商品交付权益');
            },
        );
    });

    it('passes the selected item units, purpose, case and retry key to the real refund input', () => {
        expect(
            buildCompatibleRefundOrderInput('payment-1', 1000, 'fixture', 'attempt-1', {
                lines: [{ orderLineId: 'line-1', quantity: 1 }],
                shipping: 0,
                reasonType: 'ITEMS',
                afterSalesId: 'case-1',
            }),
        ).toEqual({
            paymentId: 'payment-1',
            amount: 1000,
            reason: 'fixture',
            lines: [{ orderLineId: 'line-1', quantity: 1 }],
            shipping: 0,
            adjustment: 0,
            idempotencyKey: 'attempt-1',
            reasonType: 'ITEMS',
            afterSalesId: 'case-1',
        });
    });
});
