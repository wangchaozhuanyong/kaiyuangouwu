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
        expect(markup).toContain('value="dialog"');
        expect(markup).toContain('value="guest"');
        expect(markup).toContain('value="authenticated"');
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
});
