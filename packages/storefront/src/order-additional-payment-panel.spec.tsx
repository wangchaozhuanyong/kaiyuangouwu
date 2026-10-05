// @vitest-environment jsdom
import type { MarketConfig, Order } from './types';
import { QueryClientProvider } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrderAdditionalPaymentPanel } from './order-additional-payment-panel';
import { createStorefrontQueryClient } from './query-client';
const market = { code: 'fixture', locale: 'zh-CN', currencyCode: 'CNY' } as MarketConfig;
const order = {
    id: 'order',
    code: 'ORDER',
    state: 'ArrangingAdditionalPayment',
    currencyCode: 'CNY',
    customer: { id: 'customer' },
} as Order;
const quote = {
    orderId: 'order',
    state: 'ArrangingAdditionalPayment',
    outstandingAmount: 500,
    blockedReason: null,
    methods: [{ id: 'gateway', code: 'gateway', name: '合成测试方式', isEligible: true }],
};
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach(dispose => dispose()));
async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}
async function mount(api: any, changedOrder = order) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const client = createStorefrontQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    await act(() =>
        Promise.resolve(
            root.render(
                <StrictMode>
                    <QueryClientProvider client={client}>
                        <OrderAdditionalPaymentPanel
                            api={api}
                            order={changedOrder}
                            market={market}
                            language="zh"
                            confirmationToken="synthetic-proof"
                        />
                    </QueryClientProvider>
                </StrictMode>,
            ),
        ),
    );
    await settle();
    cleanup.push(() => {
        act(() => root.unmount());
        host.remove();
        client.clear();
    });
    return { host, client };
}
function paymentButton(host: HTMLElement) {
    return [...host.querySelectorAll<HTMLButtonElement>('button')].find(button =>
        button.textContent?.includes('确认支付'),
    );
}
describe('placed order additional payment UI', () => {
    it('creates a USDT request only on confirmation and never reports the quote as a payment', async () => {
        const issued = {
            id: 'quote',
            fiatAmount: 500,
            paymentStatus: 'PENDING',
            network: 'TRC20',
            usdtAmount: 0.700123,
            receivingAddress: 'SYNTHETIC-ADDRESS-NOT-A-WALLET',
        };
        const api = {
            orderAdditionalPaymentQuote: vi.fn().mockResolvedValue({
                ...quote,
                methods: [{ code: 'usdt-trc20', isEligible: true, name: 'USDT' }],
            }),
            createModifiedOrderUsdtQuote: vi.fn().mockResolvedValue(issued),
            addPaymentToModifiedOrder: vi.fn(),
        };
        const { host } = await mount(api);
        expect(api.createModifiedOrderUsdtQuote).not.toHaveBeenCalled();
        const buttonValue = requireFixture(
            [...host.querySelectorAll('button')].find(button => button.textContent?.includes('生成 USDT')),
        );
        await act(() => {
            return Promise.resolve().then(() => {
                buttonValue.click();
                buttonValue.click();
            });
        });
        await settle();
        expect(api.createModifiedOrderUsdtQuote).toHaveBeenCalledTimes(1);
        expect(api.createModifiedOrderUsdtQuote).toHaveBeenCalledWith('order', 500, 'synthetic-proof');
        expect(api.addPaymentToModifiedOrder).not.toHaveBeenCalled();
        expect(host.textContent).toContain('等待链上固化到账');
        expect(host.textContent).toContain('0.700123 USDT');
        expect(host.textContent).not.toContain('补款已登记');
    });
    it('applies a partial available balance once and refreshes the actual remaining amount', async () => {
        const api = {
            orderAdditionalPaymentQuote: vi.fn().mockResolvedValue({
                ...quote,
                walletAvailableAmount: 200,
                methods: [{ code: 'referral-balance', isEligible: true, name: '余额' }],
            }),
            useModifiedOrderReferralBalance: vi
                .fn()
                .mockResolvedValue({ id: 'order', state: 'ArrangingAdditionalPayment' }),
            addPaymentToModifiedOrder: vi.fn(),
        };
        const { host } = await mount(api);
        const buttonValue = requireFixture(
            [...host.querySelectorAll('button')].find(button => button.textContent?.includes('确认使用余额')),
        );
        await act(() => {
            return Promise.resolve().then(() => {
                buttonValue.click();
                buttonValue.click();
            });
        });
        await settle();
        expect(api.useModifiedOrderReferralBalance).toHaveBeenCalledTimes(1);
        expect(api.useModifiedOrderReferralBalance).toHaveBeenCalledWith(
            'order',
            500,
            200,
            expect.any(String),
        );
        expect(api.addPaymentToModifiedOrder).not.toHaveBeenCalled();
        expect(host.textContent).toContain('余额抵扣已登记');
        expect(host.textContent).not.toContain('结果确认前不要再次支付');
    });
    it('reads a quote without charging and submits only the displayed amount after explicit confirmation', async () => {
        const api = {
            orderAdditionalPaymentQuote: vi.fn().mockResolvedValue(quote),
            addPaymentToModifiedOrder: vi.fn().mockResolvedValue({ id: 'order', state: 'PaymentSettled' }),
        };
        const { host, client } = await mount(api);
        expect(api.addPaymentToModifiedOrder).not.toHaveBeenCalled();
        expect(
            JSON.stringify(
                client
                    .getQueryCache()
                    .getAll()
                    .map(query => query.queryKey),
            ),
        ).not.toContain('synthetic-proof');
        await act(() => {
            return Promise.resolve().then(() => {
                requireFixture(paymentButton(host)).click();
                requireFixture(paymentButton(host)).click();
            });
        });
        await settle();
        expect(api.addPaymentToModifiedOrder).toHaveBeenCalledTimes(1);
        expect(api.addPaymentToModifiedOrder).toHaveBeenCalledWith(
            'order',
            'gateway',
            500,
            'synthetic-proof',
        );
        expect(host.textContent).toContain('补款已登记');
        expect(paymentButton(host)?.disabled).toBe(true);
    });
    it('keeps an acknowledged partial deduction locked through refresh failure until the new amount is verified', async () => {
        const balanceQuote = {
            ...quote,
            walletAvailableAmount: 200,
            methods: [{ code: 'referral-balance', isEligible: true, name: '余额' }],
        };
        const api = {
            orderAdditionalPaymentQuote: vi.fn().mockResolvedValue(balanceQuote),
            useModifiedOrderReferralBalance: vi
                .fn()
                .mockResolvedValue({ id: 'order', state: 'ArrangingAdditionalPayment' }),
        };
        const { host } = await mount(api);
        api.orderAdditionalPaymentQuote.mockRejectedValue(new Error('synthetic read failure'));
        const buttonValue = requireFixture(
            [...host.querySelectorAll('button')].find(button => button.textContent?.includes('确认使用余额')),
        );
        await act(() => Promise.resolve(buttonValue.click()));
        await settle();
        expect(api.useModifiedOrderReferralBalance).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain('余额抵扣已登记');
        expect(host.textContent).toContain('剩余金额尚未更新');
        expect(buttonValue.disabled).toBe(true);
        // A successful stale read must also retain the lock.
        api.orderAdditionalPaymentQuote.mockResolvedValue(balanceQuote);
        const refresh = requireFixture(
            [...host.querySelectorAll('button')].find(
                buttonValueScoped => buttonValueScoped.textContent === '刷新付款状态',
            ),
        );
        await act(() => Promise.resolve(refresh.click()));
        await settle();
        expect(buttonValue.disabled).toBe(true);
        api.orderAdditionalPaymentQuote.mockResolvedValue({
            ...balanceQuote,
            outstandingAmount: 300,
            walletAvailableAmount: 0,
            methods: [{ code: 'gateway', name: '合成测试方式', isEligible: true }],
        });
        await act(() => Promise.resolve(refresh.click()));
        await settle();
        expect(paymentButton(host)?.disabled).toBe(false);
        expect(host.textContent).not.toContain('剩余金额尚未更新');
        expect(api.useModifiedOrderReferralBalance).toHaveBeenCalledTimes(1);
    });
    it('retains an uncertain result and never repeats collection after a refresh', async () => {
        const api = {
            orderAdditionalPaymentQuote: vi.fn().mockResolvedValue(quote),
            addPaymentToModifiedOrder: vi.fn().mockRejectedValue(new Error('synthetic network failure')),
        };
        const { host } = await mount(api);
        await act(() => Promise.resolve(requireFixture(paymentButton(host)).click()));
        await settle();
        expect(host.textContent).toContain('结果确认前不要再次支付');
        const refresh = requireFixture(
            [...host.querySelectorAll('button')].find(button => button.textContent === '刷新付款状态'),
        );
        await act(() => Promise.resolve(refresh.click()));
        await settle();
        await act(() => Promise.resolve(requireFixture(paymentButton(host)).click()));
        await settle();
        expect(api.addPaymentToModifiedOrder).toHaveBeenCalledTimes(1);
    });
    it('does not claim completion when the server still reports additional payment pending', async () => {
        const api = {
            orderAdditionalPaymentQuote: vi.fn().mockResolvedValue(quote),
            addPaymentToModifiedOrder: vi
                .fn()
                .mockResolvedValue({ id: 'order', state: 'ArrangingAdditionalPayment' }),
        };
        const { host } = await mount(api);
        await act(() => Promise.resolve(requireFixture(paymentButton(host)).click()));
        await settle();
        expect(host.textContent).toContain('结果确认前不要再次支付');
        expect(host.textContent).not.toContain('补款已登记');
    });
    it('explains verified external payment without offering a nonfunctional submit button', async () => {
        const api = {
            orderAdditionalPaymentQuote: vi.fn().mockResolvedValue({ ...quote, methods: [] }),
            addPaymentToModifiedOrder: vi.fn(),
        };
        const { host } = await mount(api);
        expect(host.textContent).toContain('需商家核验补款');
        expect(paymentButton(host)).toBeUndefined();
        expect(api.addPaymentToModifiedOrder).not.toHaveBeenCalled();
    });
    it('does not quote or collect money for a cancelled order', async () => {
        const api = { orderAdditionalPaymentQuote: vi.fn(), addPaymentToModifiedOrder: vi.fn() };
        const { host } = await mount(api, { ...order, state: 'Cancelled' });
        expect(host.textContent).toBe('');
        expect(api.orderAdditionalPaymentQuote).not.toHaveBeenCalled();
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
// organize-imports-ignore -- Preserve ESLint grouping of type-only imports.
