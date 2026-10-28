// @vitest-environment jsdom
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    Outlet,
    RouterProvider,
} from '@tanstack/react-router';
import { act, useLayoutEffect, useState } from 'react';
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
    { initial: 400, lateReset: false, immediatePending: true },
])(
    'keeps the current TanStack cache at $initial with late target reset $lateReset',
    async ({ initial, lateReset, immediatePending }) => {
        let y = 0;
        let finish!: () => void;
        const slow = new Promise<void>(resolve => {
            finish = resolve;
        });
        vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
        vi.spyOn(window, 'scrollTo').mockImplementation((options: ScrollToOptions | number) => {
            y = typeof options === 'object' ? (options.top ?? 0) : 0;
        });
        function PendingTarget() {
            useLayoutEffect(() => {
                // A shorter destination can clamp window scroll before Router onLoad.
                y = 0;
                document.dispatchEvent(new Event('scroll'));
            }, []);
            return <article>Preparing target</article>;
        }
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
                pendingComponent: PendingTarget,
                component: () => <article>Target</article>,
            }),
        ]);
        const scroll = createStorefrontScrollRestorationKey(() => router.state);
        const router = createRouter({
            routeTree: routes,
            history: createMemoryHistory({ initialEntries: ['/a'] }),
            defaultPendingMs: immediatePending ? 0 : Infinity,
            defaultPendingMinMs: 0,
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
            if (immediatePending) {
                await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
                expect(host.textContent).toBe('Preparing target');
                await scrollTo(0);
            } else {
                expect(host.textContent).toBe('Source');
                await scrollTo(800);
            }
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
            expect(y).toBe(immediatePending ? initial : 800);
        } finally {
            finish();
            unlisten();
            act(() => root.unmount());
            host.remove();
            vi.restoreAllMocks();
        }
    },
);

it.each(['restore', 'interaction', 'superseded', 'leave-pending'] as const)(
    'preserves a recent source scroll and handles pending-0 history back: %s',
    async outcome => {
        let y = 0;
        let maximum = 2000;
        let homeRead: Promise<void> | undefined;
        let homeQueryPending = false;
        let finishHome!: () => void;
        let finishHomeQuery: (() => void) | undefined;
        let finishDetail!: () => void;
        const detailRead = new Promise<void>(resolve => {
            finishDetail = resolve;
        });
        vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
        vi.spyOn(window, 'scrollTo').mockImplementation((options: ScrollToOptions | number) => {
            y = Math.min(maximum, typeof options === 'object' ? (options.top ?? 0) : 0);
        });
        function Body({ name }: { name: string }) {
            useLayoutEffect(() => {
                maximum = 2000;
                document.dispatchEvent(new Event('storefront:page-ready'));
            }, []);
            return <article>{name}</article>;
        }
        function ShortSkeleton() {
            useLayoutEffect(() => {
                // A real browser clamps scroll when the long page is replaced.
                maximum = 0;
                y = 0;
                document.dispatchEvent(new Event('scroll'));
            }, []);
            return <article>Short pending body</article>;
        }
        function HomeBody() {
            const [ready, setReady] = useState(!homeQueryPending);
            useLayoutEffect(() => {
                finishHomeQuery = () => setReady(true);
            }, []);
            return ready ? <Body name="Source" /> : <ShortSkeleton />;
        }
        const rootRoute = createRootRoute({
            component: () => {
                useStorefrontScrollContinuity();
                return <Outlet />;
            },
        });
        const routes = rootRoute.addChildren([
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/a',
                loader: () => homeRead,
                component: HomeBody,
            }),
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/b',
                loader: () => detailRead,
                component: () => <Body name="Detail" />,
            }),
            createRoute({
                getParentRoute: () => rootRoute,
                path: '/c',
                component: () => <Body name="Latest" />,
            }),
        ]);
        const scroll = createStorefrontScrollRestorationKey(() => router.state);
        const router = createRouter({
            routeTree: routes,
            history: createMemoryHistory({ initialEntries: ['/a'] }),
            defaultPendingMs: 0,
            defaultPendingMinMs: 0,
            defaultPendingComponent: ShortSkeleton,
            scrollRestoration: true,
            getScrollRestorationKey: location => scroll.getKey(location),
        });
        const unsubscribe = router.subscribe('onLoad', event => scroll.commit(event.toLocation));
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const wait = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
        const visibleText = () =>
            Array.from(host.querySelectorAll('article'))
                .filter(element => !element.closest('[style*="display: none"]'))
                .map(element => element.textContent)
                .join('');
        try {
            await act(async () => {
                await router.load();
                root.render(<RouterProvider router={router} />);
            });
            const homeLocation = router.state.location;
            // The source can disappear before the next browser scroll event.
            y = 500;
            document.dispatchEvent(new Event('scroll'));
            let navigation: Promise<void> | undefined;
            await act(async () => {
                navigation = router.navigate({ to: '/b' } as never);
                await wait();
            });
            expect(visibleText()).toBe('Short pending body');
            expect(y).toBe(0);
            await act(() => wait(120));
            if (outcome === 'leave-pending') {
                await act(async () => {
                    await router.navigate({ to: '/c' } as never);
                    finishDetail();
                    await navigation;
                });
                expect(visibleText()).toBe('Latest');
                await act(async () => {
                    router.history.go(-2);
                    await wait();
                });
                expect(visibleText()).toBe('Source');
                expect(y).toBe(500);
                return;
            }
            await act(async () => {
                finishDetail();
                await navigation;
            });
            expect(visibleText()).toBe('Detail');
            homeRead = new Promise<void>(resolve => {
                finishHome = resolve;
            });
            homeQueryPending = true;
            router.clearCache();
            await act(async () => {
                router.history.back();
                await wait();
            });
            expect(router.state.location.state.__TSR_key).toBe(homeLocation.state.__TSR_key);
            expect(visibleText()).toBe('Short pending body');
            expect(y).toBe(0);
            await act(() => wait(120));
            if (outcome === 'interaction') document.dispatchEvent(new Event('wheel'));
            if (outcome === 'superseded')
                await act(async () => {
                    await router.navigate({ to: '/c' } as never);
                });
            await act(async () => {
                finishHome();
                await wait();
            });
            if (outcome !== 'superseded') {
                // Route code has committed and Router restored against a short
                // query skeleton. Only the body's ready event can finish it.
                expect(visibleText()).toBe('Short pending body');
                expect(y).toBe(0);
                act(() => {
                    finishHomeQuery?.();
                });
            }
            expect(visibleText()).toBe(outcome === 'superseded' ? 'Latest' : 'Source');
            expect(y).toBe(outcome === 'restore' ? 500 : 0);
            // Later readiness notifications must not replay the completed intent.
            y = 25;
            document.dispatchEvent(new Event('storefront:page-ready'));
            expect(y).toBe(25);
        } finally {
            finishDetail();
            finishHome?.();
            unsubscribe();
            act(() => root.unmount());
            host.remove();
            vi.restoreAllMocks();
        }
    },
);
