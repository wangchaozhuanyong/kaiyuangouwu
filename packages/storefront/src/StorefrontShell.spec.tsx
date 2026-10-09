// @vitest-environment jsdom
import { act, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontContext } from './StorefrontContext';
import { StorefrontShell } from './StorefrontShell';

const viewport = vi.hoisted(() => ({ desktop: false }));
const deferredModules = vi.hoisted(() => ({ updates: 0, privacy: 0 }));
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
vi.mock('./components/common/desktop-account-navigation', () => ({
    DesktopAccountNavigation: () => <div>DESKTOP_ACCOUNT_NAVIGATION</div>,
    isDesktopAccountRoute: () => true,
}));
vi.mock('@tanstack/react-router', () => ({
    Outlet: () => {
        const context = useContext(StorefrontContext);
        return (
            <div>
                PAGE_CONTENT <span data-testid="address-count">{context?.customer?.addresses?.length}</span>
            </div>
        );
    },
    lazyRouteComponent: (_loader: unknown, name: string) =>
        name === 'LoginRoutePage' ? () => <div>SIGN_IN_FORM</div> : () => <div>LAZY_SHELL_CONTENT</div>,
}));
vi.mock('./components/common/bottom-navigation', () => ({
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
    beforeEach(() => {
        window.history.replaceState(null, '', '/');
        viewport.desktop = false;
        element = document.createElement('div');
        root = createRoot(element);
    });
    afterEach(() => {
        act(() => root.unmount());
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
        act(() => root.render(<StorefrontShell state={state as never} />));
    };
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
    it('requests neither deferred module before readiness and idle, and hides update UI on sensitive routes', async () => {
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
        expect(deferredModules.privacy).toBe(0);
        act(() => {
            document.dispatchEvent(new Event('storefront:page-ready'));
        });
        expect(deferredModules.updates).toBe(0);
        expect(deferredModules.privacy).toBe(0);
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
});
