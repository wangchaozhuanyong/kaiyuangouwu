// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { OrderEditor } from './OrderEditor';

const mocks = vi.hoisted(() => ({
    refund: vi.fn(),
    refetch: vi.fn(),
    other: vi.fn(),
    prepare: vi.fn(),
    transition: vi.fn(),
    order: {
        id: 'order-1',
        createdAt: '2026-10-04T08:00:00Z',
        code: 'FIXTURE-1',
        state: 'PaymentSettled',
        nextStates: [],
        active: false,
        totalQuantity: 1,
        subTotalWithTax: 1000,
        shippingWithTax: 0,
        totalWithTax: 1000,
        currencyCode: 'CNY',
        couponCodes: [],
        customFields: {},
        discounts: [],
        salesChannel: { id: 'store-1', code: 'fixture' },
        channels: [],
        shippingLines: [],
        fulfillments: [],
        history: { items: [], totalItems: 0 },
        payments: [{ id: 'payment-1', state: 'Settled', method: 'bank-transfer', amount: 1000, refunds: [] }],
        lines: [
            {
                id: 'line-1',
                quantity: 1,
                unitPriceWithTax: 1000,
                proratedUnitPriceWithTax: 1000,
                linePriceWithTax: 1000,
                discountedLinePriceWithTax: 1000,
                productVariant: { id: 'variant-1', name: '测试数字商品', sku: 'FIXTURE-1' },
                customFields: {
                    fulfillmentTypeSnapshot: 'digital',
                    digitalDeliveryModeSnapshot: 'manual_service',
                },
            },
        ],
        processingSummary: {
            orderId: 'order-1',
            kind: 'DIGITAL',
            businessState: 'PaymentSettled',
            paymentStatus: 'PAID',
            paymentLabel: '已付款',
            fulfillmentStatus: 'WAITING',
            fulfillmentLabel: '待交付',
            afterSalesStatus: 'NONE',
            afterSalesLabel: '无售后',
            isTestOrder: false,
            needsProcessing: true,
            hasException: false,
            canManage: true,
            settledAmount: 1000,
            pendingRefundAmount: 0,
            refundedAmount: 0,
            refundableAmount: 800,
            refundableShippingAmount: 0,
            outstandingAmount: 0,
            remainingDigitalQuantity: 1,
            remainingPhysicalQuantity: 0,
            canRefund: true,
            remainingPhysicalLines: [],
            nextAction: null,
            paymentCapabilities: [
                {
                    paymentId: 'payment-1',
                    canRefund: true,
                    refundableAmount: 800,
                    canCancel: false,
                    refundSettlementMode: 'manual',
                },
            ],
            lines: [
                {
                    orderLineId: 'line-1',
                    productName: '测试数字商品',
                    sku: 'FIXTURE-1',
                    fulfillmentType: 'digital',
                    digitalDeliveryMode: 'manual_service',
                    quantity: 1,
                    requiredQuantity: 1,
                    refundableQuantity: 1,
                    deliveredQuantity: 0,
                    pendingQuantity: 1,
                    pendingDispatchQuantity: 0,
                    status: 'WAITING',
                    notificationStatus: 'NONE',
                    claimStatus: 'UNKNOWN',
                    taskId: null,
                },
            ],
        },
    },
}));

