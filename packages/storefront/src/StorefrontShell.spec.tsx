// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorefrontShell } from './StorefrontShell';

vi.mock('@tanstack/react-router', () => ({
    Outlet: () => <div>PRIVATE_CATALOG_CONTENT</div>,
    lazyRouteComponent: () => () => <div>SIGN_IN_FORM</div>,
}));
vi.mock('./components/common/bottom-navigation', () => ({
    BottomNavigation: () => <div>CATALOG_NAVIGATION</div>,
    shouldShowBottomNavigation: () => true,
}));
vi.mock('./StorefrontUpdatePrompt', () => ({ StorefrontUpdatePrompt: () => null }));
vi.mock('./route-loading', () => ({ RouteTransitionLoader: () => <div>CHECKING_ACCOUNT</div> }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('catalog rendering boundary', () => {
    let element: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    beforeEach(() => {
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
        render({ customerLoadState: 'loading' });
        expect(element.textContent).toContain('CHECKING_ACCOUNT');
        expect(element.textContent).not.toContain('PRIVATE_CATALOG_CONTENT');
    });
    it('renders sign-in for an anonymous direct product URL', () => {
        render({ displayedRoute: { name: 'product', id: '1' } });
        expect(element.textContent).toContain('SIGN_IN_FORM');
        expect(element.textContent).not.toContain('PRIVATE_CATALOG_CONTENT');
        expect(element.textContent).not.toContain('CATALOG_NAVIGATION');
    });
    it('removes an authenticated catalog immediately after logout', () => {
        render({ customer: { id: 'customer-a' } });
        expect(element.textContent).toContain('PRIVATE_CATALOG_CONTENT');
        render();
        expect(element.textContent).not.toContain('PRIVATE_CATALOG_CONTENT');
        expect(element.textContent).toContain('SIGN_IN_FORM');
    });
    it('fails closed when account validation fails and preserves a retry', () => {
        render({ customerLoadState: 'error', customerLoadError: 'ACCOUNT_UNAVAILABLE' });
        expect(element.querySelector('[role="alert"]')?.textContent).toContain('ACCOUNT_UNAVAILABLE');
        expect(element.textContent).not.toContain('PRIVATE_CATALOG_CONTENT');
        expect(element.querySelector('button')).not.toBeNull();
    });
    it('keeps public policy pages available before login', () => {
        render({ displayedRoute: { name: 'legal', id: 'privacy' } });
        expect(element.textContent).toContain('PRIVATE_CATALOG_CONTENT');
        expect(element.textContent).not.toContain('CATALOG_NAVIGATION');
    });
});
