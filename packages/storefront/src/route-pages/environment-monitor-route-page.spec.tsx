// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { EnvironmentMonitorRoutePage } from './environment-monitor-route-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const runtime = {
    market: { code: 'environment-route-fixture', currencyCode: 'MYR' },
    language: 'zh',
    customer: undefined,
    contentQuery: { data: {}, isError: false, refetch: vi.fn() },
    contentBlocks: [
        {
            enabled: true,
            code: 'storefront-client-plugins',
            type: 'CLIENT_PLUGINS',
            items: [{ enabled: true, settings: { pluginCode: 'environment-monitor-entry' } }],
        },
    ],
    api: { request: vi.fn() },
    goBack: vi.fn(),
};
vi.mock('./shared', () => ({ useRouteRuntime: () => runtime, registerRoutePreload: vi.fn() }));
vi.mock('../api/browser-network-addresses', () => ({
    readBrowserNetworkAddresses: () => Promise.resolve({ ipv4: null, ipv6: null }),
}));
afterEach(() => {
    runtime.market = { code: 'environment-route-fixture', currencyCode: 'MYR' };
    runtime.contentBlocks[0].items[0].enabled = true;
    runtime.api.request.mockReset();
    vi.restoreAllMocks();
});

it('aborts the old request and isolates cached readings when the market currency changes', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const client = new QueryClient();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let signal: AbortSignal | undefined;
    let complete!: (value: unknown) => void;
    runtime.api.request.mockImplementation((_query, _variables, requestSignal) => {
        signal = requestSignal;
        return new Promise(resolve => {
            complete = resolve;
        });
    });
    const render = async () =>
        act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Suspense fallback={null}>
                        <EnvironmentMonitorRoutePage />
                    </Suspense>
                </QueryClientProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    try {
        await render();
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        await render();
        await act(() => {
            requiredValue(
                [...host.querySelectorAll('button')].find(button => button.textContent === '开始检测'),
            ).click();
            return Promise.resolve();
        });
        expect(runtime.api.request).toHaveBeenCalledTimes(1);
        expect(signal?.aborted).toBe(false);
        runtime.market = { ...runtime.market, currencyCode: 'USD' };
        await render();
        expect(signal?.aborted).toBe(true);
        expect(host.querySelector('[role="switch"]')).toBeNull();
        expect(host.querySelector('.environment-gauge-value strong')?.textContent).toBe('—');
        await act(() =>
            Promise.resolve(
                complete({
                    environmentNetworkReport: {
                        provider: 'REQUEST',
                        ip: '198.51.100.24',
                        maskedIp: '198.51.*.*',
                        checkedAt: new Date().toISOString(),
                    },
                }),
            ),
        );
        expect(host.textContent).not.toContain('198.51.100.24');
    } finally {
        act(() => root.unmount());
        client.clear();
        host.remove();
    }
});

it('denies a direct page visit when the published plugin entry is disabled', async () => {
    runtime.contentBlocks[0].items[0].enabled = false;
    const client = new QueryClient();
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
        await act(() => {
            root.render(
                <QueryClientProvider client={client}>
                    <EnvironmentMonitorRoutePage />
                </QueryClientProvider>,
            );
            return Promise.resolve();
        });
        expect(host.textContent).toContain('当前店铺尚未开启环境检测');
        expect(runtime.api.request).not.toHaveBeenCalled();
    } finally {
        act(() => root.unmount());
        client.clear();
    }
});

function requiredValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected a value in environment monitor verification');
    return value;
}
