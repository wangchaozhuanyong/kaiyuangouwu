// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    restore: vi.fn(),
    persist: vi.fn(),
    watch: vi.fn(),
    readInitial: vi.fn(),
    seed: vi.fn(),
    render: vi.fn(),
    installPreview: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    preload: vi.fn().mockResolvedValue(undefined),
    hydrate: vi.fn(),
    diagnostics: vi.fn(),
}));
vi.mock('./query-client', () => ({
    storefrontQueryClient: {},
}));
vi.mock('./query-persistence', () => ({
    restorePublicQueryCache: calls.restore,
    persistPublicQueryCache: calls.persist,
    watchPublicQueryCache: calls.watch,
}));
vi.mock('./router', () => ({
    router: { state: { location: { pathname: '/', search: {} } }, load: calls.load },
}));
vi.mock('./route-component-preload', () => ({ preloadStorefrontRouteComponent: calls.preload }));
vi.mock('./storefront-styles', () => ({}));
vi.mock('./performance-entry', () => {
    calls.diagnostics();
    return {};
});
vi.mock('./storefront-icons', () => ({ restoreStorefrontIcons: vi.fn() }));
vi.mock('./storefront-page-data', () => ({
    readInitialPublicPage: calls.readInitial,
    seedPublicPage: calls.seed,
}));
vi.mock('./StorefrontErrorBoundary', () => ({ StorefrontErrorBoundary: () => null }));
vi.mock('./storefront-preview-runtime', () => ({ installStorefrontPreviewRuntime: calls.installPreview }));
vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render: calls.render }),
    hydrateRoot: calls.hydrate,
}));
const listeners: Array<() => void> = [];
beforeEach(() => {
    const add = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
        if (type === 'storefront:app-owned')
            listeners.push(() => document.removeEventListener(type, listener));
        add(type, listener, options);
    });
});
afterEach(() => {
    listeners.splice(0).forEach(remove => remove());
    document.documentElement.removeAttribute('data-storefront-app-owned');
    vi.restoreAllMocks();
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '';
});

describe('storefront entry persistence boundary', () => {
    it('keeps optional diagnostics off the route download path until ownership', async () => {
        vi.resetModules();
        calls.readInitial.mockReturnValue(undefined);
        document.body.innerHTML = '<div id="root"></div>';
        await import('./main');
        await vi.waitFor(() => expect(calls.render).toHaveBeenCalledOnce());
        window.dispatchEvent(new Event('load'));
        await Promise.resolve();
        expect(calls.diagnostics).not.toHaveBeenCalled();
        document.dispatchEvent(new Event('storefront:app-owned'));
        await vi.waitFor(() => expect(calls.diagnostics).toHaveBeenCalledOnce());
    });
    it('does not hold interactive startup behind optional session cache restoration', async () => {
        vi.resetModules();
        calls.readInitial.mockReturnValue(undefined);
        document.body.innerHTML = '<div id="root"></div>';
        let finish!: () => void;
        calls.restore.mockReturnValueOnce(
            new Promise<void>(done => {
                finish = done;
            }),
        );
        try {
            await import('./main');
            await vi.waitFor(() => expect(calls.render).toHaveBeenCalledOnce());
            expect(calls.load).toHaveBeenCalledOnce();
        } finally {
            finish();
            await Promise.resolve();
        }
    });
    it('retains existing HTML until a client-only route has its first match', async () => {
        vi.resetModules();
        calls.readInitial.mockReturnValue(undefined);
        document.body.innerHTML = '<div id="root"><p>Initial placeholder</p></div>';
        let finish!: () => void;
        calls.load.mockReturnValueOnce(
            new Promise<void>(resolve => {
                finish = resolve;
            }),
        );
        await import('./main');
        expect(calls.render).not.toHaveBeenCalled();
        expect(document.querySelector('#root')?.textContent).toBe('Initial placeholder');
        finish();
        await vi.waitFor(() => expect(calls.render).toHaveBeenCalledOnce());
    });

    it('hands startup route failures to the recovery boundary instead of leaving bootstrap pending', async () => {
        vi.resetModules();
        calls.readInitial.mockReturnValue(undefined);
        document.body.innerHTML = '<div id="root"></div>';
        calls.load.mockRejectedValueOnce(new Error('Route chunk unavailable'));
        await import('./main');
        await vi.waitFor(() => expect(calls.render).toHaveBeenCalledOnce());
        expect(calls.hydrate).not.toHaveBeenCalled();
    });

    it('hydrates the exact rendered snapshot without restoring a newer session tree', async () => {
        vi.resetModules();
        document.body.innerHTML = '<div id="root" data-public-rendered="1"><p>Published content</p></div>';
        calls.readInitial.mockReturnValue({ generatedAt: Date.now() - 35_000 });
        await import('./main');
        await vi.waitFor(() => expect(calls.hydrate).toHaveBeenCalledOnce());
        expect(calls.restore).not.toHaveBeenCalled();
        expect(calls.render).not.toHaveBeenCalled();
        expect(calls.watch).not.toHaveBeenCalled();
        document.dispatchEvent(new Event('storefront:page-ready'));
        await Promise.resolve();
        expect(calls.watch).not.toHaveBeenCalled();
        document.dispatchEvent(new Event('storefront:app-owned'));
        document.dispatchEvent(new Event('storefront:app-owned'));
        await vi.waitFor(() => expect(calls.watch).toHaveBeenCalledOnce());
        expect(calls.watch).toHaveBeenCalledWith({}, undefined, true);
        expect(calls.restore).not.toHaveBeenCalled();
    });
    it('installs persistence once when the first commit signal has already been recorded', async () => {
        vi.resetModules();
        document.body.innerHTML = '<div id="root" data-public-rendered="1">Published content</div>';
        document.documentElement.setAttribute('data-storefront-app-owned', '');
        calls.readInitial.mockReturnValue({ generatedAt: Date.now() });
        await import('./main');
        await vi.waitFor(() => expect(calls.watch).toHaveBeenCalledOnce());
        document.dispatchEvent(new Event('storefront:app-owned'));
        await Promise.resolve();
        expect(calls.watch).toHaveBeenCalledOnce();
        expect(calls.restore).not.toHaveBeenCalled();
    });
    it('never restores, subscribes, or persists embedded preview public data', async () => {
        vi.resetModules();
        window.history.replaceState({}, '', '/?storefrontPreviewEmbedded=1');
        document.body.innerHTML = '<div id="root"></div>';
        await import('./main');
        await vi.waitFor(() => expect(calls.render).toHaveBeenCalled());
        expect(calls.installPreview).toHaveBeenCalledOnce();
        expect(calls.restore).not.toHaveBeenCalled();
        expect(calls.readInitial).not.toHaveBeenCalled();
        expect(calls.watch).not.toHaveBeenCalled();
        expect(calls.persist).not.toHaveBeenCalled();
    });

    it('seeds validated initial data before restoring public caches and registers normal persistence', async () => {
        vi.resetModules();
        document.body.innerHTML = '<div id="root"></div>';
        calls.readInitial.mockReturnValue({ config: { accessMode: 'LIVE' } });
        await import('./main');
        expect(calls.seed).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(calls.restore).toHaveBeenCalledOnce());
        expect(calls.restore.mock.invocationCallOrder[0]).toBeGreaterThan(
            calls.seed.mock.invocationCallOrder[0],
        );
        await vi.waitFor(() => expect(calls.watch).toHaveBeenCalledOnce());
        expect(calls.watch).toHaveBeenCalledWith({}, undefined, false);
    });
});
