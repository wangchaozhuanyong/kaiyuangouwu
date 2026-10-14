// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publicPageRequestKey } from '../../storefront-content-plugin/src/shared/public-page-data';

const calls = vi.hoisted(() => ({ applyBrand: vi.fn(), startRead: vi.fn() }));
vi.mock('./brand-loading-bootstrap', async importOriginal => ({
    ...(await importOriginal<typeof import('./brand-loading-bootstrap')>()),
    applyInitialLoadingBrand: calls.applyBrand,
}));
vi.mock('./public-page-transport', () => ({ startPublicPageBootstrap: calls.startRead }));

function appendSnapshot(host = location.host) {
    const payload = document.createElement('script');
    payload.id = 'storefront-public-page-data';
    payload.type = 'application/json';
    payload.textContent = JSON.stringify({
        schemaVersion: 1,
        generatedAt: Date.now(),
        requestKey: publicPageRequestKey({ kind: 'home' }),
        scope: {
            host,
            channelCode: 'current-store',
            languageCode: 'en',
            currencyCode: 'MYR',
            priceContext: 'public',
        },
        config: {
            code: 'current-store',
            accessMode: 'LIVE',
            logoUrl: '/assets/preview/current-store.png',
            customFields: { storefrontNameEn: 'Current store' },
            availableCountries: [],
        },
        media: [],
        failures: [],
    });
    document.body.append(payload);
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/en/');
    document.body.replaceChildren();
});
afterEach(() => {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    vi.restoreAllMocks();
    document.body.replaceChildren();
    window.history.replaceState({}, '', '/');
});

describe('early public page bootstrap', () => {
    it('brands at parser completion while the main module still delays DOMContentLoaded', async () => {
        const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        await import('./public-page-bootstrap');
        appendSnapshot();
        document.dispatchEvent(new Event('readystatechange'));
        expect(calls.applyBrand).not.toHaveBeenCalled();
        state.mockReturnValue('interactive');
        document.dispatchEvent(new Event('readystatechange'));
        expect(calls.applyBrand).toHaveBeenCalledOnce();
        expect(calls.startRead).not.toHaveBeenCalled();

        document.dispatchEvent(new Event('DOMContentLoaded'));
        state.mockReturnValue('complete');
        document.dispatchEvent(new Event('readystatechange'));
        expect(calls.applyBrand).toHaveBeenCalledOnce();
        expect(calls.startRead).not.toHaveBeenCalled();
    });

    it('waits for the trailing SSR payload and brands it without a duplicate public request', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        document.body.innerHTML = '<div id="root" data-public-rendered="1">Published content</div>';
        await import('./public-page-bootstrap');
        expect(calls.startRead).not.toHaveBeenCalled();
        expect(calls.applyBrand).not.toHaveBeenCalled();

        appendSnapshot();
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(calls.applyBrand).toHaveBeenCalledWith({
            language: 'en',
            storefrontName: 'Current store',
            secondaryName: '',
            logoUrl: '/assets/preview/current-store.png',
        });
        expect(calls.startRead).not.toHaveBeenCalled();
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(calls.applyBrand).toHaveBeenCalledOnce();
    });

    it('uses a completed public document immediately without fetching its data again', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
        appendSnapshot();
        await import('./public-page-bootstrap');
        expect(calls.applyBrand).toHaveBeenCalledOnce();
        expect(calls.startRead).not.toHaveBeenCalled();
    });

    it('does not overwrite current React branding when the async entry arrives after SSR adoption', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
        document.body.innerHTML = `
            <main id="storefront-boot-loading"><strong>Updated store</strong></main>
            <div id="root" data-public-rendered="1" data-public-adopted="1"></div>`;
        appendSnapshot();
        await import('./public-page-bootstrap');
        expect(calls.applyBrand).not.toHaveBeenCalled();
        expect(calls.startRead).not.toHaveBeenCalled();
        expect(document.getElementById('storefront-boot-loading')?.textContent).toBe('Updated store');
    });

    it('does not start another read after a client-only document has finished its startup handoff', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        await import('./public-page-bootstrap');
        document.body.innerHTML = `
            <main id="storefront-boot-loading" aria-hidden="true"></main><div id="root"></div>`;
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(calls.applyBrand).not.toHaveBeenCalled();
        expect(calls.startRead).not.toHaveBeenCalled();
    });

    it('can still brand a startup failure before React has taken over', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
        document.body.innerHTML = `
            <main id="storefront-boot-loading" aria-busy="false"></main><div id="root"></div>`;
        appendSnapshot();
        await import('./public-page-bootstrap');
        expect(calls.applyBrand).toHaveBeenCalledOnce();
        expect(calls.startRead).not.toHaveBeenCalled();
    });

    it('keeps the existing single public read when a client-only document has no snapshot', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        await import('./public-page-bootstrap');
        expect(calls.startRead).not.toHaveBeenCalled();
        document.dispatchEvent(new Event('DOMContentLoaded'));
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(calls.startRead).toHaveBeenCalledExactlyOnceWith({ kind: 'home' }, 'en', undefined);
        expect(calls.applyBrand).not.toHaveBeenCalled();
    });

    it('never adopts another host branding from the trailing payload', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
        appendSnapshot('other-store.test');
        await import('./public-page-bootstrap');
        expect(calls.applyBrand).not.toHaveBeenCalled();
        expect(calls.startRead).toHaveBeenCalledOnce();
    });

    it('leaves embedded previews to their own runtime after parsing', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        window.history.replaceState({}, '', '/en/?storefrontPreviewEmbedded=1');
        await import('./public-page-bootstrap');
        appendSnapshot();
        document.dispatchEvent(new Event('DOMContentLoaded'));
        expect(calls.applyBrand).not.toHaveBeenCalled();
        expect(calls.startRead).not.toHaveBeenCalled();
    });
});
