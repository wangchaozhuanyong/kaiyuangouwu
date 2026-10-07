// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    restore: vi.fn(),
    persist: vi.fn(),
    watch: vi.fn(),
    readInitial: vi.fn(),
    seed: vi.fn(),
    render: vi.fn(),
    installPreview: vi.fn(),
}));
vi.mock('./query-client', () => ({
    storefrontQueryClient: {},
    restorePublicQueryCache: calls.restore,
    persistPublicQueryCache: calls.persist,
    watchPublicQueryCache: calls.watch,
}));
vi.mock('./router', () => ({ router: {} }));
vi.mock('./storefront-styles', () => ({}));
vi.mock('./storefront-icons', () => ({ restoreStorefrontIcons: vi.fn() }));
vi.mock('./storefront-page-data', () => ({
    readInitialPublicPage: calls.readInitial,
    seedPublicPage: calls.seed,
}));
vi.mock('./StorefrontErrorBoundary', () => ({ StorefrontErrorBoundary: () => null }));
vi.mock('./storefront-preview-runtime', () => ({ installStorefrontPreviewRuntime: calls.installPreview }));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: calls.render }) }));
afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '';
});

describe('storefront entry persistence boundary', () => {
    it('never restores, subscribes, or persists embedded preview public data', async () => {
        vi.resetModules();
        window.history.replaceState({}, '', '/?storefrontPreviewEmbedded=1');
        document.body.innerHTML = '<div id="root"></div>';
        const events = vi.spyOn(window, 'addEventListener');
        await import('./main');
        await vi.waitFor(() => expect(calls.render).toHaveBeenCalled());
        expect(calls.installPreview).toHaveBeenCalledOnce();
        expect(calls.restore).not.toHaveBeenCalled();
        expect(calls.readInitial).not.toHaveBeenCalled();
        expect(calls.watch).not.toHaveBeenCalled();
        expect(events.mock.calls.some(([type]) => type === 'pagehide')).toBe(false);
        expect(calls.persist).not.toHaveBeenCalled();
    });

    it('seeds validated initial data before restoring public caches and registers normal persistence', async () => {
        vi.resetModules();
        document.body.innerHTML = '<div id="root"></div>';
        calls.readInitial.mockReturnValue({ config: { accessMode: 'LIVE' } });
        const events = vi.spyOn(window, 'addEventListener');
        await import('./main');
        expect(calls.seed).toHaveBeenCalledOnce();
        expect(calls.restore.mock.invocationCallOrder[0]).toBeGreaterThan(
            calls.seed.mock.invocationCallOrder[0],
        );
        expect(calls.watch).toHaveBeenCalledOnce();
        const pagehide = events.mock.calls.find(([type]) => type === 'pagehide')?.[1] as
            (() => void) | undefined;
        expect(pagehide).toBeTypeOf('function');
        pagehide?.();
        expect(calls.persist).toHaveBeenCalledOnce();
        if (pagehide) window.removeEventListener('pagehide', pagehide);
    });
});
