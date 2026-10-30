// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthEmailDraftContext } from './auth-presentation';
import { GptRechargePage } from './client-plugins/gpt-recharge/gpt-recharge-page';
import { Overlay } from './overlay-host';
import { createStorefrontQueryClient } from './query-client';
import { GptRechargeRoutePage } from './route-pages/gpt-recharge-route-page';
import { StorefrontContext } from './StorefrontContext';
import { mountStorefrontEnhancements, StorefrontShell } from './StorefrontShell';

const viewport = vi.hoisted(() => ({ desktop: false }));
const rechargeRoute = vi.hoisted(() => ({ active: false }));
const deferredModules = vi.hoisted(() => ({ updates: 0, privacy: 0 }));
const enhancements = vi.hoisted(() => ({
    start: vi.fn(),
    dispose: vi.fn(),
    didStart: undefined as (() => void) | undefined,
}));
vi.mock('./router', () => ({
    router: {
        subscribe: () => () => undefined,
        history: { subscribe: () => () => undefined },
        state: { location: { href: '/' } },
    },
}));
vi.mock('./storefront-enhancements', async importOriginal => {
    const actual = await importOriginal<typeof import('./storefront-enhancements')>();
    return {
        trackStorefrontEnhancements: () => {
            const dispose = actual.trackStorefrontEnhancements();
            enhancements.start();
            enhancements.didStart?.();
            return () => {
                enhancements.dispose();
                dispose();
            };
        },
    };
});

