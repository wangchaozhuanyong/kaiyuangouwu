// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModifyOrderEditor } from './OrderWorkflowEditor';

const mocks = vi.hoisted(() => ({
    modify: vi.fn(),
    finish: vi.fn(),
    confirm: vi.fn(),
    order: {
        id: 'order-1',
        updatedAt: '2026-10-04T08:00:00Z',
        code: 'FIXTURE-1',
        state: 'Modifying',
        nextStates: ['PaymentSettled'],
        salesChannel: { id: 'store-1', code: 'fixture' },
        currencyCode: 'CNY',
        totalWithTax: 1000,
        couponCodes: [],
        shippingLines: [],
        payments: [],
        lines: [
            {
                id: 'line-1',
                quantity: 1,
                unitPriceWithTax: 1000,
                linePriceWithTax: 1000,
                productVariant: { id: 'variant-1', name: '测试商品', sku: 'FIXTURE-1' },
            },
        ],
    },
}));

vi.mock('@apollo/client/react', () => ({
    useMutation: (document: { definitions: Array<{ kind: string; name?: { value: string } }> }) => {
        const operation =
            document.definitions.find(item => item.kind === 'OperationDefinition')?.name?.value ?? '';
        return [
            operation.includes('FinishOrderModification') ? mocks.finish : mocks.modify,
            { loading: false },
        ];
    },
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: (_document: unknown, options: { skip?: boolean }) => ({
        data: options.skip
            ? undefined
            : { order: mocks.order, activeChannel: { id: 'store-1', code: 'fixture' } },
        loading: false,
        refetch: vi.fn(),
    }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../components/confirm-dialog-context', () => ({ useConfirmDialog: () => mocks.confirm }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const click = async (host: HTMLElement, label: string) => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
};
const enterNote = async (host: HTMLElement) => {
    const field = host.querySelector('textarea')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
            field,
            'fixture modification',
        );
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
afterEach(() => {
    vi.clearAllMocks();
});

describe('modification completion recovery', () => {
    it('retries only finish after a saved modification and failed finish; it never resubmits the saved change', async () => {
        mocks.confirm.mockResolvedValue(true);
        mocks.modify
            .mockResolvedValueOnce({
                data: {
                    modifyOrder: {
                        __typename: 'Order',
                        id: 'order-1',
                        state: 'Modifying',
                        totalWithTax: 2000,
                    },
                },
            })
            .mockResolvedValueOnce({
                data: { modifyOrder: { __typename: 'Order', id: 'order-1', state: 'Modifying' } },
            });
        mocks.finish.mockRejectedValueOnce(new Error('fixture finish rejected')).mockResolvedValueOnce({
            data: {
                finishOrderModification: {
                    __typename: 'Order',
                    id: 'order-1',
                    state: 'ArrangingAdditionalPayment',
                },
            },
        });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <MemoryRouter initialEntries={['/sales/orders/order-1/modify']}>
                        <Routes>
                            <Route path="/sales/orders/:id/modify" element={<ModifyOrderEditor />} />
                            <Route path="/sales/orders/:id" element={<p>订单详情入口</p>} />
                        </Routes>
                    </MemoryRouter>,
                ),
            );
            await act(async () =>
                host.querySelector<HTMLButtonElement>('[aria-label="增加测试商品数量"]')!.click(),
            );
            await enterNote(host);
            await click(host, '预览修改结果');
            await click(host, '保存并结束修改');
            expect(mocks.modify).toHaveBeenCalledTimes(2);
            expect(mocks.modify.mock.calls[0][0].variables.input.dryRun).toBe(true);
            expect(mocks.modify.mock.calls[0][0].fetchPolicy).toBe('no-cache');
            expect(mocks.modify.mock.calls[1][0].variables.input.dryRun).toBe(false);
            expect(host.textContent).toContain('修改已写入');
            expect(host.querySelector('fieldset')?.disabled).toBe(true);
            await click(host, '重试结束修改');
            expect(mocks.modify).toHaveBeenCalledTimes(2);
            expect(mocks.finish).toHaveBeenCalledTimes(2);
            expect(host.textContent).toContain('订单详情入口');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    it('preserves a dirty draft if ending modification is rejected', async () => {
        mocks.confirm.mockResolvedValue(true);
        mocks.finish.mockRejectedValue(new Error('fixture cannot finish'));
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <MemoryRouter initialEntries={['/sales/orders/order-1/modify']}>
                        <Routes>
                            <Route path="/sales/orders/:id/modify" element={<ModifyOrderEditor />} />
                        </Routes>
                    </MemoryRouter>,
                ),
            );
            await enterNote(host);
            await click(host, '放弃修改并退出');
            expect(mocks.modify).not.toHaveBeenCalled();
            expect(host.querySelector('textarea')?.value).toBe('fixture modification');
            expect(host.textContent).toContain('无法结束修改');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    it('holds an uncertain submit for readback without issuing another modification', async () => {
        mocks.confirm.mockResolvedValue(true);
        mocks.modify
            .mockReset()
            .mockResolvedValueOnce({
                data: {
                    modifyOrder: {
                        __typename: 'Order',
                        id: 'order-1',
                        state: 'Modifying',
                        totalWithTax: 2000,
                    },
                },
            })
            .mockRejectedValueOnce(new Error('fixture response lost'));
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <MemoryRouter initialEntries={['/sales/orders/order-1/modify']}>
                        <Routes>
                            <Route path="/sales/orders/:id/modify" element={<ModifyOrderEditor />} />
                        </Routes>
                    </MemoryRouter>,
                ),
            );
            await act(async () =>
                host.querySelector<HTMLButtonElement>('[aria-label="增加测试商品数量"]')!.click(),
            );
            await enterNote(host);
            await click(host, '预览修改结果');
            await click(host, '保存并结束修改');
            expect(host.textContent).toContain('提交结果待核实');
            expect(host.querySelector('textarea')?.value).toBe('fixture modification');
            const submit = [...host.querySelectorAll('button')].find(
                item => item.textContent?.trim() === '保存并结束修改',
            )!;
            expect(submit.disabled).toBe(true);
            await act(async () => submit.click());
            expect(mocks.modify).toHaveBeenCalledTimes(2);
            expect(host.textContent).toContain('核实后结束修改');
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    it('requires the shared sensitive password context for a real reduction refund', async () => {
        const saved = structuredClone(mocks.order);
        Object.assign(mocks.order, {
            processingSummary: {
                canRefund: true,
                isTestOrder: false,
                paymentCapabilities: [{ paymentId: 'payment-1', canRefund: true, refundableAmount: 1000 }],
            },
            payments: [
                { id: 'payment-1', state: 'Settled', method: 'bank-transfer', amount: 1000, refunds: [] },
            ],
        });
        mocks.confirm.mockResolvedValue(true);
        mocks.modify
            .mockReset()
            .mockResolvedValueOnce({
                data: {
                    modifyOrder: {
                        __typename: 'Order',
                        id: 'order-1',
                        state: 'Modifying',
                        totalWithTax: 500,
                    },
                },
            })
            .mockResolvedValueOnce({
                data: { modifyOrder: { __typename: 'RefundOrderError', message: 'fixture rejection' } },
            })
            .mockResolvedValueOnce({
                data: { modifyOrder: { __typename: 'Order', id: 'order-1', state: 'Modifying' } },
            });
        mocks.finish.mockReset().mockResolvedValue({
            data: {
                finishOrderModification: { __typename: 'Order', id: 'order-1', state: 'PaymentSettled' },
            },
        });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    <MemoryRouter initialEntries={['/sales/orders/order-1/modify']}>
                        <Routes>
                            <Route path="/sales/orders/:id/modify" element={<ModifyOrderEditor />} />
                            <Route path="/sales/orders/:id" element={<p>订单详情入口</p>} />
                        </Routes>
                    </MemoryRouter>,
                ),
            );
            await act(async () =>
                host.querySelector<HTMLButtonElement>('[aria-label="减少测试商品数量"]')!.click(),
            );
            await enterNote(host);
            await click(host, '预览修改结果');
            await click(host, '保存并结束修改');
            expect(mocks.modify).toHaveBeenCalledOnce();
            expect(host.textContent).toContain('输入当前管理员密码');
            const field = host.querySelector<HTMLInputElement>('input[type="password"]')!;
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                    field,
                    'fixture confirmation',
                );
                field.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await click(host, '保存并结束修改');
            expect(mocks.modify).toHaveBeenCalledTimes(2);
            expect(mocks.modify.mock.calls[1][0].context.headers['x-vendure-sensitive-action-password']).toBe(
                'fixture confirmation',
            );
            expect(mocks.modify.mock.calls[1][0].variables.input.refunds).toEqual([
                expect.objectContaining({
                    paymentId: 'payment-1',
                    amount: 500,
                    reason: 'fixture modification',
                    idempotencyKey: expect.any(String),
                }),
            ]);
            const key = mocks.modify.mock.calls[1][0].variables.input.refunds[0].idempotencyKey;
            await click(host, '保存并结束修改');
            expect(mocks.modify).toHaveBeenCalledTimes(3);
            expect(mocks.modify.mock.calls[2][0].variables.input.refunds[0].idempotencyKey).toBe(key);
            expect(host.textContent).toContain('订单详情入口');
        } finally {
            await act(async () => root.unmount());
            host.remove();
            Object.assign(mocks.order, saved);
            delete (mocks.order as Record<string, unknown>).processingSummary;
        }
    });
});
