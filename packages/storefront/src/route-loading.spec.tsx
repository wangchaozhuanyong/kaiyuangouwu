// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    loadingPageLabel,
    PageSkeleton,
    pageSkeletonVariantForPathname,
    RouteTransitionLoader,
} from './route-loading';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('route loading skeletons', () => {
    it('uses a semantic branded transition without replacing the destination layout', () => {
        const markup = renderToStaticMarkup(
            <RouteTransitionLoader language="zh" storefrontName="MOYAO AI｜模钥" logoUrl="/brand.svg" />,
        );

        expect(markup).toContain('class="route-transition"');
        expect(markup).toContain('role="status"');
        expect(markup).toContain('aria-label="正在加载页面"');
        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain('class="route-transition-card"');
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

    it('renders a visible inline mark before the store configuration is available', async () => {
        await render();
        expect(container.querySelector('svg.route-transition-placeholder')).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(container.innerHTML).not.toContain('/storefront/neutral-store.png');
    });

    it('keeps the mark visible until the downloaded logo has decoded', async () => {
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
        expect(container.querySelector('.route-transition-placeholder')).not.toBeNull();
        expect(container.querySelector('.is-logo-ready')).toBeNull();
        await interact(() => finishDecode());
        expect(container.querySelector('.route-transition-placeholder')).toBeNull();
        expect(container.querySelector('.is-logo-ready')).not.toBeNull();
    });

    it('loads a compact logo and retains the inline fallback after thumbnail and original failures', async () => {
        await render('/assets/preview/brand.png');
        expect(logoImage().src).toContain('preset=storefront-thumbnail-320');
        expect(logoImage().getAttribute('fetchpriority')).toBe('high');
        await interact(() => logoImage().dispatchEvent(new Event('error')));
        expect(logoImage().getAttribute('src')).toBe('/assets/preview/brand.png');
        expect(container.querySelector('.route-transition-placeholder')).not.toBeNull();
        await interact(() => logoImage().dispatchEvent(new Event('error')));
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.route-transition-placeholder')).not.toBeNull();
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
        expect(container.querySelector('.route-transition-placeholder')).not.toBeNull();
    });
});
