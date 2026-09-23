// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installStorefrontPreviewRuntime } from './storefront-preview-runtime';

const nativeFetch = window.fetch.bind(window);

afterEach(() => {
    window.fetch = nativeFetch;
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
});

describe('storefront preview runtime', () => {
    it('serves the selected read-only fixture without contacting the local Shop API', async () => {
        const fallbackFetch = vi.fn(() => Promise.resolve(new Response('external')));
        window.fetch = fallbackFetch;
        window.history.replaceState(
            {},
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewPreset=neo-minimalist&storefrontPreviewAuth=guest',
        );

        installStorefrontPreviewRuntime();
        const response = await window.fetch('/shop-api', { method: 'POST' });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.data.storefrontVisualPreset.presetId).toBe('neo-minimalist');
        expect(payload.data.activeCustomer).toBeNull();
        expect(fallbackFetch).not.toHaveBeenCalled();
    });

    it('does not intercept non-preview pages or unrelated requests', async () => {
        const fallbackFetch = vi.fn(() => Promise.resolve(new Response('external')));
        window.fetch = fallbackFetch;
        window.history.replaceState({}, '', '/');

        installStorefrontPreviewRuntime();
        await window.fetch('/shop-api', { method: 'POST' });

        expect(fallbackFetch).toHaveBeenCalledOnce();
    });
});
