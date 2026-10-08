// organize-imports-ignore
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    loadingPageLabel,
    PageSkeleton,
    pageSkeletonVariantForPathname,
    RouteTransitionLoader,
} from './route-loading';
import { StorefrontContext, type StorefrontContextValue } from './StorefrontContext';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
        root.render(<PageSkeleton />);
        await vi.dynamicImportSettled();
    });
    act(() => root.unmount());
});

describe('route loading skeletons', () => {
    it('uses a semantic branded transition without replacing the destination layout', () => {
        const markup = renderToStaticMarkup(
            <RouteTransitionLoader language="zh" storefrontName="MOYAO AI｜模钥" logoUrl="/brand.svg" />,
        );

        expect(markup).toContain('class="route-transition"');
        expect(markup).toContain('role="status"');
        expect(markup).toContain('aria-label="正在加载页面"');
        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain('class="brand-loading"');
        expect(markup).not.toContain('route-transition-card');
        expect(markup).not.toContain('route-transition-track');
        expect(markup).toContain('src="/brand.svg"');
        expect(markup).toContain('MOYAO AI｜模钥');
        expect(markup).not.toContain('page-skeleton--route');
    });

    it('keeps inline skeletons as divs to avoid nested main landmarks', () => {
        const markup = renderToStaticMarkup(<PageSkeleton label="Loading product" />);

        expect(markup).toContain('<div');
        expect(markup).not.toContain('<main');
        expect(markup).toContain('page-skeleton--default');
    });

    it('brands every store from its current provider without showing generic loading copy', () => {
        for (const name of ['闪铸商城', '大马通', 'MOYAO AI']) {
            const markup = renderToStaticMarkup(
                <StorefrontContext.Provider
                    value={
                        {
                            logoUrl: '/current-brand.svg',
                            storefrontName: name,
                            language: 'zh',
                        } as StorefrontContextValue
                    }
                >
                    <PageSkeleton language="zh" root />
                </StorefrontContext.Provider>,
            );
            expect(markup).toContain('src="/current-brand.svg"');
            expect(markup).toContain(name);
            expect(markup).toContain('data-page-pending="data"');
            expect(markup).toContain('aria-label="正在加载页面"');
            expect(markup).not.toContain('page-loading-spinner');
            expect(markup).not.toContain('>正在加载页面<');
        }
    });

    it('keeps local coupon and product reads quiet without repeating the page brand', () => {
        const markup = renderToStaticMarkup(<PageSkeleton compact label="正在加载优惠活动" />);
        expect(markup).toContain('page-skeleton--compact');
        expect(markup).not.toContain('route-transition-mark');
        expect(markup).not.toContain('page-loading-spinner');
        expect(markup).toContain('>正在加载优惠活动<');
    });

    it('maps storefront paths to stable layout variants', () => {
        expect(pageSkeletonVariantForPathname('/')).toBe('home');
        expect(pageSkeletonVariantForPathname('/category')).toBe('catalog');
        expect(pageSkeletonVariantForPathname('/search?q=lamp')).toBe('catalog');
        expect(pageSkeletonVariantForPathname('/product/lamp')).toBe('detail');
        expect(pageSkeletonVariantForPathname('/services')).toBe('services');
        expect(pageSkeletonVariantForPathname('/account')).toBe('account');
        expect(pageSkeletonVariantForPathname('/checkout')).toBe('checkout');
        expect(pageSkeletonVariantForPathname('/unknown')).toBe('default');
    });

    it('localizes loading labels', () => {
        expect(loadingPageLabel('zh')).toBe('正在加载页面');
        expect(loadingPageLabel('en')).toBe('Loading page');
    });
});

