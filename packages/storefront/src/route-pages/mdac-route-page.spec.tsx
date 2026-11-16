// @vitest-environment jsdom
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { MdacRoutePage } from './mdac-route-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const runtime = vi.hoisted(() => ({
    language: 'zh',
    contentQuery: { data: {}, refetch: vi.fn() },
    contentBlocks: [
        {
            enabled: true,
            code: 'storefront-client-plugins',
            type: 'CLIENT_PLUGINS',
            items: [{ enabled: true, settings: { pluginCode: 'mdac-entry', allowedHost: '' } }],
        },
    ],
    goBack: vi.fn(),
}));
vi.mock('./shared', () => ({ useRouteRuntime: () => runtime, registerRoutePreload: vi.fn() }));
vi.mock('../page-readiness', () => ({ usePageRouteCommit: vi.fn() }));
vi.mock('../storefront-ui/page-shell', () => ({
    AsyncRouteStatePage: ({ error }: { error: string }) => <p>{error}</p>,
}));
vi.mock('../client-plugins/mdac/mdac-page', () => ({ MdacPage: () => <p>LOCAL FORM</p> }));

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
    }
});
