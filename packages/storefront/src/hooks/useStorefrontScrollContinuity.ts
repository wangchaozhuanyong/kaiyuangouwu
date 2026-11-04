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
    const destination = {
        key: router.state.location.state.__TSR_key,
        viewport: targetViewport,
        catalog: targetCatalog,
    };
    const target = useRef(destination);
    target.current = destination;

    useLayoutEffect(() => {
        const lastMatch = () => router.state.matches.at(-1);
        const initialLocation = router.state.location;
        // Router may render before an asynchronous body exposes the document anchor.
        let initialHash =
            initialLocation.hash &&
            initialLocation.state.__hashScrollIntoViewOptions !== false &&
            !document.getElementById(initialLocation.hash)
                ? initialLocation.hash
                : undefined;
        let requested = initialHash && initialLocation.state.__TSR_key;
        const before = router.subscribe('onBeforeNavigate', event => {
            initialHash = undefined;
            sourceMatch.current = lastMatch()?.id;
            requested = event.toLocation.state.__TSR_key;
            // The installed Router snapshots tracked targets synchronously at
            // onBeforeLoad. Register them before that snapshot, including zero.
            document.dispatchEvent(new Event('scroll'));
            document.querySelector(catalogSelector)?.dispatchEvent(new Event('scroll'));
        });
        const cancel = () => {
            const { viewport: targetViewportEntry, catalog: targetCatalogEntry } = target.current;
            if (
                requested &&
                requested === target.current.key &&
                lastMatch()?.pathname === router.state.location.pathname
            ) {
                // An interaction on the target supersedes both our supplement
                // and a Router restore that is still waiting for route code.
                if (targetViewportEntry)
                    Object.assign(targetViewportEntry, {
                        scrollX: window.scrollX,
                        scrollY: window.scrollY,
                    });
                const element = document.querySelector<HTMLElement>(catalogSelector);
                if (element && targetCatalogEntry)
                    Object.assign(targetCatalogEntry, {
                        scrollX: element.scrollLeft,
                        scrollY: element.scrollTop,
                    });
            }
            requested = undefined;
        };
        const ready = () => {
            const match = lastMatch();
            if (
                !requested ||
                requested !== target.current.key ||
                match?.pathname !== router.state.location.pathname ||
                match?.status !== 'success'
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
            else if (initialHash) document.getElementById(initialHash)?.scrollIntoView();
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
