// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { DesktopLayoutContext } from './desktop-layout';
import { HERO_HEIGHT_TRANSITION_MS, HERO_TRANSITION_MS } from './hero-carousel';
import { HomePage, type HomePageProps } from './pages/home-page';
import { HomePageContext } from './storefront-page-contexts';
import * as productDisplay from './storefront-ui/product-display';
import { type MarketConfig, type StorefrontContentBlock } from './types';

vi.mock('@tanstack/react-router', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-router')>()),
    useNavigate: () => vi.fn(),
}));

const market: MarketConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: 'zh-CN',
    label: 'Malaysia',
};

const heroBlock: StorefrontContentBlock = {
    id: 'hero-1',
    code: 'homepage-hero',
    type: 'HERO',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: '/assets/hero.jpg',
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: '后台配置的首页轮播',
    subtitle: '首页精选',
    body: '只显示后台配置的内容',
    ctaLabel: '查看活动',
    items: [],
};

const baseProps: HomePageProps = {
    products: [],
    collections: [],
    contentBlocks: [],
    managedContentProducts: [],
    heroAutoplayIntervalSeconds: 5,
    configuredBlockTypes: [
        'HERO',
        'NOTICE',
        'QUICK_LINKS',
        'COUPONS',
        'TRUST_BAR',
        'CORE_CATEGORIES',
        'FLASH_SALE',
        'BEST_SELLERS',
        'RECOMMENDATIONS',
        'LEGAL',
    ],
    coupons: [],
    couponCampaignsLoading: false,
    couponCampaignsError: '',
    flashSales: [],
    systemAnnouncements: [],
    bestSellerProducts: [],
    recommendationProducts: [],
    contentError: '',
    loading: false,
    error: null,
    catalogLoading: false,
    catalogError: null,
    market,
    locale: market.locale,
    language: 'zh' as const,
    storefrontName: '测试店铺',
    storefrontDescription: '',
    storefrontTagline: '',
    availableCurrencyCodes: ['CNY'],
    currencySelectorEnabled: false,
    displayCurrencyCode: 'CNY',
    currencyLoading: false,
    onCurrencyChange: vi.fn(),
    logoUrl: null,
    logoOnLightUrl: null,
    couponLoading: false,
    onCategorySelect: vi.fn(),
    onToggleLanguage: vi.fn(),
    onNotifications: vi.fn(),
    onClaimCoupon: vi.fn().mockResolvedValue(null),
    onCouponCampaignsRetry: vi.fn(),
    onContentTarget: vi.fn(),
    onContentRetry: vi.fn(),
    onRetry: vi.fn(),
};

