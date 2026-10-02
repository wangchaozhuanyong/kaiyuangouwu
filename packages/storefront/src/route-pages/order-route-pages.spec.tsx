// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { OrdersRoutePage } from './order-route-pages';

const state = vi.hoisted(() => ({
    resolveDetail: undefined as (() => void) | undefined,
    order: vi.fn(),
}));
vi.mock('./shared', () => ({
    RouteGate: ({ children }: { children: ReactNode }) => children,
    registerRoutePreload: vi.fn(),
    useRouteRuntime: () => ({
        customer: { id: 'local-customer' },
        market: { code: 'local', currencyCode: 'MYR' },
        language: 'zh',
        locale: 'zh-CN',
        route: { name: 'orders' },
        api: { order: state.order },
        goBack: vi.fn(),
    }),
}));
vi.mock('../lazy-storefront-pages', async () => {
    const { lazy } = await import('react');
    return {
        LazyLogisticsPage: () => null,
        LazyAddressesPage: () => null,
        LazyAccountSecurityPage: () => null,
        LazyOrdersPage: ({ onOpenOrder }: { onOpenOrder: (id: string) => void }) => (
            <button onClick={() => onOpenOrder('local-order')}>查看详情</button>
        ),
        LazyOrderDetailPage: lazy(
            () =>
                new Promise<{ default: () => React.JSX.Element }>(resolve => {
                    state.resolveDetail = () => resolve({ default: () => <p>订单内容已就绪</p> });
                }),
        ),
    };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the drawer and order list visible when order data arrives before the detail module', async () => {
    let resolveOrder!: (order: { id: string; state: string }) => void;
    state.order.mockReturnValue(
        new Promise(resolve => {
            resolveOrder = resolve;
        }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const originalOverflow = document.body.style.overflow;
    try {
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <OrdersRoutePage />
                </QueryClientProvider>,
            ),
        );
        const trigger = host.querySelector<HTMLButtonElement>('button');
        if (!trigger) throw new Error('Missing order detail trigger');
        act(() => trigger.click());
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) throw new Error('Missing order detail drawer');
        expect(dialog.textContent).toContain('正在加载订单详情');
        await act(async () => {
            resolveOrder({ id: 'local-order', state: 'Delivered' });
            await new Promise(resolve => setTimeout(resolve, 10));
        });
        expect(state.resolveDetail).toBeTypeOf('function');
        expect(document.querySelector('[role="dialog"]')).toBe(dialog);
        expect((dialog.parentElement as HTMLElement).style.display).not.toBe('none');
        expect(trigger.style.display).not.toBe('none');
        expect(host.textContent).not.toContain('正在加载页面');
        await act(async () => {
            state.resolveDetail?.();
            await Promise.resolve();
        });
        expect(document.querySelector('[role="dialog"]')).toBe(dialog);
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
        expect(dialog.textContent).toContain('订单内容已就绪');
        act(() => (dialog.querySelector('button[aria-label="关闭"]') as HTMLButtonElement).click());
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.body.style.overflow).toBe(originalOverflow);
    } finally {
        act(() => root.unmount());
        client.clear();
        host.remove();
    }
});
