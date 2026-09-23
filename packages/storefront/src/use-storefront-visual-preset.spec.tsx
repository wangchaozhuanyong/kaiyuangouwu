// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ShopApi } from './api';
import { type MarketConfig } from './types';
import { useStorefrontVisualPreset } from './use-storefront-visual-preset';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalUrl = window.location.href;
afterEach(() => {
    window.history.replaceState(null, '', originalUrl);
    delete document.documentElement.dataset.storefrontPreset;
});

describe('embedded storefront skin', () => {
    it('keeps the selected preview skin after internal navigation removes URL parameters', () => {
        window.history.replaceState(
            null,
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewPreset=modern-oriental',
        );
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const queryClient = new QueryClient();
        const readPublishedSkin = vi.fn();
        const api = { storefrontVisualPreset: readPublishedSkin } as unknown as Pick<
            ShopApi,
            'storefrontVisualPreset'
        >;
        const market = { code: 'test:MYR' } as MarketConfig;
        function Probe() {
            useStorefrontVisualPreset(api, market, 'zh_Hans');
            return null;
        }
        try {
            act(() =>
                root.render(
                    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
                ),
            );
            expect(document.documentElement.dataset.storefrontPreset).toBe('modern-oriental');
            window.history.replaceState(null, '', '/category');
            act(() =>
                root.render(
                    createElement(QueryClientProvider, { client: queryClient }, createElement(Probe)),
                ),
            );
            expect(document.documentElement.dataset.storefrontPreset).toBe('modern-oriental');
            expect(readPublishedSkin).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
            queryClient.clear();
            host.remove();
        }
    });
});