vi.mock('./StorefrontUpdatePrompt', () => {
    deferredModules.updates++;
    return { StorefrontUpdatePrompt: () => <div>DEFERRED_UPDATE</div> };
});
vi.mock('./storefront-ui/storefront-traffic-preference', () => {
    deferredModules.privacy++;
    return { StorefrontTrafficPreference: () => <div>DEFERRED_PRIVACY</div> };
});
vi.mock('./desktop-layout', async importOriginal => ({
    ...(await importOriginal<typeof import('./desktop-layout')>()),
    useDesktopViewport: () => viewport.desktop,
}));
vi.mock('./components/common/desktop-header', () => ({
    DesktopHeader: () => <div>DESKTOP_CATALOG_HEADER</div>,
}));
vi.mock('./components/common/desktop-account-navigation', async importOriginal => ({
    ...(await importOriginal<typeof import('./components/common/desktop-account-navigation')>()),
    DesktopAccountNavigation: () => <div>DESKTOP_ACCOUNT_NAVIGATION</div>,
}));
vi.mock('@tanstack/react-router', () => ({
    useRouter: () => ({ state: { status: 'idle' } }),
    useRouterState: () => '/',
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
    Outlet: () => {
        const context = useContext(StorefrontContext);
        const draft = useContext(AuthEmailDraftContext);
        if (rechargeRoute.active) return <GptRechargeRoutePage />;
        return (
            <div>
                PAGE_CONTENT <span data-testid="address-count">{context?.customer?.addresses?.length}</span>
                <span data-testid="email-draft">{draft?.emailDraft ?? 'NO_DRAFT_SCOPE'}</span>
                <button
                    data-testid="set-email-draft"
                    onClick={() => draft?.onEmailDraftChange?.('memory@example.invalid')}
                >
                    Set fixture draft
                </button>
            </div>
        );
    },
    lazyRouteComponent: (_loader: unknown, name: string) =>
        name === 'GptRechargePage'
            ? GptRechargePage
            : name === 'AuthenticationOverlay'
              ? function FixtureAuthenticationOverlay() {
                    const runtime = useContext(StorefrontContext);
                    if (!runtime) throw new Error('Missing fixture storefront context');
                    return (
                        <Overlay onClose={runtime.closeAuthOverlay}>
                            <div role="dialog">
                                <input name="retained-auth-draft" />
                            </div>
                        </Overlay>
                    );
                }
              : name === 'LoginRoutePage'
                ? () => <div>SIGN_IN_FORM</div>
                : () => <div>LAZY_SHELL_CONTENT</div>,
}));
vi.mock('./components/common/bottom-navigation', async importOriginal => ({
    ...(await importOriginal<typeof import('./components/common/bottom-navigation')>()),
    BottomNavigation: () => <div>CATALOG_NAVIGATION</div>,
    shouldShowBottomNavigation: () => true,
}));
vi.mock('./route-loading', () => ({
    RouteTransitionLoader: () => <div>CHECKING_ACCOUNT</div>,
    PageSkeleton: () => <div>CATALOG_SKELETON</div>,
    pageSkeletonVariantForPathname: () => 'default',
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('catalog rendering boundary', () => {
    let element: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let enhancementsStarted: Promise<void>;
    let queryClient: ReturnType<typeof createStorefrontQueryClient>;
    beforeEach(() => {
        // Each case owns idle delivery; a slow prior case must not preload the
        // deferred modules before the explicit readiness/idle assertions below.
        vi.stubGlobal(
            'requestIdleCallback',
            vi.fn(() => 1),
        );
        vi.stubGlobal('cancelIdleCallback', vi.fn());
        enhancements.start.mockClear();
        enhancements.dispose.mockClear();
        enhancementsStarted = new Promise(resolve => {
            enhancements.didStart = resolve;
        });
        window.history.replaceState(null, '', '/');
        viewport.desktop = false;
        rechargeRoute.active = false;
        queryClient = createStorefrontQueryClient();
        element = document.createElement('div');
        root = createRoot(element);
    });
    afterEach(() => {
        act(() => root.unmount());
        queryClient.clear();
        enhancements.didStart = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    const render = (overrides: Record<string, unknown> = {}) => {
        const state = {
            storefrontContextValue: {},
            online: true,
            isZh: true,
            displayedRoute: { name: 'home' },
            language: 'zh',
            storefrontName: 'Fixture',
            customer: null,
            customerLoadState: 'ready',
            retryAccount: vi.fn(),
            retryPageLoad: vi.fn(),
            storefrontUnavailable: false,
            ...overrides,
        };
        state.storefrontContextValue = {
            route: state.displayedRoute,
            market: { code: 'fixture-store', currencyCode: 'MYR' },
            storefrontCode: 'fixture-store',
            storefrontContextResolved: true,
            configQuery: { isError: false, isFetching: false },
            ...(state.storefrontContextValue as Record<string, unknown>),
        };
        act(() =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <StorefrontShell state={state as never} />
                </QueryClientProvider>,
            ),
        );
    };
    it('starts deferred browser enhancements after reconnect and retains installed features through later disconnects', async () => {
        let online = false;
        vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
        render({ online: false });
        expect(enhancements.start).not.toHaveBeenCalled();
        await act(async () => {
            online = true;
            window.dispatchEvent(new Event('online'));
            // Observe this mount's completed real initializer, rather than a
            // global import drain that can precede an async mock's continuation.
            await enhancementsStarted;
        });
        expect(enhancements.start).toHaveBeenCalledOnce();
        act(() => {
            online = false;
            window.dispatchEvent(new Event('offline'));
            online = true;
            window.dispatchEvent(new Event('online'));
        });
        expect(enhancements.start).toHaveBeenCalledOnce();
        expect(enhancements.dispose).not.toHaveBeenCalled();
        act(() => root.render(null));
        expect(enhancements.dispose).toHaveBeenCalledOnce();
    });

    it('shares only the email across standalone auth routes and drops it when the flow is left', () => {
        render({ displayedRoute: { name: 'register' } });
        act(() => element.querySelector<HTMLButtonElement>('[data-testid="set-email-draft"]')?.click());
        for (const name of ['login', 'forgot-password', 'register']) {
            render({ displayedRoute: { name } });
            expect(element.querySelector('[data-testid="email-draft"]')?.textContent).toBe(
                'memory@example.invalid',
            );
        }
        render({ displayedRoute: { name: 'home' } });
        expect(element.querySelector('[data-testid="email-draft"]')?.textContent).toBe('NO_DRAFT_SCOPE');
        render({ displayedRoute: { name: 'register' } });
        expect(element.querySelector('[data-testid="email-draft"]')?.textContent).toBe('');
    });
    it.each([
        { label: 'storefront', context: { storefrontCode: 'other-store' } },
        { label: 'market', context: { market: { code: 'OTHER', currencyCode: 'MYR' } } },
        { label: 'currency', context: { market: { code: 'fixture-store', currencyCode: 'USD' } } },
    ])('drops the standalone draft when its $label owner changes', ({ context }) => {
        render({ displayedRoute: { name: 'register' } });
        act(() => element.querySelector<HTMLButtonElement>('[data-testid="set-email-draft"]')?.click());
        render({ displayedRoute: { name: 'login' }, storefrontContextValue: context });
        expect(element.querySelector('[data-testid="email-draft"]')?.textContent).toBe('');
    });
    it('clears the standalone draft on authentication without restoring it after logout', () => {
        render({ displayedRoute: { name: 'register' } });
        act(() => element.querySelector<HTMLButtonElement>('[data-testid="set-email-draft"]')?.click());
        render({ displayedRoute: { name: 'login' }, customer: { id: 'fixture-customer' } });
        expect(element.querySelector('[data-testid="email-draft"]')?.textContent).toBe('NO_DRAFT_SCOPE');
        render({ displayedRoute: { name: 'login' } });
        expect(element.querySelector('[data-testid="email-draft"]')?.textContent).toBe('');
    });
    it.each(['login', 'register', 'verify-account'])(
        'preserves the %s form and layout when the customer resolves',
        name => {
            viewport.desktop = true;
            render({ displayedRoute: { name }, customerLoadState: 'loading' });
            const formControl = element.querySelector('[data-testid="set-email-draft"]');
            expect(formControl).not.toBeNull();
            render({ displayedRoute: { name }, customer: { id: 'fixture-customer' } });
            expect(element.querySelector('[data-testid="set-email-draft"]')).toBe(formControl);
            expect(element.textContent).not.toContain('DESKTOP_CATALOG_HEADER');
            expect(element.textContent).not.toContain('DESKTOP_ACCOUNT_NAVIGATION');
        },
    );
    it('uses the centered initial state until configuration is resolved, including an immediate read failure', () => {
        render({
            pageDataPending: true,
            storefrontContextValue: { storefrontCode: '', storefrontContextResolved: false },
        });
        expect(element.querySelector('.page-readiness-initial')).not.toBeNull();
        expect(element.querySelector('.page-readiness-stage')?.hasAttribute('hidden')).toBe(true);
        render({
            storefrontContextValue: {
                storefrontCode: '',
                storefrontContextResolved: false,
                configQuery: { isError: true, isFetching: false },
            },
        });
        expect(element.querySelector('.page-readiness-initial [role="alert"]')?.textContent).toContain(
            '暂时无法加载',
        );
        expect(element.querySelector('.brand-loading-dots, .brand-loading-bar')).toBeNull();
        render();
        expect(element.querySelector('.page-readiness-initial')).toBeNull();
        expect(element.querySelector('.page-readiness-stage')?.hasAttribute('hidden')).toBe(false);
    });
    it('does not hide the confirmed shell when the first route reports navigation pending', () => {
        render({ isNavigationPending: true });
        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.querySelector('.page-readiness-initial')).toBeNull();
        expect(element.querySelector('.page-readiness-stage')?.hasAttribute('hidden')).toBe(false);
        expect(element.querySelector('.page-readiness-stage')?.hasAttribute('inert')).toBe(false);
    });
    it('releases document startup when the definitive store-unavailable view commits', () => {
        const owned = vi.fn();
        document.addEventListener('storefront:app-owned', owned);
        try {
            render({ storefrontUnavailable: true });
            expect(element.textContent).toContain('店铺暂未开放');
            expect(owned).toHaveBeenCalledOnce();
            expect(element.querySelector('button')?.disabled).toBe(false);
        } finally {
            document.removeEventListener('storefront:app-owned', owned);
        }
    });
    it('renders the privacy notice before idle while deferring update UI on sensitive routes', async () => {
        vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        let idle: IdleRequestCallback | undefined;
        vi.stubGlobal(
            'requestIdleCallback',
            vi.fn((callback: IdleRequestCallback) => {
                idle = callback;
                return 1;
            }),
        );
        vi.stubGlobal('cancelIdleCallback', vi.fn());
        render();
        expect(deferredModules.updates).toBe(0);
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        expect(element.textContent).toContain('DEFERRED_PRIVACY');
        act(() => {
            document.dispatchEvent(new Event('storefront:page-ready'));
        });
        expect(deferredModules.updates).toBe(0);
        await act(async () => {
            await vi.dynamicImportSettled();
        });
        expect(element.textContent).toContain('DEFERRED_PRIVACY');
        await act(async () => {
            idle?.({ didTimeout: false, timeRemaining: () => 50 });
            await Promise.resolve();
        });
        expect(deferredModules.updates).toBe(1);
        expect(deferredModules.privacy).toBe(1);
        expect(element.textContent).toContain('DEFERRED_UPDATE');
        expect(element.textContent).toContain('DEFERRED_PRIVACY');
        render({ displayedRoute: { name: 'checkout' }, customer: { id: 'customer-a' } });
        expect(element.textContent).not.toContain('DEFERRED_UPDATE');
        expect(element.textContent).toContain('DEFERRED_PRIVACY');
    });

    it('keeps one shared viewport tracker across routes and removes it when the shell unmounts', async () => {
        const visibleViewport = Object.assign(new EventTarget(), { height: 768, offsetTop: 0, scale: 1 });
        vi.stubGlobal('visualViewport', visibleViewport);
        try {
            render();
            await act(async () => {
                await vi.dynamicImportSettled();
            });
            expect(document.querySelectorAll('.storefront-viewport-probe')).toHaveLength(1);
            render({ displayedRoute: { name: 'product', id: '1' } });
            expect(document.querySelectorAll('.storefront-viewport-probe')).toHaveLength(1);
            act(() => root.render(null));
            expect(document.querySelectorAll('.storefront-viewport-probe')).toHaveLength(0);
            expect(
                document.documentElement.style.getPropertyValue('--storefront-viewport-bottom-offset'),
            ).toBe('');
        } finally {
            vi.unstubAllGlobals();
        }
    });
    it('never mounts catalog content while account validation is pending', () => {
        render({ displayedRoute: { name: 'orders' }, customerLoadState: 'loading' });
        expect(element.textContent).toContain('CATALOG_SKELETON');
        expect(element.textContent).not.toContain('CHECKING_ACCOUNT');
        expect(element.textContent).not.toContain('PAGE_CONTENT');
    });
    it('shows populated preview customer data', () => {
        window.history.replaceState(
            null,
            '',
            '/addresses?storefrontPreviewEmbedded=1&storefrontPreviewAuth=authenticated&storefrontPreviewScenario=dense',
        );
        render({
            displayedRoute: { name: 'addresses' },
            customer: { id: 'qa-customer', addresses: [{ id: 'qa-address' }] },
        });
        expect(element.querySelector('[data-testid="address-count"]')?.textContent).toBe('1');
    });
    it('keeps guest preview anonymous even if a customer session exists', () => {
        window.history.replaceState(
            null,
            '',
            '/addresses?storefrontPreviewEmbedded=1&storefrontPreviewAuth=guest',
        );
        render({
            displayedRoute: { name: 'addresses' },
            customer: { id: 'qa-customer', addresses: [{ id: 'qa-address' }] },
        });
        expect(element.textContent).toContain('SIGN_IN_FORM');
    });
    it('renders the product for an anonymous direct product URL', () => {
        render({ displayedRoute: { name: 'product', id: '1' } });
        expect(element.textContent).not.toContain('SIGN_IN_FORM');
        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.textContent).toContain('CATALOG_NAVIGATION');
    });
    it('shows a clear closed-store state when the public configuration is forbidden', () => {
        render({ storefrontUnavailable: true });
        expect(element.textContent).toContain('店铺暂未开放');
        expect(element.textContent).not.toContain('PAGE_CONTENT');
        expect(element.textContent).not.toContain('CATALOG_NAVIGATION');
        expect(element.querySelector('button')).not.toBeNull();
    });
    it.each(['zh', 'en'])(
        'shows the shared public-preview notice in %s and removes it for live stores',
        language => {
            render({ storefrontAccessMode: 'PREVIEW', language, isZh: language === 'zh' });
            expect(element.querySelector('.storefront-preview-notice')?.textContent).toContain(
                language === 'zh' ? '店铺尚未正式营业' : 'This store is not live yet',
            );
            expect(element.textContent).toContain('PAGE_CONTENT');
            render({ storefrontAccessMode: 'LIVE', language, isZh: language === 'zh' });
            expect(element.querySelector('.storefront-preview-notice')).toBeNull();
        },
    );
    it('recovers closed stores through the existing read-only retry', () => {
        const retryPageLoad = vi.fn();
        render({ storefrontUnavailable: true, retryPageLoad });
        act(() => element.querySelector('button')?.click());
        expect(retryPageLoad).toHaveBeenCalledTimes(1);
        render({ storefrontUnavailable: false, storefrontAccessMode: 'PREVIEW', retryPageLoad });
        expect(element.textContent).not.toContain('店铺暂未开放');
        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.querySelector('.storefront-preview-notice')).not.toBeNull();
    });
    it('does not infer preview mode from a missing legacy field', () => {
        render();
        expect(element.querySelector('.storefront-preview-notice')).toBeNull();
    });
    it('does not duplicate the public-preview notice in the Admin design iframe', () => {
        window.history.replaceState(null, '', '/?storefrontPreviewEmbedded=1');
        render({ storefrontAccessMode: 'PREVIEW' });
        expect(element.querySelector('.storefront-preview-notice')).toBeNull();
    });
    it('shows desktop browsing navigation to guests while keeping account navigation private', () => {
        viewport.desktop = true;
        render({ displayedRoute: { name: 'product', id: '1' } });
        expect(element.textContent).not.toContain('SIGN_IN_FORM');
        expect(element.textContent).toContain('DESKTOP_CATALOG_HEADER');
        expect(element.textContent).not.toContain('DESKTOP_ACCOUNT_NAVIGATION');
        expect(element.querySelector('[data-route]')?.getAttribute('data-route')).toBe('product');
        render({ customer: { id: 'customer-a' } });
        expect(element.textContent).toContain('DESKTOP_CATALOG_HEADER');
    });
    it('removes private account content immediately after logout', () => {
        render({ displayedRoute: { name: 'orders' }, customer: { id: 'customer-a' } });
        expect(element.textContent).toContain('PAGE_CONTENT');
        render({ displayedRoute: { name: 'orders' } });
        expect(element.textContent).not.toContain('PAGE_CONTENT');
        expect(element.textContent).toContain('SIGN_IN_FORM');
    });
    it('fails closed when account validation fails and preserves a retry', () => {
        render({
            displayedRoute: { name: 'orders' },
            customerLoadState: 'error',
            customerLoadError: 'ACCOUNT_UNAVAILABLE',
        });
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('ACCOUNT_UNAVAILABLE');
        expect(element.textContent).not.toContain('PAGE_CONTENT');
        expect(element.querySelector('button')).not.toBeNull();
    });
    it.each(['loading', 'error'] as const)(
        'keeps the homepage visible when account resolution is %s',
        customerLoadState => {
            render({ customerLoadState });
            expect(element.textContent).toContain('PAGE_CONTENT');
            expect(element.textContent).toContain('CATALOG_NAVIGATION');
            expect(element.textContent).not.toContain('SIGN_IN_FORM');
        },
    );
    it('keeps public policy pages available before login', () => {
        render({ displayedRoute: { name: 'legal', id: 'privacy' } });
        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.textContent).not.toContain('CATALOG_NAVIGATION');
    });
    it('keeps category page mounted when switching between categories without triggering loading card', () => {
        render({ displayedRoute: { name: 'category', collectionId: 'baijiu' } });
        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.textContent).toContain('CATALOG_NAVIGATION');
        expect(element.textContent).not.toContain('CHECKING_ACCOUNT');

        render({ displayedRoute: { name: 'category', collectionId: 'coffee', childId: 'instant' } });
        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.textContent).toContain('CATALOG_NAVIGATION');
        expect(element.textContent).not.toContain('CHECKING_ACCOUNT');
    });

    it('keeps browsing content visible while an in-app navigation is pending', () => {
        render({ displayedRoute: { name: 'home' }, isNavigationPending: true });

        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.textContent).toContain('CATALOG_NAVIGATION');
        expect(element.textContent).not.toContain('CHECKING_ACCOUNT');
    });

    it('returns to the account page when reviews are disabled for the Channel', () => {
        const navigate = vi.fn();
        render({
            displayedRoute: { name: 'reviews' },
            storefrontContextValue: { navigate, reviewSettingsStatus: 'disabled' },
        });

        expect(navigate).toHaveBeenCalledWith({ name: 'account' }, true);
    });

    it('keeps the preview navigation bridge after an internal route drops query parameters', () => {
        window.history.replaceState(
            null,
            '',
            '/?storefrontPreviewEmbedded=1&storefrontPreviewAuth=authenticated&storefrontPreviewSession=fixture-session',
        );
        const navigate = vi.fn();
        render({ storefrontContextValue: { navigate } });
        window.history.replaceState(null, '', '/checkout');
        render({ storefrontContextValue: { navigate }, displayedRoute: { name: 'checkout' } });
        act(() => {
            window.dispatchEvent(
                new MessageEvent('message', {
                    origin: window.location.origin,
                    data: {
                        type: 'storefront-preview-navigate',
                        route: 'account',
                        session: 'fixture-session',
                    },
                }),
            );
        });
        expect(navigate).toHaveBeenCalledWith({ name: 'account', id: undefined, tab: undefined }, true);
    });
    it('retains the actual authentication host on locale changes and releases it on background changes', () => {
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(0), 0),
        );
        vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
        const closeAuthOverlay = vi.fn();
        const runtime = { authOverlay: { mode: 'login' }, closeAuthOverlay };
        render({ displayedRoute: { name: 'home', publicLanguage: 'zh' }, storefrontContextValue: runtime });
        const input = document.querySelector<HTMLInputElement>('[name=retained-auth-draft]');
        expect(input).not.toBeNull();
        if (!input) throw new Error('Missing fixture authentication input');
        input.value = 'fixture@example.invalid';
        render({
            language: 'en',
            isZh: false,
            displayedRoute: { name: 'home', publicLanguage: 'en' },
            storefrontContextValue: { ...runtime, storefrontCode: '' },
        });
        expect(document.querySelector('[name=retained-auth-draft]')).toBe(input);
        expect(closeAuthOverlay).not.toHaveBeenCalled();
        render({
            language: 'en',
            isZh: false,
            displayedRoute: { name: 'home', publicLanguage: 'en' },
            storefrontContextValue: runtime,
        });
        expect(document.querySelector('[name=retained-auth-draft]')).toBe(input);
        expect(input.value).toBe('fixture@example.invalid');
        expect(closeAuthOverlay).not.toHaveBeenCalled();
        render({
            language: 'en',
            isZh: false,
            displayedRoute: { name: 'services', publicLanguage: 'en' },
            storefrontContextValue: runtime,
        });
        expect(document.querySelector('[name=retained-auth-draft]')).toBeNull();
        expect(closeAuthOverlay).toHaveBeenCalledOnce();
    });
    it.each([false, true])(
        'retains the real recharge draft while translated brand data is pending (desktop=%s)',
        async desktop => {
            viewport.desktop = desktop;
            rechargeRoute.active = true;
            const api = {
                request: vi.fn().mockResolvedValue({
                    gptRechargeConfig: { enabled: true, maintenance: false },
                }),
            };
            const present = (language: 'zh' | 'en', storefrontCode: string, currencyCode = 'MYR') =>
                render({
                    language,
                    isZh: language === 'zh',
                    displayedRoute: { name: 'gpt-recharge' },
                    pageDataPending: !storefrontCode,
                    storefrontContextValue: {
                        api,
                        language,
                        storefrontCode,
                        market: { code: 'fixture-store', currencyCode },
                        displayCurrencyCode: currencyCode,
                        availableCurrencyCodes: [currencyCode],
                        collections: [],
                        contentBlocks: [],
                    },
                });
            present('zh', 'fixture-store');
            await act(async () => {
                await Promise.resolve();
            });
            const input = element.querySelector<HTMLInputElement>('#gpt-code');
            expect(input).not.toBeNull();
            if (!input) throw new Error('Expected real recharge input');
            const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            act(() => {
                descriptor?.set?.call(input, 'synthetic-shell-draft');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            for (const [language, storefrontCode] of [
                ['en', ''],
                ['en', 'fixture-store'],
                ['zh', ''],
                ['zh', 'fixture-store'],
            ] as const) {
                present(language, storefrontCode);
                expect(element.querySelector('#gpt-code')).toBe(input);
                expect(input.value).toBe('synthetic-shell-draft');
            }
            present('zh', 'fixture-store', 'CNY');
            expect(element.querySelector<HTMLInputElement>('#gpt-code')?.value).toBe('');
            expect(
                api.request.mock.calls.every(([query]) => query.startsWith('query GptRechargeConfig')),
            ).toBe(true);
        },
    );
});

