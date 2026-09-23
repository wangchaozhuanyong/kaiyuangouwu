// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontDesignPreview } from './storefront-design-preview';
import { storefrontRouteNames } from './storefront-router';

const mocks = vi.hoisted(() => ({ products: vi.fn(), storefrontConfig: vi.fn() }));
vi.mock('./api', () => ({
    ShopApi: class {
        products = mocks.products;
        storefrontConfig = mocks.storefrontConfig;
    },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
});

describe('storefront design preview', () => {
    it('offers all routes, skins, viewport boundaries and review states', () => {
        const markup = renderToStaticMarkup(<StorefrontDesignPreview />);
        for (const route of storefrontRouteNames) expect(markup).toContain(`value="${route}"`);
        expect(markup).toContain('value="classic"');
        expect(markup).toContain('value="modern-oriental"');
        expect(markup).toContain('value="neo-minimalist"');
        expect(markup).toContain('value="1023"');
        expect(markup).toContain('value="1024"');
        expect(markup).toContain('value="1920"');
        expect(markup).toContain('value="2560"');
        expect(markup).toContain('value="dialog"');
        expect(markup).toContain('value="dense"');
        expect(markup).toContain('value="aftercare"');
        expect(markup).toContain('value="guest"');
        expect(markup).toContain('value="authenticated"');
    });

    it('opens populated read-only order and aftercare samples', () => {
        window.history.replaceState({}, '', '/__storefront-preview?route=order-detail&auth=authenticated');
        expect(renderToStaticMarkup(<StorefrontDesignPreview />)).toContain('id=order-1');

        window.history.replaceState(
            {},
            '',
            '/__storefront-preview?route=orders&scenario=aftercare&auth=authenticated',
        );
        expect(renderToStaticMarkup(<StorefrontDesignPreview />)).toContain('tab=service');

        window.history.replaceState(
            {},
            '',
            '/__storefront-preview?route=order-confirmation&scenario=aftercare&auth=authenticated',
        );
        const confirmation = renderToStaticMarkup(<StorefrontDesignPreview />);
        expect(confirmation).toContain('token=local-preview-only');
        expect(confirmation).toContain('id=LOCALQADIGITALORDER20260923NOTAREALORDER');
    });

    it('uses a real in-stock store product instead of a fixed demo id', async () => {
        mocks.storefrontConfig.mockResolvedValue({});
        mocks.products.mockResolvedValue([
            {
                id: 'sold-out',
                variants: [{ stockLevel: 'OUT_OF_STOCK', saleableStockLevel: 0, customFields: {} }],
            },
            {
                id: 'real-42',
                variants: [{ stockLevel: 'IN_STOCK', saleableStockLevel: 12, customFields: {} }],
            },
        ]);
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<StorefrontDesignPreview />);
            await Promise.resolve();
        });
        const routeSelect = host.querySelectorAll('select')[1];
        await act(async () => {
            routeSelect.value = 'product';
            routeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        expect(host.querySelector('iframe')?.src).toContain('id=real-42');
        expect(host.querySelector('iframe')?.src).not.toContain('product-1');
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        host.remove();
    });

    it('reports when the store has no product instead of showing a misleading detail page', async () => {
        mocks.storefrontConfig.mockResolvedValue({});
        mocks.products.mockResolvedValue([]);
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<StorefrontDesignPreview />);
            await Promise.resolve();
        });
        const routeSelect = host.querySelectorAll('select')[1];
        await act(async () => {
            routeSelect.value = 'product';
            routeSelect.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        expect(host.querySelector('iframe')).toBeNull();
        expect(host.querySelector('[role="status"]')?.textContent).toContain('暂无可预览商品');
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        host.remove();
    });

    it('keeps the classic preview frame light even when the store background is dark', async () => {
        mocks.storefrontConfig.mockResolvedValue({ brandBackgroundColor: '#070b14' });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<StorefrontDesignPreview />);
            await Promise.resolve();
        });
        const skinSelect = host.querySelector('select');
        if (!skinSelect) throw new Error('Missing skin select');
        await act(async () => {
            skinSelect.value = 'classic';
            skinSelect.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        expect(host.querySelector('iframe')?.style.backgroundColor).toBe('rgb(241, 245, 249)');
        expect(host.querySelector<HTMLElement>('.storefront-preview-stage')?.style.backgroundColor).toBe(
            'rgb(241, 245, 249)',
        );
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        host.remove();
    });

    it('reloads the current route with the selected skin encoded in one source of truth', async () => {
        mocks.storefrontConfig.mockResolvedValue({});
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<StorefrontDesignPreview />);
            await Promise.resolve();
        });
        const skinSelect = host.querySelector('select');
        const frame = host.querySelector('iframe');
        if (!skinSelect || !frame) throw new Error('Missing preview controls');
        const initialSource = frame.getAttribute('src');

        await act(async () => {
            skinSelect.value = 'modern-oriental';
            skinSelect.dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });

        expect(frame.getAttribute('src')).not.toBe(initialSource);
        expect(frame.getAttribute('src')).toContain('storefrontPreviewPreset=modern-oriental');
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        host.remove();
    });

    it('keeps the route selector synchronized with navigation inside the real client frame', async () => {
        mocks.storefrontConfig.mockResolvedValue({});
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<StorefrontDesignPreview />);
            await Promise.resolve();
        });
        const frame = host.querySelector('iframe');
        const routeSelect = host.querySelectorAll('select')[1];
        if (!frame?.contentWindow) throw new Error('Missing preview frame');
        const initialSource = frame.src;
        const session = new URL(frame.src).searchParams.get('storefrontPreviewSession');
        if (!session) throw new Error('Missing preview session');

        await act(async () => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: { type: 'storefront-preview-ready', session },
                    origin: window.location.origin,
                }),
            );
            await Promise.resolve();
        });
        await act(async () => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    data: { type: 'storefront-preview-route', route: 'category', session },
                    origin: window.location.origin,
                }),
            );
            await Promise.resolve();
        });

        expect(routeSelect.value).toBe('category');
        expect(host.querySelector('iframe')?.src).toBe(initialSource);
        expect(new URLSearchParams(window.location.search).get('route')).toBe('category');
        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        host.remove();
    });

    it('keeps the shareable preview URL aligned with every selected control', async () => {
        mocks.storefrontConfig.mockResolvedValue({});
        window.history.replaceState(
            {},
            '',
            '/__storefront-preview?preset=modern-oriental&route=services&viewport=1440&scenario=disabled&auth=authenticated&language=en',
        );
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        await act(async () => {
            root.render(<StorefrontDesignPreview />);
            await Promise.resolve();
        });

        const selects = host.querySelectorAll('select');
        expect(selects[0].value).toBe('modern-oriental');
        expect(selects[1].value).toBe('services');
        expect(selects[2].value).toBe('disabled');
        expect(selects[3].value).toBe('authenticated');
        expect(selects[4].value).toBe('1440');
        expect(host.querySelector('iframe')?.title).toBe('modern-oriental services 1440');

        await act(async () => {
            selects[0].value = 'neo-minimalist';
            selects[0].dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        expect(new URLSearchParams(window.location.search).get('preset')).toBe('neo-minimalist');
        await act(async () => {
            selects[1].value = 'category';
            selects[1].dispatchEvent(new Event('change', { bubbles: true }));
            await Promise.resolve();
        });
        expect(new URLSearchParams(window.location.search).get('preset')).toBe('neo-minimalist');
        expect(new URLSearchParams(window.location.search).get('route')).toBe('category');

        await act(async () => {
            root.unmount();
            await Promise.resolve();
        });
        host.remove();
    });
});
