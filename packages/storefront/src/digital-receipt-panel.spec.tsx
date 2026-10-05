// @vitest-environment jsdom
import type { MarketConfig, Order } from './types';
import { QueryClientProvider } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { DigitalReceiptPanel, type DigitalReceiptStatus } from './digital-receipt-panel';
import {
    createStorefrontQueryClient,
    persistPublicQueryCache,
    refreshStorefrontQueries,
} from './query-client';
const market: MarketConfig = {
    code: 'fixture',
    currencyCode: 'CNY',
    defaultLanguageCode: 'zh_Hans',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: 'Fixture',
};
const order = {
    id: 'order-1',
    customer: { id: 'customer-1' },
    lines: [{ id: 'line-1', productVariant: { name: 'Synthetic digital item' } }],
} as Order;
const ready: DigitalReceiptStatus = {
    orderLineId: 'line-1',
    mode: 'manual_service',
    state: 'READY',
    eligibleQuantity: 2,
    readyQuantity: 2,
    claimedQuantity: 0,
    notificationState: 'EMAIL_FAILED',
};
const content = {
    ...ready,
    claimedQuantity: 2,
    packages: [
        {
            number: 1,
            note: 'dummy-private-note',
            fields: [{ label: 'dummy', value: 'dummy-private-content' }],
            attachments: [],
        },
    ],
};
const disposers: Array<() => void> = [];
afterEach(() => disposers.splice(0).forEach(dispose => dispose()));
async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
    });
}
async function mount(api: any) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const client = createStorefrontQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async (props: any = {}) => {
        await act(() =>
            Promise.resolve(
                root.render(
                    <QueryClientProvider client={client}>
                        <DigitalReceiptPanel
                            api={api}
                            market={market}
                            order={order}
                            language="zh"
                            {...props}
                        />
                    </QueryClientProvider>,
                ),
            ),
        );
        await settle();
    };
    disposers.push(() => {
        act(() => root.unmount());
        host.remove();
        client.clear();
    });
    await render();
    return { host, client, render };
}
async function click(host: HTMLElement, text: string) {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === text);
    expect(button).toBeDefined();
    await act(() => Promise.resolve(requireFixture(button).click()));
    await settle();
}
describe('Digital receipt explicit claim', () => {
    it('does not offer an unavailable delivery because an earlier notification failed', async () => {
        const api = {
            digitalDeliveryStatuses: vi
                .fn()
                .mockResolvedValue([
                    { ...ready, state: 'UNAVAILABLE', readyQuantity: 0, eligibleQuantity: 0 },
                ]),
            claimDigitalDelivery: vi.fn(),
        };
        const { host } = await mount(api);
        expect(host.textContent).toContain('领取资格以当前状态为准');
        expect(host.textContent).not.toContain('您仍可在这里领取');
        expect([...host.querySelectorAll('button')].some(button => button.textContent === '领取内容')).toBe(
            false,
        );
        expect(api.claimDigitalDelivery).not.toHaveBeenCalled();
    });
    it('reads metadata only, accepts failed email, and keeps claimed secrets out of query/session caches', async () => {
        const api = {
            digitalDeliveryStatuses: vi.fn().mockResolvedValue([ready]),
            claimDigitalDelivery: vi.fn().mockResolvedValue(content),
        };
        const { host, client } = await mount(api);
        expect(api.claimDigitalDelivery).not.toHaveBeenCalled();
        expect(host.textContent).toContain('通知邮件发送失败');
        expect(host.textContent).not.toContain('dummy-private');
        await click(host, '领取内容');
        expect(api.claimDigitalDelivery).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain('dummy-private-content');
        expect(
            JSON.stringify(
                client
                    .getQueryCache()
                    .getAll()
                    .map(query => query.state.data),
            ),
        ).not.toContain('dummy-private');
        let persisted = '';
        persistPublicQueryCache(client, {
            setItem: (_key, value) => {
                persisted = value;
            },
        });
        expect(persisted).not.toContain('digital-delivery-status');
    });
    it('preserves a successful claim when the later metadata refresh fails', async () => {
        const api = {
            digitalDeliveryStatuses: vi
                .fn()
                .mockResolvedValueOnce([ready])
                .mockRejectedValue(new Error('synthetic refresh failure')),
            claimDigitalDelivery: vi.fn().mockResolvedValue(content),
        };
        const { host } = await mount(api);
        await click(host, '领取内容');
        expect(host.textContent).toContain('已领取，内容显示在下方');
        expect(host.textContent).toContain('dummy-private-content');
        expect(host.querySelector('[role=alert]')).toBeNull();
        expect(api.claimDigitalDelivery).toHaveBeenCalledTimes(1);
    });
    it('does not claim again on status retries and displays successful empty reads', async () => {
        const api = {
            digitalDeliveryStatuses: vi
                .fn()
                .mockRejectedValueOnce(new Error('synthetic read failure'))
                .mockResolvedValue([]),
            claimDigitalDelivery: vi.fn(),
        };
        const { host } = await mount(api);
        await click(host, '重试读取状态');
        expect(host.textContent).toContain('暂无数字交付记录');
        expect(api.claimDigitalDelivery).not.toHaveBeenCalled();
    });
    it('clears local content across proof scopes and ignores a late claim after switching', async () => {
        let release!: (value: typeof content) => void;
        const api = {
            digitalDeliveryStatuses: vi.fn().mockResolvedValue([ready]),
            claimDigitalDelivery: vi.fn().mockImplementation(
                () =>
                    new Promise(resolve => {
                        release = resolve;
                    }),
            ),
        };
        const { host, render, client } = await mount(api);
        await click(host, '领取内容');
        await render({ confirmationToken: 'dummy-new-proof' });
        await act(() => Promise.resolve(release(content)));
        await settle();
        expect(host.textContent).not.toContain('dummy-private');
        expect(
            JSON.stringify(
                client
                    .getQueryCache()
                    .getAll()
                    .map(query => query.queryKey),
            ),
        ).not.toContain('dummy-new-proof');
        expect(api.digitalDeliveryStatuses).toHaveBeenLastCalledWith(
            'order-1',
            'dummy-new-proof',
            expect.any(AbortSignal),
        );
    });
    it('hides existing content on revocation and preserves historic claimed quantity', async () => {
        const api = {
            digitalDeliveryStatuses: vi.fn().mockResolvedValue([ready]),
            claimDigitalDelivery: vi.fn().mockResolvedValue(content),
        };
        const { host, client } = await mount(api);
        await click(host, '领取内容');
        api.digitalDeliveryStatuses.mockResolvedValue([
            { ...ready, state: 'UNAVAILABLE', eligibleQuantity: 0, readyQuantity: 0, claimedQuantity: 2 },
        ]);
        await act(async () => {
            await refreshStorefrontQueries(client, {
                marketCode: 'fixture:CNY',
                languageCode: 'zh_Hans',
                includePrivate: true,
            });
        });
        await settle();
        expect(host.textContent).toContain('已领取 2 份');
        expect(host.textContent).toContain('资格已暂停或停止');
        expect(host.textContent).not.toContain('dummy-private');
    });
    it('shows partial new-content claim and joins double clicks on a pending write', async () => {
        let release!: (value: typeof content) => void;
        const api = {
            digitalDeliveryStatuses: vi.fn().mockResolvedValue([{ ...ready, claimedQuantity: 1 }]),
            claimDigitalDelivery: vi.fn().mockImplementation(
                () =>
                    new Promise(resolve => {
                        release = resolve;
                    }),
            ),
        };
        const { host } = await mount(api);
        const button = requireFixture(
            [...host.querySelectorAll('button')].find(item => item.textContent === '领取新增内容'),
        );
        await act(() => {
            return Promise.resolve().then(() => {
                button.click();
                button.click();
            });
        });
        expect(api.claimDigitalDelivery).toHaveBeenCalledTimes(1);
        await act(() => Promise.resolve(release(content)));
        await settle();
    });
    it('ShopApi status selection omits content and forwards cancellation, while only claim requests secrets', async () => {
        const api = new ShopApi(market);
        const request = vi.spyOn(api as any, 'request');
        const signal = new AbortController().signal;
        request.mockResolvedValueOnce({
            myDigitalDeliveryContents: [{ ...ready, packages: content.packages }],
        });
        const statuses = await api.digitalDeliveryStatuses('order-1', 'dummy-proof', signal);
        expect(statuses[0]).not.toHaveProperty('packages');
        expect(request.mock.calls[0][0]).not.toMatch(/instructions|downloadUrl|packages/);
        expect(request.mock.calls[0][2]).toBe(signal);
        request.mockResolvedValueOnce({ claimDigitalDelivery: content });
        await api.claimDigitalDelivery('order-1', 'line-1', 'dummy-proof');
        expect(request.mock.calls[1][0]).toContain('mutation');
        expect(request.mock.calls[1][0]).toContain('packages');
    });
});

function requireFixture<T>(value: T | null | undefined): T {
    assert(value !== null && value !== undefined, 'Required synthetic fixture is missing');
    return value;
}
// organize-imports-ignore -- Preserve ESLint grouping of type-only imports.