// Exercise actual React pointer handlers rather than only the swipe threshold helper.
describe('HomePage carousel pointer interactions', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let reducedMotion: boolean;
    let resizeObservers: Array<{ elements: Set<Element>; notify: () => void }>;
    let boundsMock: MockInstance<() => DOMRect>;
    const target = vi.fn();
    const heroes: StorefrontContentBlock[] = [
        { ...heroBlock, id: 'first', title: 'First slide', targetType: 'URL', targetValue: '/first' },
        {
            ...heroBlock,
            id: 'second',
            title: 'Second slide',
            imageUrl: '/second.jpg',
            targetType: 'URL',
            targetValue: '/second',
        },
        {
            ...heroBlock,
            id: 'third',
            title: 'Third slide',
            imageUrl: '/third.jpg',
            targetType: 'URL',
            targetValue: '/third',
        },
    ];

    beforeEach(() => {
        vi.useFakeTimers();
        reducedMotion = false;
        resizeObservers = [];
        target.mockClear();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.stubGlobal(
            'ResizeObserver',
            class {
                record: { elements: Set<Element>; notify: () => void };
                constructor(callback: ResizeObserverCallback) {
                    this.record = {
                        elements: new Set(),
                        notify: () => callback([], this as unknown as ResizeObserver),
                    };
                    resizeObservers.push(this.record);
                }
                observe(element: Element) {
                    this.record.elements.add(element);
                }
                disconnect() {
                    this.record.elements.clear();
                }
            },
        );
        vi.stubGlobal(
            'matchMedia',
            vi.fn(() => ({
                matches: reducedMotion,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            })),
        );
        vi.spyOn(productDisplay, 'decodeStorefrontImage').mockResolvedValue(undefined);
        boundsMock = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 360,
            bottom: 320,
            width: 360,
            height: 320,
            toJSON: () => ({}),
        });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await interact(() => root.unmount());
        host.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    function requiredElement<T extends Element = HTMLElement>(scope: ParentNode, selector: string): T {
        const element = scope.querySelector<T>(selector);
        expect(element).not.toBeNull();
        if (!element) throw new Error(`Expected element: ${selector}`);
        return element;
    }
    async function interact(action: () => void) {
        await act(async () => {
            action();
            await Promise.resolve();
        });
    }
    async function render(desktop = false, contentBlocks = heroes) {
        await interact(() =>
            root.render(
                <DesktopLayoutContext.Provider value={desktop}>
                    <HomePageContext.Provider
                        value={{ ...baseProps, contentBlocks, onContentTarget: target }}
                    >
                        <HomePage />
                    </HomePageContext.Provider>
                </DesktopLayoutContext.Provider>,
            ),
        );
        const viewport = requiredElement(host, '.hero');
        if (!viewport.hasPointerCapture) {
            const captured = new Set<number>();
            viewport.setPointerCapture = id => {
                captured.add(id);
            };
            viewport.hasPointerCapture = id => captured.has(id);
            viewport.releasePointerCapture = id => {
                captured.delete(id);
            };
        }
    }
    async function pointer(type: string, x: number, y = 40, pointerId = 1, onImage = false) {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
        });
        Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
        const element = requiredElement(
            host,
            onImage ? '.hero-carousel-slide:not(.is-neighbor) .hero-rich-image-link' : '.hero',
        );
        await interact(() => {
            element.dispatchEvent(event);
        });
        return event;
    }
    async function advance(ms = HERO_TRANSITION_MS + 40) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    }
    function activeSlide() {
        return requiredElement(host, '.hero-carousel-slide:not(.is-neighbor)');
    }
    function activeButton(selector: string) {
        return requiredElement<HTMLButtonElement>(activeSlide(), selector);
    }

    it.each([false, true])(
        'tracks horizontal dragging and coordinates next-slide movement, desktop=%s',
        async desktop => {
            await render(desktop);
            await pointer('pointerdown', 260, 40, 1, true);
            expect((await pointer('pointermove', 200)).defaultPrevented).toBe(true);
            expect(activeSlide().style.transform).toBe('translate3d(-60px, 0, 0)');
            const neighbor = requiredElement(host, '.hero-carousel-slide.is-neighbor');
            expect(neighbor.style.transform).toBe('translate3d(calc(100% + -60px), 0, 0)');
            expect(neighbor.getAttribute('aria-hidden')).toBe('true');
            expect(neighbor.hasAttribute('inert')).toBe(true);
            await pointer('pointerup', 200);
            expect(activeSlide().style.transform).toBe('translate3d(-100%, 0, 0)');
            expect(neighbor.style.transform).toBe('translate3d(0%, 0, 0)');
            await advance();
            expect(activeSlide().textContent).toContain('Second slide');
            expect(host.querySelector('.is-neighbor')).toBeNull();
            await advance(10_000);
            expect(activeSlide().textContent).toContain('Second slide');
        },
    );
    it('wraps rightward dragging to the preceding slide', async () => {
        await render();
        await pointer('pointerdown', 100);
        await pointer('pointermove', 180);
        expect(host.querySelector<HTMLElement>('.is-neighbor')?.style.transform).toContain('-100%');
        await pointer('pointerup', 180);
        await advance();
        expect(activeSlide().textContent).toContain('Third slide');
    });
    it('rebounds a short drag and suppresses its click without swallowing the next real tap', async () => {
        await render();
        await pointer('pointerdown', 200, 40, 1, true);
        await pointer('pointermove', 180);
        await pointer('pointerup', 180);
        await interact(() => activeButton('.hero-rich-image-link').click());
        expect(target).not.toHaveBeenCalled();
        expect(activeSlide().style.transform).toBe('translate3d(0px, 0, 0)');
        await advance();
        expect(activeSlide().textContent).toContain('First slide');
        await pointer('pointerdown', 200, 40, 1, true);
        await pointer('pointerup', 200, 40, 1, true);
        await interact(() => activeButton('.hero-rich-image-link').click());
        expect(target).toHaveBeenCalledExactlyOnceWith('URL', '/first');
    });
    it('leaves vertical scrolling untouched and ignores other pointers', async () => {
        await render();
        await pointer('pointerdown', 200);
        expect((await pointer('pointermove', 80, 40, 2)).defaultPrevented).toBe(false);
        expect(host.querySelector('.is-neighbor')).toBeNull();
        expect((await pointer('pointermove', 205, 110)).defaultPrevented).toBe(false);
        expect(host.querySelector('.is-neighbor')).toBeNull();
        await pointer('pointerup', 205, 110);
        expect(activeSlide().textContent).toContain('First slide');
    });
    it('cancels interrupted gestures and resumes autoplay after rebounding', async () => {
        await render();
        await pointer('pointerdown', 250);
        await pointer('pointermove', 150);
        await advance(6_000);
        expect(activeSlide().textContent).toContain('First slide');
        await pointer('pointercancel', 150);
        await advance();
        expect(activeSlide().textContent).toContain('First slide');
        await advance(5_000);
        await advance();
        expect(activeSlide().textContent).toContain('Second slide');
    });
    it.each(['.hero-rich-copy-region', '.hero-rich-copy-surface', '.hero-rich-stats-row', '.home-trust-bar'])(
        'stops mobile autoplay while reading the scrolling %s',
        async selector => {
            await render(false, [
                {
                    ...heroes[0],
                    items: [
                        {
                            id: 'selling-point',
                            enabled: true,
                            position: 0,
                            imageUrl: null,
                            targetType: 'NONE',
                            targetValue: null,
                            label: 'Long selling point',
                            description: 'Managed detail',
                        },
                    ],
                },
                heroes[1],
                {
                    ...heroBlock,
                    id: 'service-information',
                    type: 'TRUST_BAR',
                    items: [
                        {
                            id: 'support',
                            enabled: true,
                            position: 0,
                            imageUrl: null,
                            targetType: 'NONE',
                            targetValue: null,
                            label: 'Malaysia customer support',
                            description: '',
                        },
                    ],
                },
            ]);
            await interact(() => requiredElement(activeSlide(), selector).dispatchEvent(new Event('scroll')));
            await advance(10_000);
            expect(activeSlide().textContent).toContain('First slide');
            expect(host.querySelector('.is-neighbor')).toBeNull();
        },
    );
    it('preserves numbered selection and recovers when decoding a slide fails', async () => {
        await render(true);
        vi.mocked(productDisplay.decodeStorefrontImage).mockRejectedValue(new Error('Image unavailable'));
        await interact(() => activeButton('[aria-label="切换到第 2 张图片"]').click());
        await advance();
        expect(activeSlide().textContent).toContain('Second slide');
        expect(target).not.toHaveBeenCalled();
    });
    it('honors reduced motion while allowing deliberate manual navigation', async () => {
        reducedMotion = true;
        await render();
        await advance(10_000);
        expect(activeSlide().textContent).toContain('First slide');
        await pointer('pointerdown', 250);
        await pointer('pointermove', 150);
        await pointer('pointerup', 150);
        expect(activeSlide().textContent).toContain('Second slide');
        expect(host.querySelector('.is-settling')).toBeNull();
    });
    it('drops obsolete transitions when the managed slide list changes', async () => {
        await render();
        await pointer('pointerdown', 250);
        await pointer('pointermove', 150);
        await pointer('pointerup', 150);
        await render(false, heroes.slice(0, 1));
        await advance();
        expect(activeSlide().textContent).toContain('First slide');
        expect(host.querySelector('.is-neighbor')).toBeNull();
        expect(host.querySelector('.hero')?.classList.contains('is-swipeable')).toBe(false);
    });
    it('releases a captured drag when the window loses focus', async () => {
        await render();
        await pointer('pointerdown', 250);
        await pointer('pointermove', 150);
        await interact(() => {
            window.dispatchEvent(new Event('blur'));
        });
        expect(host.querySelector('.is-neighbor')).toBeNull();
        expect(host.querySelector<HTMLElement>('.hero')?.hasPointerCapture(1)).toBe(false);
    });
    it('does not leave autoplay paused when a pointer exits before horizontal capture', async () => {
        await render();
        await pointer('pointerdown', 250);
        await pointer('pointerout', 250);
        await advance(5_000);
        await advance();
        expect(activeSlide().textContent).toContain('Second slide');
    });
    it('honors the last numbered selection made during an ongoing transition', async () => {
        await render(true);
        await interact(() => activeButton('[aria-label="切换到第 2 张图片"]').click());
        await advance(40);
        expect(host.querySelector('.is-settling')).not.toBeNull();
        await interact(() => {
            activeButton('[aria-label="切换到第 3 张图片"]').click();
            activeButton('[aria-label="切换到第 1 张图片"]').click();
        });
        await advance();
        await advance();
        expect(activeSlide().textContent).toContain('First slide');
        expect(target).not.toHaveBeenCalled();
    });
    it('cancels a pending decode when the user reselects the currently visible slide', async () => {
        let finishDecode: () => void = () => undefined;
        vi.mocked(productDisplay.decodeStorefrontImage).mockImplementation(
            () =>
                new Promise<void>(resolve => {
                    finishDecode = resolve;
                }),
        );
        await render(true);
        await interact(() => {
            activeButton('[aria-label="切换到第 2 张图片"]').click();
            activeButton('[aria-label="切换到第 1 张图片"]').click();
        });
        await interact(() => finishDecode());
        await advance();
        expect(activeSlide().textContent).toContain('First slide');
        expect(host.querySelector('.is-neighbor')).toBeNull();
    });
    it.each([
        { desktop: false, expectedHeight: 206 },
        { desktop: true, expectedHeight: 520 },
    ])(
        'uses the artwork height on mobile and copy height on desktop ($desktop)',
        async ({ desktop, expectedHeight }) => {
            boundsMock.mockImplementation(function (this: Element) {
                const height = this.matches('.hero-rich-content') ? 520 : 206;
                return {
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 366,
                    bottom: height,
                    width: 366,
                    height,
                    toJSON: () => ({}),
                };
            });
            await render(desktop, [heroes[0]]);
            expect(requiredElement(host, '.hero-carousel-stage').style.height).toBe(`${expectedHeight}px`);
        },
    );

    it('measures the intrinsic mobile artwork scene before entrance, then shrinks after settling', async () => {
        let tallHeight = 520;
        boundsMock.mockImplementation(function (this: Element) {
            const height =
                this.matches('.hero-scene-wrapper') && this.textContent?.includes('Tall copy')
                    ? tallHeight
                    : 320;
            return {
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                right: 360,
                bottom: height,
                width: 360,
                height,
                toJSON: () => ({}),
            };
        });
        await render(false, [heroes[0], { ...heroes[1], body: 'Tall copy' }]);
        const stage = requiredElement(host, '.hero-carousel-stage');
        expect(stage.style.height).toBe('320px');
        await pointer('pointerdown', 250);
        await pointer('pointermove', 150);
        expect(stage.style.height).toBe('520px');
        await pointer('pointerup', 150);
        expect(host.querySelector('.is-settling')).toBeNull();
        await advance(HERO_HEIGHT_TRANSITION_MS + 1);
        expect(host.querySelector('.is-settling')).not.toBeNull();
        await advance();
        expect(activeSlide().textContent).toContain('Tall copy');
        expect(stage.style.height).toBe('520px');
        // Late image readiness or a responsive artwork size change triggers the scene observer.
        tallHeight = 580;
        const scene = requiredElement(activeSlide(), '.hero-scene-wrapper');
        const observer = resizeObservers.find(candidate => candidate.elements.has(scene));
        expect(observer).toBeDefined();
        if (!observer) throw new Error('Expected the current slide resize observer');
        await interact(() => observer.notify());
        expect(stage.style.height).toBe('580px');
        await advance(HERO_HEIGHT_TRANSITION_MS);
        await pointer('pointerdown', 100);
        await pointer('pointermove', 180);
        await pointer('pointerup', 180);
        expect(stage.style.height).toBe('580px');
        await advance();
        expect(activeSlide().textContent).toContain('First slide');
        expect(stage.style.height).toBe('320px');
    });
});
