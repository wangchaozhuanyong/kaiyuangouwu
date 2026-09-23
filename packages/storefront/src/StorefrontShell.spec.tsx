// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontShell } from './StorefrontShell';

const viewport = vi.hoisted(() => ({ desktop: false }));
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
    Outlet: () => <div>PAGE_CONTENT</div>,
    lazyRouteComponent: () => () => <div>SIGN_IN_FORM</div>,
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
    afterEach(() => act(() => root.unmount()));
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
            ...overrides,
        };
        act(() => root.render(<StorefrontShell state={state as never} />));
    };
    it('never mounts catalog content while account validation is pending', () => {
        render({ displayedRoute: { name: 'orders' }, customerLoadState: 'loading' });
        expect(element.textContent).toContain('CATALOG_SKELETON');
        expect(element.textContent).not.toContain('CHECKING_ACCOUNT');
        expect(element.textContent).not.toContain('PAGE_CONTENT');
    });
    it('renders the product for an anonymous direct product URL', () => {
        render({ displayedRoute: { name: 'product', id: '1' } });
        expect(element.textContent).not.toContain('SIGN_IN_FORM');
        expect(element.textContent).toContain('PAGE_CONTENT');
        expect(element.textContent).toContain('CATALOG_NAVIGATION');
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
        expect(navigate).toHaveBeenCalledWith({ name: 'account', id: undefined }, true);
    });
});