describe('deferred enhancement recovery ownership', () => {
    type EnhancementModule = { trackStorefrontEnhancements: () => () => void };
    function pendingLoad() {
        let resolve!: (module: EnhancementModule) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<EnhancementModule>((accept, fail) => {
            resolve = accept;
            reject = fail;
        });
        return { promise, resolve, reject };
    }
    async function settle() {
        for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    }
    let online: boolean;
    let dispose: (() => void) | undefined;
    beforeEach(() => {
        online = true;
        vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    });
    afterEach(() => {
        dispose?.();
        dispose = undefined;
        vi.restoreAllMocks();
    });
    function reconnect() {
        online = false;
        window.dispatchEvent(new Event('offline'));
        online = true;
        window.dispatchEvent(new Event('online'));
    }

    it('consumes one reconnect received during a failed load and installs only once', async () => {
        const first = pendingLoad();
        const second = pendingLoad();
        const uninstall = vi.fn();
        const install = vi.fn(() => uninstall);
        const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        dispose = mountStorefrontEnhancements(load);
        reconnect();
        first.reject(new TypeError('Old offline request failed after reconnect'));
        await settle();
        expect(load).toHaveBeenCalledTimes(2);
        second.resolve({ trackStorefrontEnhancements: install });
        await settle();
        reconnect();
        expect(load).toHaveBeenCalledTimes(2);
        expect(install).toHaveBeenCalledOnce();
        dispose();
        dispose = undefined;
        expect(uninstall).toHaveBeenCalledOnce();
    });

    it('does not automatically loop after the one reconnect retry also fails', async () => {
        const first = pendingLoad();
        const second = pendingLoad();
        const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        dispose = mountStorefrontEnhancements(load);
        reconnect();
        first.reject(new TypeError('First failed load'));
        await settle();
        expect(load).toHaveBeenCalledTimes(2);
        second.reject(new TypeError('Retry failed'));
        await settle();
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('waits for an explicit reconnect after a failure with no queued recovery intent', async () => {
        const first = pendingLoad();
        const load = vi.fn().mockReturnValue(first.promise);
        dispose = mountStorefrontEnhancements(load);
        first.reject(new TypeError('No network transition'));
        await settle();
        expect(load).toHaveBeenCalledOnce();
    });

    it.each(['resolve', 'reject'] as const)(
        'ignores a late %s after its mount owner is removed',
        async result => {
            const first = pendingLoad();
            const install = vi.fn(() => vi.fn());
            const load = vi.fn().mockReturnValue(first.promise);
            dispose = mountStorefrontEnhancements(load);
            reconnect();
            dispose();
            dispose = undefined;
            if (result === 'resolve') first.resolve({ trackStorefrontEnhancements: install });
            else first.reject(new TypeError('Owner already removed'));
            await settle();
            reconnect();
            expect(load).toHaveBeenCalledOnce();
            expect(install).not.toHaveBeenCalled();
        },
    );
});
