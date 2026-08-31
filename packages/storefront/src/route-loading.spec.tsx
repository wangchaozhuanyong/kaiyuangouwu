import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
    loadingPageLabel,
    PageSkeleton,
    pageSkeletonVariantForPathname,
    RoutePageSkeleton,
} from './route-loading';

describe('route loading skeletons', () => {
    it('uses a semantic route skeleton for catalog navigation', () => {
        const markup = renderToStaticMarkup(<RoutePageSkeleton pathname="/category" language="zh" />);

        expect(markup).toContain('<main');
        expect(markup).toContain('role="status"');
        expect(markup).toContain('aria-label="正在加载页面"');
        expect(markup).toContain('aria-busy="true"');
        expect(markup).toContain('page-skeleton--catalog');
        expect(markup).toContain('skeleton-catalog-list');
        expect(markup).not.toContain('skeleton-hero');
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
