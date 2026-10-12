// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflineOrderPaymentPanel } from './OfflineOrderPaymentPanel';
const mocks = vi.hoisted(() => ({
    canFinance: true,
    recoveryError: false,
    refetch: vi.fn(),
    mutate: vi.fn(),
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => mocks.canFinance }),
}));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: () => ({
        loading: false,
        data: undefined,
        error: mocks.recoveryError ? new Error('synthetic read failure') : undefined,
        refetch: mocks.refetch,
    }),
}));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
vi.mock('../../apollo', () => ({
    sensitiveActionContext: (password: string) => ({ syntheticPasswordCheck: Boolean(password) }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
    mocks.canFinance = true;
    mocks.recoveryError = false;
    mocks.refetch.mockReset();
    mocks.mutate.mockReset();
});
const pending = {
    id: 'order-a',
    code: 'ORDER-A',
    currencyCode: 'MYR',
    processingSummary: { canManage: true, isTestOrder: false },
    payments: [{ id: 'payment-a', kind: 'OFFLINE_MANUAL', state: 'PendingManual', amount: 1000 }],
    state: 'AwaitingManualPayment',
};
async function view(order: unknown, run: (host: HTMLDivElement) => void | Promise<void>) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <MemoryRouter>
                    <OfflineOrderPaymentPanel order={order as never} onChanged={vi.fn()} />
                </MemoryRouter>,
            ),
        );
        await run(host);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
}
describe('protected offline order operations', () => {
    it('shows actual receipt fields and prevents a confirmation without bank evidence', async () => {
        await view(pending, async host => {
            expect(host.textContent).toContain('待客服确认实际收款');
            expect(host.textContent).toContain('实际交易号');
            expect(host.textContent).toContain('实际到账时间');
            await act(async () =>
                [...host.querySelectorAll('button')]
                    .find(button => button.textContent === '核实到账并确认原付款')
                    ?.click(),
            );
            expect(host.textContent).toContain('请填写实际交易号');
            expect(mocks.mutate).not.toHaveBeenCalled();
        });
    });
    it('leaves unauthorized operators able to read the status without finance controls', async () => {
        mocks.canFinance = false;
        await view(pending, host => {
            expect(host.textContent).toContain('没有敏感店铺财务核款权限');
            expect(host.querySelector('input')).toBeNull();
            expect(host.textContent).not.toContain('核实到账并确认原付款');
        });
    });
    it('offers receipt recheck and refund-only paths instead of registering another payment', async () => {
        await view({ ...pending, payments: [{ ...pending.payments[0], state: 'Error' }] }, host => {
            expect(host.textContent).toContain('按原收款证据重新核验');
            expect(host.textContent).toContain('此款仅转入退款处理');
            expect(host.textContent).not.toContain('添加付款');
        });
    });
    it('retries only failed legacy reads while preserving source evidence', async () => {
        mocks.recoveryError = true;
        await view(
            { ...pending, payments: [], processingSummary: { canManage: true, isTestOrder: true } },
            async host => {
                expect(host.textContent).toContain('保留原模拟证据');
                await act(async () =>
                    [...host.querySelectorAll('button')]
                        .find(button => button.textContent === '重试读取')
                        ?.click(),
                );
                expect(mocks.refetch).toHaveBeenCalledTimes(1);
                expect(mocks.mutate).not.toHaveBeenCalled();
            },
        );
    });
});
