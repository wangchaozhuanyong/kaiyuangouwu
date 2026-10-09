// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type RouteState } from '../storefront-router';
import { type CustomerAddress } from '../types';

import {
    AddressesRoutePage,
    LogisticsRoutePage,
    OrderDetailRoutePage,
    OrdersRoutePage,
} from './order-route-pages';

type LogisticsReturnProps = {
    onBack: () => void;
    onReturnToRoute: (route: RouteState) => void;
};
type AddressReturnProps = {
    onBack: () => void;
    selection?: { addressId?: string; editAddress?: boolean; onUse: (address: CustomerAddress) => void };
};

const state = vi.hoisted(() => {
    const initial: { route: RouteState } = { route: { name: 'orders' } };
    return {
        resolveDetail: undefined as (() => void) | undefined,
        order: vi.fn(),
        route: initial.route,
        navigate: vi.fn(),
        goBack: vi.fn(),
        returnToRoute: vi.fn(),
        logisticsProps: undefined as LogisticsReturnProps | undefined,
        addressProps: undefined as AddressReturnProps | undefined,
    };
});
vi.mock('./shared', () => ({
    RouteGate: ({ children }: { children: ReactNode }) => children,
    registerRoutePreload: vi.fn(),
    useRouteRuntime: () => ({
        customer: { id: 'local-customer' },
        market: { code: 'local', currencyCode: 'MYR' },
        language: 'zh',
        locale: 'zh-CN',
        route: state.route,
        api: { order: state.order },
        navigate: state.navigate,
        goBack: state.goBack,
        returnToRoute: state.returnToRoute,
        routeOrderError: 'QA order unavailable',
    }),
}));
vi.mock('../lazy-storefront-pages', async () => {
    const { lazy } = await import('react');
    return {
        LazyLogisticsPage: (props: LogisticsReturnProps) => {
            state.logisticsProps = props;
            return <button onClick={props.onBack}>返回账户</button>;
        },
        LazyAddressesPage: (props: AddressReturnProps) => {
            state.addressProps = props;
            return <button onClick={props.onBack}>返回结算</button>;
        },
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

describe('order route return bindings', () => {
    let mounted:
        { root: ReturnType<typeof createRoot>; client: QueryClient; host: HTMLDivElement } | undefined;

    function renderPage(page: ReactNode) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        mounted = { root, client, host };
        act(() => root.render(<QueryClientProvider client={client}>{page}</QueryClientProvider>));
        return host;
    }

    beforeEach(() => {
        state.route = { name: 'orders' };
        state.goBack.mockReset();
        state.navigate.mockReset();
        state.returnToRoute.mockReset();
        state.logisticsProps = undefined;
        state.addressProps = undefined;
    });

    afterEach(() => {
        state.route = { name: 'orders' };
        if (!mounted) return;
        act(() => mounted?.root.unmount());
        mounted.client.clear();
        mounted.host.remove();
        mounted = undefined;
    });

    it('returns logistics to account and passes its explicit return callback directly to the page', () => {
        state.route = { name: 'logistics', deliveryStatus: 'transit', term: 'QA order' };
        const host = renderPage(<LogisticsRoutePage />);
        expect(state.logisticsProps?.onReturnToRoute).toBe(state.returnToRoute);
        const button = host.querySelector<HTMLButtonElement>('button');
        if (!button) throw new Error('Expected the logistics page return control');
        act(() => button.click());
        expect(state.returnToRoute).toHaveBeenCalledExactlyOnceWith({ name: 'account' });
        state.returnToRoute.mockClear();
        const target: RouteState = { name: 'logistics', deliveryStatus: 'transit', term: 'QA order' };
        state.logisticsProps?.onReturnToRoute(target);
        expect(state.returnToRoute).toHaveBeenCalledExactlyOnceWith(target);
        expect(state.navigate).not.toHaveBeenCalled();
        expect(state.goBack).not.toHaveBeenCalled();
    });

    it.each(['logistics', 'logistics-detail'] as const)(
        'preserves the full %s return context from order detail',
        source => {
            state.route = {
                name: 'order-detail',
                id: 'qa-order',
                source,
                deliveryStatus: 'delivered',
                term: 'QA delivery search',
            };
            const host = renderPage(<OrderDetailRoutePage />);
            const button = host.querySelector<HTMLButtonElement>('button[aria-label="返回"]');
            if (!button) throw new Error('Expected the actual order detail return control');
            act(() => button.click());
            expect(state.returnToRoute).toHaveBeenCalledExactlyOnceWith({
                name: 'logistics',
                id: source === 'logistics-detail' ? 'qa-order' : undefined,
                deliveryStatus: 'delivered',
                term: 'QA delivery search',
            });
            expect(state.navigate).not.toHaveBeenCalled();
            expect(state.goBack).not.toHaveBeenCalled();
        },
    );

    it('uses generic back for order detail without an explicit logistics source', () => {
        state.route = { name: 'order-detail', id: 'qa-order' };
        const host = renderPage(<OrderDetailRoutePage />);
        const button = host.querySelector<HTMLButtonElement>('button[aria-label="返回"]');
        if (!button) throw new Error('Expected the actual order detail return control');
        act(() => button.click());
        expect(state.goBack).toHaveBeenCalledOnce();
        expect(state.returnToRoute).not.toHaveBeenCalled();
        expect(state.navigate).not.toHaveBeenCalled();
    });

    it.each(['purchase', 'checkout'] as const)(
        'returns address selection to %s while keeping address confirmation as replace navigation',
        returnTo => {
            state.route = {
                name: 'addresses',
                returnTo,
                checkoutOrderId: 'qa-checkout-order',
                addressId: 'qa-original-address',
                editAddress: true,
            };
            const host = renderPage(<AddressesRoutePage />);
            const button = host.querySelector<HTMLButtonElement>('button');
            if (!button) throw new Error('Expected the address page return control');
            act(() => button.click());
            expect(state.returnToRoute).toHaveBeenCalledExactlyOnceWith({
                name: returnTo,
                checkoutOrderId: 'qa-checkout-order',
                addressId: 'qa-original-address',
            });
            expect(state.navigate).not.toHaveBeenCalled();
            expect(state.addressProps?.selection?.editAddress).toBe(true);
            state.returnToRoute.mockClear();
            const address: CustomerAddress = {
                id: 'qa-new-address',
                fullName: null,
                phoneNumber: null,
                streetLine1: '',
                streetLine2: null,
                city: null,
                province: null,
                postalCode: null,
                defaultShippingAddress: false,
                defaultBillingAddress: false,
                country: { code: 'MY', name: 'Malaysia' },
            };
            state.addressProps?.selection?.onUse(address);
            expect(state.navigate).toHaveBeenCalledExactlyOnceWith(
                { name: returnTo, checkoutOrderId: 'qa-checkout-order', addressId: 'qa-new-address' },
                true,
            );
            expect(state.returnToRoute).not.toHaveBeenCalled();
            expect(state.goBack).not.toHaveBeenCalled();
        },
    );
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
        const pending = dialog.querySelector('[role="status"][aria-busy="true"]');
        expect(pending?.getAttribute('aria-label')).toBe('正在加载订单详情');
        expect(pending?.querySelector('.brand-loading-bar')).not.toBeNull();
        expect(pending?.getAttribute('data-page-pending')).toBe('data');
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
