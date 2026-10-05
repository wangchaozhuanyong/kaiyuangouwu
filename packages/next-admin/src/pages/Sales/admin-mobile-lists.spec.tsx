// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { CustomersModule } from '../Customers/CustomersModule';
import { SalesModule } from './SalesModule';

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), refetch: vi.fn() }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const customer = {
    id: 'customer-1',
    firstName: '移动验收',
    lastName: '客户',
    createdAt: '2026-10-01T00:00:00Z',
    emailAddress: 'mobile-layout@example.invalid',
    phoneNumber: '+60123456789',
    groups: [{ id: 'group-1', name: '需要跟进的客户' }],
    user: { verified: true },
    orders: {
        totalItems: 1,
        items: [{ id: 'order-1', code: 'MOBILE-ORDER-1', orderPlacedAt: '2026-10-01T00:00:00Z' }],
    },
};
function order(id: string, channelId: string) {
    return {
        id,
        code: `MOBILE-${id}`,
        createdAt: '2026-10-01T00:00:00Z',
        orderPlacedAt: '2026-10-01T00:00:00Z',
        state: 'PaymentSettled',
        active: false,
        totalQuantity: 2,
        totalWithTax: 10000,
        currencyCode: 'CNY',
        salesChannel: { id: channelId, code: channelId },
        customer,
        shippingAddress: null,
        payments: [],
        fulfillments: [],
        processingSummary: {
            paymentLabel: '已付款',
            fulfillmentLabel: '待发货',
            afterSalesLabel: '无售后',
            nextAction: { label: '填写运单' },
            remainingPhysicalLines: [{ orderLineId: `line-${id}`, quantity: 2 }],
            lines: [{ fulfillmentType: 'physical', notificationStatus: 'NOT_REQUIRED' }],
        },
        lines: [
            {
                id: `line-${id}`,
                quantity: 2,
                productVariant: {
                    id: 'variant-1',
                    name: '长商品名称用于移动端换行验收',
                    sku: 'MOBILE-SKU',
                    options: [],
                    customFields: { fulfillmentType: 'physical' },
                },
            },
        ],
    };
}
const response = {
    activeChannel: { id: 'channel-1', code: '__default_channel__' },
    orders: { totalItems: 45, items: [order('order-1', 'channel-1'), order('order-2', 'other-channel')] },
    orderProcessingCounts: { pending: 2, digital: 0, physical: 1, exceptions: 0, afterSales: 0, all: 45 },
    fulfillmentDeliveryExceptions: { totalItems: 0 },
    customers: { totalItems: 45, items: [customer] },
    customerGroup: { id: 'group-1', customers: { totalItems: 1, items: [customer] } },
    customerGroups: {
        totalItems: 1,
        items: [{ id: 'group-1', name: '需要跟进的客户', customers: { totalItems: 1 } }],
    },
    open: { totalItems: 0 },
    overdue: { totalItems: 0 },
};
function LocationProbe() {
    return <output data-location>{JSON.stringify(useLocation())}</output>;
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    sessionStorage.clear();
    mocks.query.mockReset().mockReturnValue({ data: response, loading: false, refetch: mocks.refetch });
    mocks.mutate.mockReset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
async function renderPage(page: 'sales' | 'customers', writable = true) {
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={[`/${page}?page=2&pageSize=50&search=mobile`]}>
                <AdminPermissionsContext.Provider
                    value={{
                        permissions: [],
                        hasAnyPermission: permissions =>
                            writable || permissions.every(permission => permission.startsWith('Read')),
                    }}
                >
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <FeatureHelpProvider>
                            {page === 'sales' ? <SalesModule /> : <CustomersModule />}
                        </FeatureHelpProvider>
                    </ConfirmDialogContext.Provider>
                    <LocationProbe />
                </AdminPermissionsContext.Provider>
            </MemoryRouter>,
        ),
    );
}
function button(text: string, within: ParentNode = host) {
    const result = [...within.querySelectorAll<HTMLButtonElement>('button')].find(
        item => item.textContent?.trim() === text,
    );
    expect(result, text).toBeDefined();
    return result!;
}
async function select(element: HTMLSelectElement, value: string) {
    await act(async () => {
        element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
}
function location() {
    return JSON.parse(host.querySelector('[data-location]')!.textContent!);
}

describe('mobile lists preserve shared business behavior', () => {
    it('keeps orders usable and shows unknown counts when processing statistics are unavailable', async () => {
        mocks.query.mockReturnValue({
            data: { ...response, orderProcessingCounts: undefined },
            loading: false,
            refetch: mocks.refetch,
        });
        await renderPage('sales');
        expect(host.querySelector('[aria-label="订单摘要列表"]')!.textContent).toContain('填写运单');
        const counts = [...host.querySelectorAll('dl dd')].map(item => item.textContent);
        expect(counts).toContain('—');
        expect(host.textContent).toContain('虚拟待交付');
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
    it('shares order selection, blocks another channel and resets selection/page on sorting', async () => {
        await renderPage('sales');
        const mobile = host.querySelector('[aria-label="订单摘要列表"]')!;
        expect(mobile.textContent).toContain('长商品名称用于移动端换行验收');
        expect(mobile.textContent).toContain('已付款');
        expect(mobile.textContent).toContain('待发货');
        expect(mobile.textContent).toContain('无售后');
        expect(mobile.textContent).toContain('无需数字通知');
        expect(mobile.querySelectorAll('input')).toHaveLength(0);
        await act(async () => button('批量管理').click());
        const choices = [...mobile.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        expect(choices).toHaveLength(2);
        expect(choices[0].disabled).toBe(false);
        expect(choices[1].disabled).toBe(true);
        await act(async () => choices[0].click());
        expect(
            host.querySelector<HTMLInputElement>(
                '.admin-desktop-table [aria-label="选择订单 MOBILE-order-1"]',
            )!.checked,
        ).toBe(true);
        expect(button('批量填写运单并发货').disabled).toBe(false);
        const beforeFilters = location().search;
        await act(async () => button('筛选与排序').click());
        await select(host.querySelector('.admin-mobile-sort select')!, 'totalWithTax');
        expect(location().search).toBe(beforeFilters);
        expect(choices[0].checked).toBe(true);
        await act(async () => button('取消', host.querySelector('[role="dialog"]')!).click());
        expect(location().search).toBe(beforeFilters);
        await act(async () => button('筛选与排序').click());
        expect(host.querySelector<HTMLSelectElement>('.admin-mobile-sort select')!.value).toBe(
            'orderPlacedAt',
        );
        await select(host.querySelector('.admin-mobile-sort select')!, 'totalWithTax');
        await act(async () => button('降序 ↓', host.querySelector('.admin-mobile-sort')!).click());
        const orderState = [...host.querySelectorAll<HTMLSelectElement>('[role="dialog"] select')].find(
            item => [...item.options].some(option => option.value === 'PHYSICAL'),
        )!;
        await select(orderState, 'PHYSICAL');
        await act(async () => button('应用', host.querySelector('[role="dialog"]')!).click());
        expect(new URLSearchParams(location().search).get('tab')).toBe('physical');
        expect(new URLSearchParams(location().search).get('sort')).toBe('totalWithTax');
        expect(new URLSearchParams(location().search).get('page')).toBeNull();
        expect(new URLSearchParams(location().search).get('pageSize')).toBe('50');
        expect(choices[0].checked).toBe(false);
        expect(button('批量填写运单并发货').disabled).toBe(true);
        expect(new URLSearchParams(location().search).get('direction')).toBe('ASC');
        const returnTo = `${location().pathname}${location().search}`;
        await act(async () => button('填写运单', mobile).click());
        expect(location().pathname).toBe('/sales/orders/order-1');
        expect(location().state.returnTo).toBe(returnTo);
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
    it('keeps mobile order batch actions unavailable without write permission', async () => {
        await renderPage('sales', false);
        expect([...host.querySelectorAll('button')].some(item => item.textContent === '批量管理')).toBe(
            false,
        );
        expect(host.querySelector('[aria-label="订单摘要列表"]')!.querySelectorAll('input')).toHaveLength(0);
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
    it('shares customer bulk selection, sorting and group filters with existing controls', async () => {
        await renderPage('customers');
        const mobile = host.querySelector('[aria-label="客户摘要列表"]')!;
        expect(mobile.textContent).toContain(customer.emailAddress);
        expect(mobile.textContent).toContain('需要跟进的客户');
        await act(async () => button('批量管理').click());
        const choice = mobile.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
        await act(async () => choice.click());
        expect(
            host.querySelector<HTMLInputElement>('.admin-desktop-table tbody input[type="checkbox"]')!
                .checked,
        ).toBe(true);
        expect(button('取消选择')).toBeDefined();
        const beforeFilters = location().search;
        await act(async () => button('筛选与排序').click());
        await select(host.querySelector('.admin-mobile-sort select')!, 'emailAddress');
        const groupSelect = [...host.querySelectorAll<HTMLSelectElement>('select')].find(
            item => item.options[0]?.text === '全部客户',
        )!;
        await select(groupSelect, 'group-1');
        expect(location().search).toBe(beforeFilters);
        await act(async () => button('应用', host.querySelector('[role="dialog"]')!).click());
        expect(new URLSearchParams(location().search).get('sort')).toBe('emailAddress');
        expect(new URLSearchParams(location().search).get('page')).toBeNull();
        expect(new URLSearchParams(location().search).get('pageSize')).toBe('50');
        expect(choice.checked).toBe(false);

        expect(new URLSearchParams(location().search).get('group')).toBe('group-1');
        expect(mocks.query.mock.calls.some(([, options]) => options?.variables?.id === 'group-1')).toBe(true);
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
    it.each(['sales', 'customers'] as const)(
        'stages reset and cancel without applying filters on %s',
        async page => {
            await renderPage(page);
            const previous = location().search;
            await act(async () => button('筛选与排序').click());
            await act(async () => button('重置', host.querySelector('[role="dialog"]')!).click());
            expect(location().search).toBe(previous);
            await act(async () => button('取消', host.querySelector('[role="dialog"]')!).click());
            expect(location().search).toBe(previous);
            await act(async () => button('筛选与排序').click());
            await act(async () => button('重置', host.querySelector('[role="dialog"]')!).click());
            await act(async () => button('应用', host.querySelector('[role="dialog"]')!).click());
            expect(location().search).toBe(page === 'sales' ? '?tab=all' : '');
            expect(mocks.mutate).not.toHaveBeenCalled();
        },
    );
    it('preserves customer write and delete permission gates in mobile bulk mode', async () => {
        await renderPage('customers', false);
        await act(async () => button('批量管理').click());
        const choice = host.querySelector<HTMLInputElement>(
            '[aria-label="客户摘要列表"] input[type="checkbox"]',
        )!;
        await act(async () => choice.click());
        for (const label of ['加入分组', '移出分组', '删除所选']) {
            expect(
                [...host.querySelectorAll('button')].some(item => item.textContent?.trim() === label),
            ).toBe(false);
        }
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
});