vi.mock('@apollo/client/react', () => ({
    useMutation: (document: { definitions: Array<{ kind: string; name?: { value: string } }> }) => {
        const operation = document.definitions.find(item => item.kind === 'OperationDefinition')?.name?.value;
        const fn =
            operation === 'RefundSalesOrder'
                ? mocks.refund
                : operation === 'NextAdminPrepareFulfillmentShipment'
                  ? mocks.prepare
                  : operation === 'TransitionSalesFulfillment'
                    ? mocks.transition
                    : mocks.other;
        return [fn, { loading: false }];
    },
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: () => ({
        data: {
            order: mocks.order,
            activeChannel: { id: 'store-1', code: 'fixture' },
            fulfillmentHandlers: [],
        },
        loading: false,
        refetch: mocks.refetch,
    }),
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({
        hasAnyPermission: (permissions: string[]) => permissions.includes('UpdateOrder'),
    }),
}));
vi.mock('../../custom-fields/custom-fields-context', () => ({ useCustomFieldDefinitions: () => [] }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../components/confirm-dialog-context', () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock('../../extensions/extension-hosts', () => ({
    NextAdminActions: () => null,
    NextAdminPageBlocks: () => null,
}));
vi.mock('./OrderProfitExpensePanel', () => ({ OrderProfitExpensePanel: () => null }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function editInput(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => {
        const proto =
            field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

describe('refund submission recovery', () => {
    it('uses authoritative payment budget and retries a failed network request with the same key and selected item units', async () => {
        mocks.refund
            .mockReset()
            .mockRejectedValueOnce(new Error('fixture network failure'))
            .mockResolvedValueOnce({
                data: { refundOrder: { __typename: 'Refund', id: 'refund-1', state: 'Pending' } },
            });
        mocks.refetch.mockReset().mockRejectedValue(new Error('fixture readback failure'));
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <MemoryRouter initialEntries={['/sales/orders/order-1?afterSalesId=case-1']}>
                        <Routes>
                            <Route path="/sales/orders/:id" element={<OrderEditor />} />
                        </Routes>
                    </MemoryRouter>,
                ),
            );
            await act(async () =>
                [...host.querySelectorAll('button')]
                    .find(item => item.textContent?.trim() === '申请退款')!
                    .click(),
            );
            const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
            expect(dialog.textContent).toContain('可退 ¥8.00');
            expect(dialog.textContent).not.toContain('实物运费退款');
            await editInput(
                dialog.querySelector<HTMLInputElement>('[aria-label="测试数字商品退款份数"]')!,
                '1',
            );
            await editInput(dialog.querySelector<HTMLTextAreaElement>('textarea')!, 'fixture refund reason');
            await editInput(
                dialog.querySelector<HTMLInputElement>('input[type="password"]')!,
                'fixture confirmation',
            );
            const submit = [...dialog.querySelectorAll('button')].find(
                item => item.textContent?.trim() === '提交退款',
            )!;
            await act(async () => submit.click());
            expect(host.querySelector('[role="dialog"]')).not.toBeNull();
            expect(mocks.refund).toHaveBeenCalledTimes(1);
            await act(async () => submit.click());
            expect(mocks.refund).toHaveBeenCalledTimes(2);
            const first = mocks.refund.mock.calls[0][0].variables.input;
            const second = mocks.refund.mock.calls[1][0].variables.input;
            expect(first.idempotencyKey).toBeTruthy();
            expect(second.idempotencyKey).toBe(first.idempotencyKey);
            expect(second).toEqual(
                expect.objectContaining({
                    amount: 800,
                    reasonType: 'ITEMS',
                    shipping: 0,
                    afterSalesId: 'case-1',
                    lines: [{ orderLineId: 'line-1', quantity: 1 }],
                }),
            );
            expect(host.querySelector('[role="dialog"]')).toBeNull();
            expect(host.textContent).toContain('退款记录已创建');
            expect(mocks.refetch).toHaveBeenCalledOnce();
            expect(mocks.refund).toHaveBeenCalledTimes(2);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});

describe('existing physical package recovery', () => {
    it.each([
        { initialState: 'Created', failedState: 'Pending', expected: ['Pending', 'Pending', 'Shipped'] },
        { initialState: 'Created', failedState: 'Shipped', expected: ['Pending', 'Shipped', 'Shipped'] },
        { initialState: 'Pending', failedState: 'Shipped', expected: ['Shipped', 'Shipped'] },
    ])(
        'retries $initialState package after $failedState rejection through legal transitions without replacement',
        async ({ initialState, failedState, expected }) => {
            const saved = structuredClone(mocks.order);
            const order = mocks.order as Record<string, any>;
            order.processingSummary.kind = 'PHYSICAL';
            order.processingSummary.remainingPhysicalQuantity = 1;
            order.processingSummary.remainingDigitalQuantity = 0;
            order.processingSummary.nextAction = {
                code: 'DISPATCH_PHYSICAL',
                label: '发出已有包裹',
                enabled: true,
                targetId: 'fulfillment-1',
            };
            order.processingSummary.lines[0].fulfillmentType = 'physical';
            order.processingSummary.lines[0].pendingDispatchQuantity = 1;
            order.lines[0].customFields.fulfillmentTypeSnapshot = 'physical';
            order.fulfillments = [
                {
                    id: 'fulfillment-1',
                    state: initialState,
                    nextStates: initialState === 'Created' ? ['Pending'] : ['Shipped'],
                    handlerCode: 'manual-fulfillment',
                    method: '',
                    trackingCode: '',
                    lines: [{ orderLineId: 'line-1', quantity: 1 }],
                },
            ];
            mocks.other.mockReset();
            mocks.prepare.mockReset().mockImplementation(async () => ({
                data: {
                    prepareFulfillmentShipment: {
                        id: 'fulfillment-1',
                        state: order.fulfillments[0].state,
                    },
                },
            }));
            let rejected = false;
            mocks.transition
                .mockReset()
                .mockImplementation(async ({ variables }: { variables: { id: string; state: string } }) => {
                    const fulfillment = order.fulfillments[0];
                    expect(variables.id).toBe('fulfillment-1');
                    expect(fulfillment.nextStates).toContain(variables.state);
                    if (variables.state === failedState && !rejected) {
                        rejected = true;
                        return {
                            data: {
                                transitionFulfillmentToState: {
                                    __typename: 'FulfillmentStateTransitionError',
                                    message: 'fixture rejected',
                                },
                            },
                        };
                    }
                    fulfillment.state = variables.state;
                    fulfillment.nextStates = variables.state === 'Pending' ? ['Shipped'] : ['Delivered'];
                    return {
                        data: {
                            transitionFulfillmentToState: {
                                __typename: 'Fulfillment',
                                id: 'fulfillment-1',
                                state: variables.state,
                            },
                        },
                    };
                });
            mocks.refetch.mockReset().mockResolvedValue(undefined);
            const host = document.createElement('div');
            document.body.append(host);
            const root = createRoot(host);
            try {
                await act(async () =>
                    root.render(
                        <MemoryRouter initialEntries={['/sales/orders/order-1']}>
                            <Routes>
                                <Route path="/sales/orders/:id" element={<OrderEditor />} />
                            </Routes>
                        </MemoryRouter>,
                    ),
                );
                await act(async () =>
                    [...host.querySelectorAll('button')]
                        .find(item => item.textContent?.trim() === '发出已有包裹')!
                        .click(),
                );
                const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
                expect(dialog.textContent).toContain('fulfillment-1');
                const fields = dialog.querySelectorAll<HTMLInputElement>('input');
                await editInput(fields[0], 'fixture carrier');
                await editInput(fields[1], 'fixture tracking');
                const submit = [...dialog.querySelectorAll('button')].find(
                    item => item.textContent?.trim() === '确认包裹已发出',
                )!;
                await act(async () => submit.click());
                expect(host.querySelector('[role="dialog"]')).not.toBeNull();
                expect(fields[1].value).toBe('fixture tracking');
                await act(async () => submit.click());
                expect(mocks.prepare).toHaveBeenCalledTimes(2);
                expect(mocks.prepare.mock.calls[1][0].variables.input).toEqual({
                    fulfillmentId: 'fulfillment-1',
                    carrier: 'fixture carrier',
                    trackingCode: 'fixture tracking',
                });
                expect(mocks.transition.mock.calls.map(call => call[0].variables)).toEqual(
                    expected.map(state => ({ id: 'fulfillment-1', state })),
                );
                expect(mocks.other).not.toHaveBeenCalled();
                expect(host.querySelector('[role="dialog"]')).toBeNull();
            } finally {
                await act(async () => root.unmount());
                host.remove();
                Object.assign(mocks.order, saved);
            }
        },
    );
});
