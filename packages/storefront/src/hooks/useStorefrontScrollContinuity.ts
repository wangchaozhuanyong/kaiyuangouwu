import { useElementScrollRestoration, useRouter, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect } from 'react';

const catalogSelector = '[data-scroll-restoration-id="category-results"]';

/** Keep TanStack's existing entries current while their page remains on screen. */
export function useStorefrontScrollContinuity() {
    const router = useRouter();
    const pending = useRouterState({ select: state => (state.isLoading ? state.location : null) });
    const displayed = router.state.matches.at(-1);
    const getKey = router.options.getScrollRestorationKey;
    const viewport = useElementScrollRestoration({ getElement: () => window, getKey });
    const catalog = useElementScrollRestoration({ id: 'category-results', getKey });

    useLayoutEffect(
        () =>
            router.subscribe('onBeforeNavigate', () => {
                // Register both existing restoration targets before Router snapshots
                // them, including a page that has not yet been scrolled. These events
                // do not move anything and do not invent navigation/lifecycle events.
                document.dispatchEvent(new Event('scroll'));
                document.querySelector(catalogSelector)?.dispatchEvent(new Event('scroll'));
            }),
        [router],
    );

    useLayoutEffect(() => {
        if (!pending) return;
        const update = (event: Event) => {
            if (!router.state.isLoading || router.state.matches.at(-1) !== displayed) return;
            if (event.target === document && viewport) {
                viewport.scrollX = window.scrollX;
                viewport.scrollY = window.scrollY;
            } else if (
                event.target instanceof HTMLElement &&
                event.target.matches(catalogSelector) &&
                catalog
            ) {
                catalog.scrollX = event.target.scrollLeft;
                catalog.scrollY = event.target.scrollTop;
            }
        };
        document.addEventListener('scroll', update, true);
        return () => document.removeEventListener('scroll', update, true);
    }, [router, pending, displayed, viewport, catalog]);
}
