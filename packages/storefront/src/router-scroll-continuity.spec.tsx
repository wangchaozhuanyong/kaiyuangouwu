// @vitest-environment jsdom
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { useStorefrontScrollContinuity } from './hooks/useStorefrontScrollContinuity';
import { createStorefrontScrollRestorationKey } from './storefront-router';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom runs in Node, but this regression exercises the browser implementation.
vi.mock('@tanstack/router-core/isServer', () => ({ isServer: false }));

it.each([
    { initial: 0, lateReset: false },
    { initial: 400, lateReset: false },
    { initial: 400, lateReset: true },
])(
    'keeps the current TanStack cache at $initial with late target reset $lateReset',
    async ({ initial, lateReset }) => {
        let y = 0;
        let finish!: () => void;
        const slow = new Promise<void>(resolve => {
            finish = resolve;
        });
        vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
        vi.spyOn(window, 'scrollTo').mockImplementation((options: ScrollToOptions | number) => {
            y = typeof options === 'object' ? (options.top ?? 0) : 0;
        });
        const rootRoute = createRootRoute({
            component: () => {
                useStorefrontScrollContinuity();
                return (
                    <main>
                        <Outlet />
                    </main>
                );
            },
        });
        const routes = rootRoute.addChildren([
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/a',
                component: () => <article>Source</article>,
            }),
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/b',
                loader: () => slow,
                component: () => <article>Target</article>,
            }),
        ]);
        const scroll = createStorefrontScrollRestorationKey(() => router.state);
        const router = createRouter({
            routeTree: routes,
            history: createMemoryHistory({ initialEntries: ['/a'] }),
            defaultPendingMs: Infinity,
            scrollRestoration: true,
            getScrollRestorationKey: location => scroll.getKey(location),
        });
        const unlisten = router.subscribe('onLoad', event => {
            scroll.commit(event.toLocation);
            if (lateReset && event.toLocation.pathname === '/b') {
                // The target has committed to Router, before React cleans up
                // the source listener. A queued reset must not overwrite it.
                y = 0;
                document.dispatchEvent(new Event('scroll'));
            }
        });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const scrollTo = async (position: number) =>
            act(async () => {
                y = position;
                document.dispatchEvent(new Event('scroll'));
                await new Promise(resolve => setTimeout(resolve, 120));
            });
        try {
            await act(async () => {
                await router.load();
                root.render(<RouterProvider router={router} />);
            });
            if (initial) await scrollTo(initial);
            let navigation: Promise<void> | undefined;
            await act(async () => {
                navigation = router.navigate({ to: '/b' } as never);
                await Promise.resolve();
            });
            expect(host.textContent).toBe('Source');
            await scrollTo(800);
            await act(async () => {
                finish();
                await navigation;
            });
            expect(host.textContent).toBe('Target');
            expect(y).toBe(0);
            await scrollTo(250);
            await act(async () => {
                router.history.back();
                await new Promise(resolve => setTimeout(resolve, 20));
            });
            expect(host.textContent).toBe('Source');
            expect(y).toBe(800);
        } finally {
            finish();
            unlisten();
            act(() => root.unmount());
            host.remove();
            vi.restoreAllMocks();
        }
    },
);