describe('transition logo loading', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    beforeEach(() => {
        container = document.createElement('div');
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        vi.restoreAllMocks();
    });
    async function interact(action: () => void) {
        await act(async () => {
            action();
            await Promise.resolve();
        });
    }
    async function render(logoUrl?: string) {
        await interact(() => root.render(<RouteTransitionLoader logoUrl={logoUrl} language="zh" />));
    }
    function logoImage(): HTMLImageElement {
        const image = container.querySelector('img');
        if (!image) throw new Error('Missing transition logo image');
        return image;
    }

    it('keeps a quiet pending state without inventing a brand before configuration arrives', async () => {
        await render();
        expect(container.querySelector('svg')).toBeNull();
        expect(container.querySelector('.brand-loading-dots')).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(container.innerHTML).not.toContain('/storefront/neutral-store.png');
    });

    it('clears the previous logo when the next store has no configured logo', async () => {
        await interact(() =>
            root.render(
                <StorefrontContext.Provider
                    value={
                        {
                            logoUrl: '/first-store.svg',
                            storefrontName: 'First store',
                        } as StorefrontContextValue
                    }
                >
                    <PageSkeleton />
                </StorefrontContext.Provider>,
            ),
        );
        expect(logoImage().getAttribute('src')).toBe('/first-store.svg');
        await interact(() =>
            root.render(
                <StorefrontContext.Provider
                    value={{ logoUrl: null, storefrontName: 'Second store' } as StorefrontContextValue}
                >
                    <PageSkeleton />
                </StorefrontContext.Provider>,
            ),
        );
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('Second store');
        expect(container.textContent).not.toContain('First store');
    });

    it('reserves logo space until decoding completes without flashing a generic shop icon', async () => {
        await render('/brand.svg');
        const image = logoImage();
        let finishDecode: () => void = () => undefined;
        const decoding = new Promise<void>(resolve => {
            finishDecode = resolve;
        });
        Object.defineProperties(image, {
            naturalWidth: { value: 160 },
            decode: { value: () => decoding },
        });
        await interact(() => image.dispatchEvent(new Event('load')));
        expect(container.querySelector('.route-transition-placeholder')).toBeNull();
        expect(container.querySelector('.is-logo-ready')).toBeNull();
        await interact(() => finishDecode());
        expect(container.querySelector('.route-transition-placeholder')).toBeNull();
        expect(container.querySelector('.is-logo-ready')).not.toBeNull();
    });

    it('tries the original logo once and retains the store name after image failures', async () => {
        await interact(() =>
            root.render(
                <RouteTransitionLoader
                    logoUrl="/assets/preview/brand.png"
                    storefrontName="当前店铺"
                    language="zh"
                />,
            ),
        );
        expect(logoImage().src).toContain('preset=storefront-thumbnail-320');
        expect(logoImage().getAttribute('fetchpriority')).toBe('high');
        await interact(() => logoImage().dispatchEvent(new Event('error')));
        expect(logoImage().getAttribute('src')).toBe('/assets/preview/brand.png');
        expect(container.querySelector('.route-transition-placeholder')).toBeNull();
        await interact(() => logoImage().dispatchEvent(new Event('error')));
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain('当前店铺');
        expect(container.querySelector('.brand-loading-dots')).not.toBeNull();
        expect(container.querySelector('.route-transition-placeholder')).toBeNull();
    });

    it('recognizes a cached logo even when its load event has already fired', async () => {
        vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
        vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(160);
        await render('/cached-logo.svg');
        expect(container.querySelector('.is-logo-ready')).not.toBeNull();
        expect(container.querySelector('.route-transition-placeholder')).toBeNull();
    });

    it('does not reveal a previous store logo when its decode finishes after the source changes', async () => {
        await render('/first-logo.svg');
        const firstImage = logoImage();
        let finishDecode: () => void = () => undefined;
        const decoding = new Promise<void>(resolve => {
            finishDecode = resolve;
        });
        Object.defineProperties(firstImage, {
            naturalWidth: { value: 160 },
            decode: { value: () => decoding },
        });
        await interact(() => firstImage.dispatchEvent(new Event('load')));
        await render('/second-logo.svg');
        await interact(() => finishDecode());
        expect(logoImage().getAttribute('src')).toBe('/second-logo.svg');
        expect(container.querySelector('.is-logo-ready')).toBeNull();
        expect(container.querySelector('.route-transition-placeholder')).toBeNull();
    });
});
