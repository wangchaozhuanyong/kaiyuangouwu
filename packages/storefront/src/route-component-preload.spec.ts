import { afterEach, describe, expect, it, vi } from 'vitest';

const imports = vi.hoisted(() => ({
    started: [] as string[],
    routes: Promise.resolve(),
    page: Promise.resolve(),
    home: vi.fn(),
    product: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe('cold public route code loading', () => {
    it.each(['home', 'product'] as const)(
        'starts %s code before its route wrapper has finished, and still prepares the lazy component',
        async route => {
            vi.resetModules();
            imports.started = [];
            let finishRoutes!: () => void;
            let finishPage!: () => void;
            imports.routes = new Promise(resolve => {
                finishRoutes = resolve;
            });
            imports.page = new Promise(resolve => {
                finishPage = resolve;
            });
            vi.doMock('./route-pages/catalog-route-pages', async () => {
                imports.started.push('home-routes');
                await imports.routes;
                return { preloadHomeRoutePage: imports.home };
            });
            vi.doMock('./route-pages/catalog-detail-route-pages', async () => {
                imports.started.push('product-routes');
                await imports.routes;
                return { preloadProductRoutePage: imports.product };
            });
            vi.doMock('./pages/home-page', async () => {
                imports.started.push('home');
                await imports.page;
                return {};
            });
            vi.doMock('./pages/product-detail-page', async () => {
                imports.started.push('product');
                await imports.page;
                return {};
            });
            const { preloadStorefrontRouteComponent } = await import('./route-component-preload');
            const loading = preloadStorefrontRouteComponent(route);
            try {
                await vi.waitFor(() =>
                    expect(imports.started).toEqual(expect.arrayContaining([`${route}-routes`, route])),
                );
                expect(imports.started).not.toContain(route === 'home' ? 'product' : 'home');
                expect(imports.started).not.toContain(route === 'home' ? 'product-routes' : 'home-routes');
                expect(imports[route]).not.toHaveBeenCalled();
            } finally {
                finishPage();
                finishRoutes();
                await loading;
            }
            expect(imports[route]).toHaveBeenCalledOnce();
        },
    );
});
