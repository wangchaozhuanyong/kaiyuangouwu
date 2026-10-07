// @vitest-environment jsdom
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';

const state = vi.hoisted(() => ({
    storefrontUnavailable: true,
    language: 'zh',
    storefrontContextValue: { market: { code: 'fixture', currencyCode: 'CNY' } },
}));
vi.mock('./hooks/useStorefrontAppState', () => ({ useStorefrontAppState: () => state }));
vi.mock('./StorefrontShell', () => ({ StorefrontShell: () => <main>STORE_SHELL</main> }));
vi.mock('./storefront-ui/content-ui', () => ({ HomeDualCategoryShowcase: () => null }));
vi.mock('@tanstack/react-router', async () => {
    const { StorefrontQueryFeedback } = await import('./StorefrontQueryFeedback');
    return {
        lazyRouteComponent: (_loader: unknown, name: string) =>
            name === 'StorefrontQueryFeedback' ? StorefrontQueryFeedback : () => null,
    };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

describe('storefront access feedback ownership', () => {
    it('keeps a failed closed-store recovery inside the closed shell, while open-store network errors retain normal feedback', async () => {
        vi.useFakeTimers();
        const client = createStorefrontQueryClient();
        const key = [...storefrontQueryKeys.config('fixture:CNY', 'zh_Hans'), 'public'];
        client.setQueryData(key, { accessMode: 'PREVIEW' });
        let failed = true;
        function ConfigRead() {
            useQuery({
                queryKey: key,
                staleTime: Infinity,
                retry: false,
                queryFn: () =>
                    failed
                        ? Promise.reject(new Error('Network unavailable'))
                        : Promise.resolve({ accessMode: 'PREVIEW' }),
            });
            return null;
        }
        const container = document.createElement('div');
        const root = createRoot(container);
        const render = () =>
            act(async () => {
                root.render(
                    <QueryClientProvider client={client}>
                        <ConfigRead />
                        <App />
                    </QueryClientProvider>,
                );
                await vi.advanceTimersByTimeAsync(1);
            });
        const refresh = () =>
            act(async () => {
                await client.refetchQueries({ queryKey: key }, { cancelRefetch: false });
                await vi.advanceTimersByTimeAsync(1);
            });
        try {
            state.storefrontUnavailable = true;
            await render();
            await refresh();
            expect(client.getQueryState(key)?.status).toBe('error');
            expect(container.querySelector('[data-query-feedback]')).toBeNull();
            state.storefrontUnavailable = false;
            await render();
            expect(container.querySelector('[data-query-feedback]')?.textContent).toContain('保留上次内容');
            failed = false;
            await refresh();
            expect(container.querySelector('[data-query-feedback]')).toBeNull();
            expect(container.textContent).toContain('STORE_SHELL');
        } finally {
            act(() => root.unmount());
            client.clear();
        }
    });
});
