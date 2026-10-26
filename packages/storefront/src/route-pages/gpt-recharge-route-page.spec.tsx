// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { createStorefrontQueryClient } from '../query-client';

import { GptRechargeRoutePage } from './gpt-recharge-route-page';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const runtime = {
    market: { code: 'fixture', currencyCode: 'CNY' },
    language: 'zh',
    api: { request: vi.fn().mockResolvedValue({ gptRechargeConfig: { enabled: true, maintenance: false } }) },
    displayCurrencyCode: 'CNY',
    collections: [],
    contentBlocks: [],
};
vi.mock('./shared', () => ({ useRouteRuntime: () => runtime, registerRoutePreload: vi.fn() }));
vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
}));

it('keeps the real route redemption draft across language changes and clears it on exit', async () => {
    const cache = createStorefrontQueryClient();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async (visible = true) => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={cache}>
                    <Suspense fallback={null}>{visible && <GptRechargeRoutePage />}</Suspense>
                </QueryClientProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 20));
        });
    };
    try {
        await render();
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        await render();
        const input = host.querySelector<HTMLInputElement>('#gpt-code');
        expect(input).not.toBeNull();
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (!input || !descriptor?.set) throw new Error('Expected redemption input');
        act(() => {
            descriptor.set?.call(input, 'synthetic-draft');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        runtime.language = 'en';
        await render();
        expect(host.querySelector<HTMLInputElement>('#gpt-code')?.value).toBe('synthetic-draft');
        runtime.language = 'zh';
        await render();
        expect(host.querySelector<HTMLInputElement>('#gpt-code')?.value).toBe('synthetic-draft');
        expect(
            runtime.api.request.mock.calls.every(([query]) => query.startsWith('query GptRechargeConfig')),
        ).toBe(true);
        await render(false);
        await render();
        expect(host.querySelector<HTMLInputElement>('#gpt-code')?.value).toBe('');
    } finally {
        act(() => root.unmount());
        cache.clear();
        host.remove();
    }
});
