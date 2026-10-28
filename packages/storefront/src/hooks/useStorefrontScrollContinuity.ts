import { useElementScrollRestoration, useRouter, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';

import { getStorefrontScrollRestorationKey } from '../storefront-router';

const catalogSelector = '[data-scroll-restoration-id="category-results"]';

/** Keep TanStack's entries current without letting a target skeleton rewrite its source. */
export function useStorefrontScrollContinuity() {
    const router = useRouter();
    const pending = useRouterState({ select: state => (state.isLoading ? state.location : null) });
    const sourceMatch = useRef<string | undefined>(undefined);
    const getKey = router.options.getScrollRestorationKey;
    const viewport = useElementScrollRestoration({ getElement: () => window, getKey });
    const catalog = useElementScrollRestoration({ id: 'category-results', getKey });
    // Read the destination's existing entries even while the displayed-owner key
    // still belongs to the source. These are references to the same Router cache.
    const targetViewport = useElementScrollRestoration({
        getElement: () => window,
        getKey: getStorefrontScrollRestorationKey,
    });
    const targetCatalog = useElementScrollRestoration({
        id: 'category-results',
        getKey: getStorefrontScrollRestorationKey,
    });
    const target = useRef({
        key: router.state.location.state.__TSR_key,
        viewport: targetViewport,
        catalog: targetCatalog,
    });
    target.current = {
        key: router.state.location.state.__TSR_key,
        viewport: targetViewport,
        catalog: targetCatalog,
    };

    useLayoutEffect(() => {
        let requested: string | undefined;
        const before = router.subscribe('onBeforeNavigate', event => {
            sourceMatch.current = router.state.matches.at(-1)?.id;
            requested = event.toLocation.state.__TSR_key;
            // The installed Router snapshots tracked targets synchronously at
            // onBeforeLoad. Register them before that snapshot, including zero.
            document.dispatchEvent(new Event('scroll'));
            document.querySelector(catalogSelector)?.dispatchEvent(new Event('scroll'));
        });
        const cancel = () => {
            if (
                requested &&
                requested === target.current.key &&
                router.state.matches.at(-1)?.pathname === router.state.location.pathname
            ) {
                // An interaction on the target supersedes both our supplement
                // and a Router restore that is still waiting for route code.
                if (target.current.viewport)
                    Object.assign(target.current.viewport, {
                        scrollX: window.scrollX,
                        scrollY: window.scrollY,
                    });
                const element = document.querySelector<HTMLElement>(catalogSelector);
                if (element && target.current.catalog)
                    Object.assign(target.current.catalog, {
                        scrollX: element.scrollLeft,
                        scrollY: element.scrollTop,
                    });
            }
            requested = undefined;
        };
        const ready = () => {
            if (
                !requested ||
                requested !== target.current.key ||
                router.state.matches.at(-1)?.pathname !== router.state.location.pathname ||
                router.state.matches.at(-1)?.status !== 'success'
            )
                return;
            requested = undefined;
            const { viewport: targetViewportEntry, catalog: targetCatalogEntry } = target.current;
            if (targetViewportEntry)
                window.scrollTo({
                    left: targetViewportEntry.scrollX,
                    top: targetViewportEntry.scrollY,
                    behavior: 'instant',
                });
            const element = document.querySelector<HTMLElement>(catalogSelector);
            if (element && targetCatalogEntry) {
                element.scrollLeft = targetCatalogEntry.scrollX;
                element.scrollTop = targetCatalogEntry.scrollY;
            }
        };
        const interactions = ['pointerdown', 'wheel', 'touchstart', 'keydown'];
        interactions.forEach(type => document.addEventListener(type, cancel, { passive: true }));
        document.addEventListener('storefront:page-ready', ready);
        return () => {
            before();
            interactions.forEach(type => document.removeEventListener(type, cancel));
            document.removeEventListener('storefront:page-ready', ready);
        };
    }, [router]);

    useLayoutEffect(() => {
        if (!pending) return;
        const update = (event: Event) => {
            if (!router.state.isLoading || router.state.matches.at(-1)?.id !== sourceMatch.current) return;
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
    }, [router, pending, viewport, catalog]);
}
