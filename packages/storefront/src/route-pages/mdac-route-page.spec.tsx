// @vitest-environment jsdom
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { MdacFlightService } from '../client-plugins/mdac/flight-picker';

import { MdacRoutePage } from './mdac-route-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const runtime = vi.hoisted(() => ({
    language: 'zh',
    market: { code: 'test-store', currencyCode: 'MYR' },
    api: { request: vi.fn() },
    contentQuery: { data: {}, refetch: vi.fn() },
    contentBlocks: [
        {
            enabled: true,
            code: 'storefront-client-plugins',
            type: 'CLIENT_PLUGINS',
            items: [
                {
                    enabled: true,
                    settings: { pluginCode: 'mdac-entry', allowedHost: '', flightLookupEnabled: false },
                },
            ],
        },
    ],
    goBack: vi.fn(),
}));
vi.mock('./shared', () => ({ useRouteRuntime: () => runtime, registerRoutePreload: vi.fn() }));
vi.mock('../page-readiness', () => ({ usePageRouteCommit: vi.fn() }));
vi.mock('../storefront-ui/page-shell', () => ({
    AsyncRouteStatePage: ({ error }: { error: string }) => <p>{error}</p>,
}));
const mdacPage = vi.hoisted(() =>
    vi.fn(({ flightService }: { flightService?: MdacFlightService }) =>
        flightService ? <p>FLIGHT LOOKUP</p> : <p>LOCAL FORM</p>,
    ),
);
vi.mock('../client-plugins/mdac/mdac-page', () => ({ MdacPage: mdacPage }));

it('allows a guest only on the published host; rejects another host or disabled entry', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const item = runtime.contentBlocks[0].items[0];
    const render = async () =>
        act(async () => {
            root.render(
                <Suspense fallback={null}>
                    <MdacRoutePage />
                </Suspense>,
            );
            await vi.dynamicImportSettled();
        });
    try {
        item.settings.allowedHost = window.location.hostname;
        await render();
        expect(host.textContent).toBe('LOCAL FORM');
        item.settings.flightLookupEnabled = true;
        await render();
        expect(host.textContent).toBe('FLIGHT LOOKUP');
        const service = mdacPage.mock.lastCall?.[0].flightService;
        expect(service?.marketKey).toBe('test-store:MYR');
        const input = { arrivalDate: '2026-11-22', arrivalAirport: 'KUL', flightNumber: 'MH123' };
        const signal = new AbortController().signal;
        runtime.api.request.mockResolvedValueOnce({ mdacFlightLookup: { status: 'NO_MATCH', flights: [] } });
        await expect(service?.lookup(input, signal)).resolves.toEqual({ status: 'NO_MATCH', flights: [] });
        expect(runtime.api.request).toHaveBeenCalledWith(
            expect.stringContaining('mdacFlightLookup'),
            input,
            signal,
        );
        item.settings.allowedHost = 'another.example';
        await render();
        expect(host.textContent).toContain('当前店铺尚未开启');
        item.settings.allowedHost = window.location.hostname;
        item.enabled = false;
        await render();
        expect(host.textContent).toContain('当前店铺尚未开启');
    } finally {
        act(() => root.unmount());
        item.enabled = true;
        item.settings.flightLookupEnabled = false;
    }
});
