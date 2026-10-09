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
    let viewportWidth: number;
    let phoneViewportListeners: Set<() => void>;
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
        viewportWidth = 390;
        phoneViewportListeners = new Set();
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
            vi.fn((query: string) => ({
                matches:
                    query === '(prefers-reduced-motion: reduce)'
                        ? reducedMotion
                        : query === '(max-width: 767px)'
                          ? viewportWidth <= 767
                          : query === '(min-width: 1024px)' && viewportWidth >= 1024,
                addEventListener: vi.fn((_type: string, listener: () => void) => {
                    if (query === '(max-width: 767px)') phoneViewportListeners.add(listener);
                }),
                removeEventListener: vi.fn((_type: string, listener: () => void) => {
                    if (query === '(max-width: 767px)') phoneViewportListeners.delete(listener);
                }),
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
    async function render(
        desktop = false,
        contentBlocks = heroes,
        language: HomePageProps['language'] = 'zh',
    ) {
        await interact(() =>
            root.render(
                <DesktopLayoutContext.Provider value={desktop}>
                    <HomePageContext.Provider
                        value={{ ...baseProps, contentBlocks, language, onContentTarget: target }}
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
    async function pointer(
        type: string,
        x: number,
        y = 40,
        pointerId = 1,
        onImage: boolean | string = false,
    ) {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
        });
        Object.defineProperties(event, {
            pointerId: { value: pointerId },
            pointerType: { value: 'touch' },
            isPrimary: { value: true },
        });
        const element = requiredElement(
            host,
            typeof onImage === 'string'
                ? `.hero-carousel-slide:not(.is-neighbor) ${onImage}`
                : onImage
                  ? '.hero-carousel-slide:not(.is-neighbor) .hero-rich-image-link'
                  : '.hero',
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

    const viewportHero: StorefrontContentBlock = {
        ...heroes[0],
        imageUrl: '/assets/desktop-hero.jpg',
        title: 'Desktop title',
        subtitle: 'Desktop subtitle',
        body: 'Original desktop description',
        ctaLabel: 'Desktop action',
        settings: {
            mobileImageUrl: '/assets/phone-hero.jpg',
            mobileImageWidth: 1600,
            mobileImageHeight: 900,
            mobileHeroTranslations: [
                {
                    languageCode: 'zh_Hans',
                    title: '手机标题',
                    subtitle: '',
                    body: '手机简短说明',
                    ctaLabel: '立即查看',
                },
                {
                    languageCode: 'en',
                    title: 'Phone title',
                    subtitle: '',
                    body: 'Short phone copy',
                    ctaLabel: 'View',
                },
            ],
        },
    };

    it.each([
        { width: 767, language: 'zh' as const, title: '手机标题', body: '手机简短说明', action: '立即查看' },
        {
            width: 767,
            language: 'en' as const,
            title: 'Phone title',
            body: 'Short phone copy',
            action: 'View',
        },
        {
            width: 768,
            language: 'zh' as const,
            title: 'Desktop title',
            body: 'Original desktop description',
            action: 'Desktop action',
        },
        {
            width: 1024,
            language: 'en' as const,
            title: 'Desktop title',
            body: 'Original desktop description',
            action: 'Desktop action',
        },
    ])(
        'renders the matching asset and $language copy at $width px',
        async ({ width, language, title, body, action }) => {
            viewportWidth = width;
            await render(width >= 1024, [viewportHero], language);
            expect(requiredElement(activeSlide(), '.hero-rich-title').textContent).toBe(title);
            expect(requiredElement(activeSlide(), '.hero-rich-desc').textContent).toBe(body);
            expect(activeButton('.hero-rich-cta-btn').textContent).toBe(action);
            const copy = requiredElement(activeSlide(), '.hero-rich-copy-region');
            expect(copy.hasAttribute('role')).toBe(false);
            expect(copy.hasAttribute('tabindex')).toBe(false);
            const artwork = requiredElement(
                activeSlide(),
                '.hero-rich-image-link img:not([aria-hidden="true"])',
            );
            expect(artwork.getAttribute('src')).toContain(
                width <= 767 ? 'phone-hero.jpg' : 'desktop-hero.jpg',
            );
            if (width <= 767) {
                expect(activeSlide().querySelector('.hero-rich-pill')).toBeNull();
                expect(artwork.getAttribute('width')).toBe('1600');
                expect(artwork.getAttribute('height')).toBe('900');
            } else {
                expect(requiredElement(activeSlide(), '.hero-rich-pill').textContent).toBe(
                    'Desktop subtitle',
                );
            }
        },
    );

    it('updates phone presentation across 767/768 without changing the tablet desktop-layout context', async () => {
        viewportWidth = 767;
        await render(false, [viewportHero]);
        expect(requiredElement(activeSlide(), '.hero-rich-title').textContent).toBe('手机标题');
        await interact(() => {
            viewportWidth = 768;
            phoneViewportListeners.forEach(listener => listener());
        });
        expect(requiredElement(activeSlide(), '.hero-rich-title').textContent).toBe('Desktop title');
        expect(
            requiredElement(
                activeSlide(),
                '.hero-rich-image-link img:not([aria-hidden="true"])',
            ).getAttribute('src'),
        ).toContain('desktop-hero.jpg');
        await interact(() => {
            viewportWidth = 767;
            phoneViewportListeners.forEach(listener => listener());
        });
        expect(requiredElement(activeSlide(), '.hero-rich-title').textContent).toBe('手机标题');
        expect(activeSlide().querySelector('.hero-rich-pill')).toBeNull();
    });

    it.each([
        { width: 390, language: 'zh' as const, title: '手机标题', body: '手机简短说明', action: '立即查看' },
        {
            width: 390,
            language: 'en' as const,
            title: 'Phone title',
            body: 'Short phone copy',
            action: 'View',
        },
        {
            width: 1440,
            language: 'zh' as const,
            title: 'Desktop title',
            body: 'Original desktop description',
            action: 'Desktop action',
        },
        {
            width: 1440,
            language: 'en' as const,
            title: 'Desktop title',
            body: 'Original desktop description',
            action: 'Desktop action',
        },
    ])('keeps editorial artwork on the existing $language media contract at $width px', async copy => {
        viewportWidth = copy.width;
        await render(
            copy.width >= 1024,
            [{ ...viewportHero, settings: { ...viewportHero.settings, heroArtworkLayout: 'editorial' } }],
            copy.language,
        );
        expect(
            requiredElement(activeSlide(), '.hero-scene-wrapper').getAttribute('data-hero-artwork-layout'),
        ).toBe('editorial');
        expect(requiredElement(activeSlide(), '.hero-rich-title').textContent).toBe(copy.title);
        expect(requiredElement(activeSlide(), '.hero-rich-desc').textContent).toBe(copy.body);
        expect(activeButton('.hero-rich-cta-btn').textContent).toBe(copy.action);
        expect(
            requiredElement(
                activeSlide(),
                '.hero-rich-image-link img:not([aria-hidden="true"])',
            ).getAttribute('src'),
        ).toContain(copy.width <= 767 ? 'phone-hero.jpg' : 'desktop-hero.jpg');
    });

    it('allows editorial and original artwork to share manual navigation without changing their own targets', async () => {
        viewportWidth = 1440;
        await render(true, [{ ...heroes[0], settings: { heroArtworkLayout: 'editorial' } }, heroes[1]]);
        expect(
            requiredElement(activeSlide(), '.hero-scene-wrapper').getAttribute('data-hero-artwork-layout'),
        ).toBe('editorial');
        await interact(() => activeButton('.hero-rich-image-link').click());
        expect(target).toHaveBeenLastCalledWith('URL', '/first');
        await interact(() => activeButton('[aria-label="切换到第 2 张图片"]').click());
        await advance();
        expect(
            requiredElement(activeSlide(), '.hero-scene-wrapper').getAttribute('data-hero-artwork-layout'),
        ).toBe('overlay');
        expect(requiredElement(activeSlide(), '.hero-rich-image-link img').getAttribute('src')).toContain(
            'second.jpg',
        );
        await interact(() => activeButton('.hero-rich-cta-btn').click());
        expect(target).toHaveBeenLastCalledWith('URL', '/second');
    });

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
    it.each(['.hero-rich-image-link', '.hero-rich-copy-surface'])(
        'keeps swiping when implicit touch capture transfers from %s to the carousel',
        async selector => {
            await render();
            await pointer('pointerdown', 260, 40, 1, selector);
            await pointer('pointermove', 230, 40, 1, selector);
            const viewport = requiredElement(host, '.hero');
            expect(viewport.hasPointerCapture(1)).toBe(true);

            // Touch starts with capture on the hit-tested child. Reassigning it to the
            // carousel fires a bubbling lostpointercapture from that previous owner.
            await pointer('lostpointercapture', 230, 40, 1, selector);
            expect(viewport.hasPointerCapture(1)).toBe(true);
            expect(viewport.classList.contains('is-dragging')).toBe(true);
            await pointer('pointermove', 160);
            expect(activeSlide().style.transform).toBe('translate3d(-100px, 0, 0)');
            await pointer('pointerup', 160);
            await interact(() => activeButton('.hero-rich-image-link').click());
            expect(target).not.toHaveBeenCalled();
            await advance();
            expect(activeSlide().textContent).toContain('Second slide');
        },
    );
    it('rebounds when the carousel itself really loses pointer capture', async () => {
        await render();
        await pointer('pointerdown', 250, 40, 1, true);
        await pointer('pointermove', 150);
        requiredElement(host, '.hero').releasePointerCapture(1);
        await pointer('lostpointercapture', 150);
        await advance();
        expect(activeSlide().textContent).toContain('First slide');
        expect(host.querySelector('.is-neighbor')).toBeNull();
        await advance(5_000);
        await advance();
        expect(activeSlide().textContent).toContain('Second slide');
    });
    it('preserves direct taps on the activity action button', async () => {
        await render();
        await pointer('pointerdown', 100, 40, 1, '.hero-rich-cta-btn');
        await pointer('pointerup', 100, 40, 1, '.hero-rich-cta-btn');
        expect(host.querySelector('.is-neighbor')).toBeNull();
        await interact(() => activeButton('.hero-rich-cta-btn').click());
        expect(target).toHaveBeenCalledExactlyOnceWith('URL', '/first');
    });
    it.each([
        { manual: true, selector: '.hero-rich-cta-btn' },
        { manual: true, selector: '.hero-rich-image-link' },
        { manual: false, selector: '.hero-rich-cta-btn' },
        { manual: false, selector: '.hero-rich-image-link' },
    ])(
        'allows the entering $selector to open its own activity during animation, manual=$manual',
        async ({ manual, selector }) => {
            await render();
            if (manual) {
                await pointer('pointerdown', 260, 40, 1, true);
                await pointer('pointermove', 150);
                await pointer('pointerup', 150);
            } else {
                await advance(5_000);
                await advance(40);
            }
            // A new tap after the swipe's synthetic click is allowed before the 520ms transition ends.
            await advance(1);
            expect(host.querySelector('.is-settling')).not.toBeNull();
            const entering = requiredElement(host, '.hero-carousel-slide.is-neighbor');
            expect(entering.hasAttribute('inert')).toBe(false);
            expect(entering.hasAttribute('aria-hidden')).toBe(false);
            expect(activeSlide().hasAttribute('inert')).toBe(true);
            expect(activeSlide().getAttribute('aria-hidden')).toBe('true');
            expect(host.querySelectorAll('.hero-carousel-slide:not([inert])')).toHaveLength(1);
            expect(requiredElement(host, '.hero').getAttribute('aria-label')).toBe('Second slide');
            await interact(() => requiredElement<HTMLButtonElement>(entering, selector).click());
            expect(target).toHaveBeenCalledExactlyOnceWith('URL', '/second');
            await advance();
            await interact(() => activeButton(selector).click());
            expect(target).toHaveBeenCalledTimes(2);
            expect(target).toHaveBeenLastCalledWith('URL', '/second');
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
        expect(activeSlide().hasAttribute('inert')).toBe(false);
        expect(requiredElement(host, '.hero-carousel-slide.is-neighbor').hasAttribute('inert')).toBe(true);
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
    it.each(['.hero-rich-copy-region', '.hero-rich-copy-surface', '.hero-rich-stats-row'])(
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
            ]);
            const readingSurface = requiredElement(activeSlide(), selector);
            await interact(() => readingSurface.dispatchEvent(new Event('scroll')));
            await advance(10_000);
            expect(activeSlide().textContent).toContain('First slide');
            expect(host.querySelector('.is-neighbor')).toBeNull();
        },
    );
    it.each([false, true])(
        'keeps the standalone trust floor outside carousel gestures and transitions (desktop=%s)',
        async desktop => {
            await render(desktop, [
                heroes[0],
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
                            description: 'Read the complete service details before ordering.',
                        },
                    ],
                },
            ]);
            const trust = requiredElement(host, '.home-trust-bar');
            expect(trust.parentElement).toBe(requiredElement(host, '.homepage-modules'));
            expect(trust.closest('.hero-carousel')).toBeNull();
            expect(trust.hasAttribute('tabindex')).toBe(false);
            expect(host.querySelector('.home-hero-trust')).toBeNull();
            expect(trust.textContent).toContain('Read the complete service details before ordering.');
            for (const [type, x] of [
                ['pointerdown', 250],
                ['pointermove', 100],
                ['pointerup', 100],
            ] as const) {
                const event = new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    clientX: x,
                    clientY: 40,
                    button: 0,
                });
                Object.defineProperties(event, {
                    pointerId: { value: 1 },
                    pointerType: { value: 'touch' },
                    isPrimary: { value: true },
                });
                await interact(() => trust.dispatchEvent(event));
                expect(event.defaultPrevented).toBe(false);
                expect(host.querySelector('.is-neighbor')).toBeNull();
            }
            expect(activeSlide().textContent).toContain('First slide');
            await pointer('pointerdown', 250);
            await pointer('pointermove', 100);
            expect(host.querySelector('.is-neighbor')).not.toBeNull();
            expect(host.querySelectorAll('.home-trust-bar')).toHaveLength(1);
            await pointer('pointerup', 100);
            await advance();
            expect(activeSlide().textContent).toContain('Second slide');
            expect(host.querySelectorAll('.home-trust-bar')).toHaveLength(1);
            expect(target).not.toHaveBeenCalled();
        },
    );
    it('shows a static current page for one desktop image without enabling slide navigation', async () => {
        await render(true, [heroes[0]]);
        const pager = requiredElement(activeSlide(), '.hero-page-picker');
        expect(pager.textContent?.trim()).toBe('1');
        expect(pager.querySelector('button')).toBeNull();
        expect(pager.querySelector('[aria-current="true"]')?.getAttribute('aria-label')).toBe(
            '当前第 1 张图片',
        );
        await advance(10_000);
        expect(activeSlide().textContent).toContain('First slide');
        expect(host.querySelector('.is-neighbor')).toBeNull();
        expect(target).not.toHaveBeenCalled();
    });
    it.each([false, true])(
        'does not stop or pause autoplay for standalone trust scrolling, hover or focus (desktop=%s)',
        async desktop => {
            await render(desktop, [
                heroes[0],
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
                            description: 'Read the complete service details before ordering.',
                        },
                    ],
                },
            ]);
            const trust = requiredElement(host, '.home-trust-bar');
            await interact(() => {
                trust.dispatchEvent(new Event('scroll', { bubbles: true }));
                trust.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                trust.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
            });
            await advance(5_000);
            await advance();
            expect(activeSlide().textContent).toContain('Second slide');
            expect(host.querySelector('.is-neighbor')).toBeNull();
            expect(host.querySelectorAll('.home-trust-bar')).toHaveLength(1);
            expect(requiredElement(host, '.hero').textContent).not.toContain('自动轮播已停止');
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
            const entering = requiredElement(host, '.hero-carousel-slide:not([inert])');
            expect(
                requiredElement(entering, '[aria-label="切换到第 2 张图片"]').getAttribute('aria-current'),
            ).toBe('true');
            requiredElement<HTMLButtonElement>(entering, '[aria-label="切换到第 3 张图片"]').click();
            requiredElement<HTMLButtonElement>(entering, '[aria-label="切换到第 1 张图片"]').click();
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
        { desktop: false, expectedHeight: '726px' },
        { desktop: true, expectedHeight: '520px' },
    ])(
        'measures the full mobile scene and the desktop copy surface ($desktop)',
        async ({ desktop, expectedHeight }) => {
            boundsMock.mockImplementation(function (this: Element) {
                const height = this.matches('.hero-rich-content')
                    ? 520
                    : this.matches('.hero-scene-wrapper')
                      ? 726
                      : 206;
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
            expect(requiredElement(host, '.hero-carousel-stage').style.height).toBe(expectedHeight);
        },
    );

    it.each([false, true])(
        'includes overflowing copy beyond the constrained scene bounds (desktop=%s)',
        async desktop => {
            const heightSelector = desktop ? '.hero-rich-content' : '.hero-scene-wrapper';
            let contentHeight = 480;
            vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
                return this.matches(heightSelector) ? contentHeight : 0;
            });
            await render(
                desktop,
                [{ ...heroes[0], body: 'A longer English description that extends below the artwork.' }],
                'en',
            );
            const stage = requiredElement(host, '.hero-carousel-stage');
            const surface = requiredElement(activeSlide(), heightSelector);
            expect(surface.getBoundingClientRect().height).toBe(320);
            expect(surface.scrollHeight).toBe(480);
            expect(stage.style.height).toBe('480px');
            expect(surface.textContent).toContain('A longer English description');

            const observer = resizeObservers.find(candidate => candidate.elements.has(surface));
            expect(observer).toBeDefined();
            if (!observer) throw new Error('Expected the current slide resize observer');
            contentHeight = 640;
            await interact(() => observer.notify());
            expect(stage.style.height).toBe('640px');

            contentHeight = 240;
            await interact(() => observer.notify());
            expect(stage.style.height).toBe('320px');
        },
    );

    it.each([false, true])(
        'keeps carousel height independent of a resized or removed trust floor (desktop=%s)',
        async desktop => {
            let trustHeight = 400;
            boundsMock.mockImplementation(function (this: Element) {
                const height = this.matches('.home-trust-bar') ? trustHeight : 320;
                return {
                    x: 0,
                    y: 0,
                    top: 0,
                    left: 0,
                    right: 360,
                    bottom: height,
                    width: this.matches('.hero-overlay-controls') ? pagerWidth : 360,
                    height,
                    toJSON: () => ({}),
                };
            });
            await render(desktop, [heroes[0]]);
            const viewport = requiredElement(host, '.hero');
            const stage = requiredElement(host, '.hero-carousel-stage');
            const carousel = requiredElement(host, '.hero-carousel');
            expect(viewport.style.getPropertyValue('--home-hero-trust-height')).toBe('');
            expect(stage.style.height).toBe('320px');

            const serviceBlock: StorefrontContentBlock = {
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
                        label: 'Customer support',
                        description: 'Complete service details',
                    },
                ],
            };
            await render(desktop, [heroes[0], serviceBlock]);
            const trust = requiredElement(host, '.home-trust-bar');
            expect(trust.getBoundingClientRect().height).toBe(400);
            expect(viewport.style.getPropertyValue('--home-hero-trust-height')).toBe('');
            expect(stage.style.height).toBe('320px');
            expect(resizeObservers.some(candidate => candidate.elements.has(trust))).toBe(false);
            const observer = resizeObservers.find(candidate => candidate.elements.has(viewport));
            expect(observer).toBeDefined();
            if (!observer) throw new Error('Expected the carousel viewport resize observer');

            trustHeight = 640;
            await interact(() => observer.notify());
            expect(trust.getBoundingClientRect().height).toBe(640);
            expect(viewport.style.getPropertyValue('--home-hero-trust-height')).toBe('');
            expect(stage.style.height).toBe('320px');

            await render(desktop, [heroes[0]]);
            expect(host.querySelector('.home-trust-bar')).toBeNull();
            expect(host.querySelector('.home-hero-trust')).toBeNull();
            expect(viewport.style.getPropertyValue('--home-hero-trust-height')).toBe('');
            expect(stage.style.height).toBe('320px');
            expect(observer.elements.has(trust)).toBe(false);
            await interact(() => observer.notify());
            expect(viewport.style.getPropertyValue('--home-hero-trust-height')).toBe('');
            expect(stage.style.height).toBe('320px');
        },
    );

    it.each([false, true])(
        'grows before entrance, observes content changes and shrinks after settling (desktop=%s)',
        async desktop => {
            let tallHeight = 520;
            const heightSelector = desktop ? '.hero-rich-content' : '.hero-scene-wrapper';
            boundsMock.mockImplementation(function (this: Element) {
                const height =
                    this.matches(heightSelector) && this.textContent?.includes('Tall copy')
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
            await render(desktop, [heroes[0], { ...heroes[1], body: 'Tall copy' }]);
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
            // Font, copy and media changes update the currently measured surface.
            tallHeight = 580;
            const scene = requiredElement(activeSlide(), heightSelector);
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
        },
    );
});
