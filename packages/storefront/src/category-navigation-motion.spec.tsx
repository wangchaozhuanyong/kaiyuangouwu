// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CATEGORY_SCROLL_DURATION_MS } from './category-navigation';
import { CategoryPage, type CategoryPageProps } from './pages/category-page';
import { CategoryPageContext } from './storefront-page-contexts';

vi.mock('@tanstack/react-router', async original => ({
    ...(await original<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
}));
vi.mock('./hooks/useCategoryPagination', () => ({
    useCategoryPagination: () => ({
        query: { isLoading: false, isSuccess: true, isPlaceholderData: false, data: {} },
        products: [],
        totalItems: 0,
        resultsRef: { current: null },
        sentinelRef: { current: null },
    }),
}));

describe('category clicks move the actual navigation rail', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let props: CategoryPageProps;
    let rail: HTMLElement;
    let now: number;
    let nextFrame: number;
    let reducedMotion: boolean;
    const frames = new Map<number, FrameRequestCallback>();
    const pageScroll = vi.fn();
    const railScroll = vi.fn((options?: ScrollToOptions | number) => {
        if (typeof options === 'object') rail.scrollLeft = options.left ?? rail.scrollLeft;
    });

    function render() {
        act(() => {
            root.render(
                <CategoryPageContext.Provider value={{ ...props }}>
                    <CategoryPage />
                </CategoryPageContext.Provider>,
            );
        });
    }
    function frame(elapsed = 16) {
        now += elapsed;
        const pending = [...frames];
        frames.clear();
        act(() => pending.forEach(([, callback]) => callback(now)));
    }
    function click(index: number, expanded = false) {
        const selector = expanded ? '.all-primary-category-grid button' : '.primary-categories button';
        const button = host.querySelectorAll<HTMLButtonElement>(selector)[index];
        if (!button) throw new Error(`Missing category button at index ${index}`);
        act(() => button.click());
    }

    beforeEach(() => {
        now = 0;
        nextFrame = 0;
        reducedMotion = false;
        frames.clear();
        pageScroll.mockClear();
        railScroll.mockClear();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
        vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        vi.spyOn(window, 'scrollTo').mockImplementation(pageScroll);
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(284);
        vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(656);
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(76);
        vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
            return this.parentElement ? [...this.parentElement.children].indexOf(this) * 80 : 0;
        });
        props = {
            api: {} as CategoryPageProps['api'],
            products: [],
            collections: Array.from({ length: 8 }, (_, index) => ({
                id: `category-${index + 1}`,
                name: `分类${index + 1}`,
                slug: `category-${index + 1}`,
                description: '',
                position: index,
                parentId: 'root',
                featuredAsset: null,
                children: [],
            })),
            contentBlocks: [],
            loading: false,
            error: null,
            market: {
                code: 'test-store',
                defaultLanguageCode: 'zh_Hans',
                currencyCode: 'MYR',
                countryCode: 'MY',
                locale: 'zh-CN',
                label: 'Test store',
            },
            locale: 'zh-CN',
            language: 'zh',
            activeCollectionId: 'category-3',
            activeChildId: 'category-3',
            sortMode: 'recommended',
            fulfillmentFilter: 'all',
            inStockOnly: false,
            minimumPrice: '',
            maximumPrice: '',
            onCollectionChange: (collectionId, childId) => {
                props.activeCollectionId = collectionId;
                props.activeChildId = childId;
                render();
            },
            onChildChange: vi.fn(),
            onSortChange: vi.fn(),
            onFilterChange: vi.fn(),
            onNotify: vi.fn(),
            onRetry: vi.fn(),
        };
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        render();
        const primaryRail = host.querySelector<HTMLElement>('.primary-categories');
        if (!primaryRail) throw new Error('Missing primary category rail');
        rail = primaryRail;
        rail.scrollTo = railScroll;
        rail.style.setProperty('scroll-snap-type', 'x proximity', 'important');
        rail.style.setProperty('scroll-behavior', 'smooth');
    });
    afterEach(() => {
        act(() => root.unmount());
        expect(frames.size).toBe(0);
        expect(rail.style.getPropertyValue('scroll-snap-type')).toBe('x proximity');
        expect(rail.style.getPropertyPriority('scroll-snap-type')).toBe('important');
        expect(rail.style.getPropertyValue('scroll-behavior')).toBe('smooth');
        host.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('positions the initial route instantly, then makes a click visibly progress before reaching the target', () => {
        frame();
        expect(rail.scrollLeft).toBe(56);
        expect(frames.size).toBe(0);
        rail.scrollTop = 41;
        click(4);
        frame();
        expect(rail.style.getPropertyValue('scroll-snap-type')).toBe('none');
        frame(CATEGORY_SCROLL_DURATION_MS / 2);
        expect(rail.scrollLeft).toBeGreaterThan(56);
        expect(rail.scrollLeft).toBeLessThan(216);
        frame(CATEGORY_SCROLL_DURATION_MS / 2);
        expect(rail.scrollLeft).toBe(216);
        expect(railScroll).toHaveBeenCalledOnce();
        expect(rail.scrollTop).toBe(41);
        expect(pageScroll).not.toHaveBeenCalled();
    });

    it('retargets rapid clicks from the current offset and lets pointer, touch and wheel input interrupt', () => {
        frame();
        click(4);
        frame();
        frame(CATEGORY_SCROLL_DURATION_MS / 2);
        const midpoint = rail.scrollLeft;
        click(7);
        frame();
        expect(rail.scrollLeft).toBe(midpoint);
        frame(CATEGORY_SCROLL_DURATION_MS);
        expect(rail.scrollLeft).toBe(372);
        for (const eventName of ['pointerdown', 'touchstart', 'wheel']) {
            click(0);
            frame();
            frame(CATEGORY_SCROLL_DURATION_MS / 4);
            act(() => {
                rail.dispatchEvent(new Event(eventName, { bubbles: true }));
            });
            rail.scrollLeft = 180;
            frame(CATEGORY_SCROLL_DURATION_MS);
            expect(rail.scrollLeft).toBe(180);
            expect(rail.style.getPropertyValue('scroll-snap-type')).toBe('x proximity');
        }
        expect(pageScroll).not.toHaveBeenCalled();
    });

    it('centers a selected expanded category after closing the menu without moving the page', () => {
        frame();
        const expandButton = host.querySelector<HTMLButtonElement>('.primary-categories-all');
        if (!expandButton) throw new Error('Missing expand categories button');
        act(() => expandButton.click());
        click(7, true);
        expect(host.querySelector('.all-primary-category-grid')).toBeNull();
        frame();
        frame(CATEGORY_SCROLL_DURATION_MS);
        expect(rail.scrollLeft).toBe(372);
        expect(pageScroll).not.toHaveBeenCalled();
    });

    it('uses immediate positioning for reduced motion and route changes that did not originate in a click', () => {
        frame();
        reducedMotion = true;
        click(7);
        frame();
        expect(rail.scrollLeft).toBe(372);
        expect(frames.size).toBe(0);
        reducedMotion = false;
        props.activeCollectionId = 'category-5';
        props.activeChildId = 'category-5';
        render();
        frame();
        expect(rail.scrollLeft).toBe(216);
        expect(frames.size).toBe(0);
        expect(railScroll).toHaveBeenCalledTimes(2);
    });
});
