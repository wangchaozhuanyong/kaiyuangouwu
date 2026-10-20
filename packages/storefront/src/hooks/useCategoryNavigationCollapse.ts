import { useRouter } from '@tanstack/react-router';
import { type RefObject, useLayoutEffect, useRef, useState } from 'react';

import { getStorefrontNavigationEntryPresentation } from '../storefront-navigation-history';

type Controller = ReturnType<typeof import('../category-navigation-collapse').bindCategoryNavigationCollapse>;

/** Only the product scroller owns this mobile presentation; catalog queries stay untouched. */
export function useCategoryNavigationCollapse(
    resultsRef: RefObject<HTMLElement | null>,
    scope: string,
    freeze: boolean,
    forceExpanded: boolean,
) {
    const router = useRouter({ warn: false });
    const viewportRef = useRef<HTMLDivElement>(null);
    const navigationRef = useRef<HTMLDivElement>(null);
    const [collapsed, setCollapsed] = useState(false);
    const locks = useRef({ freeze, forceExpanded });
    locks.current = { freeze, forceExpanded };
    const control = useRef<Controller | null>(null);
    useLayoutEffect(() => {
        const root = resultsRef.current;
        const viewport = viewportRef.current;
        const navigation = navigationRef.current;
        if (!root || !viewport || !navigation || typeof window.matchMedia !== 'function') return;
        let active = true;
        let loading = false;
        const mobile = window.matchMedia('(max-width: 1023px)');
        const displayedEntry = () =>
            router &&
            getStorefrontNavigationEntryPresentation(
                router.history,
                router.options.getScrollRestorationKey?.(router.state.location),
            );
        const saved = displayedEntry()?.categoryNavigation;
        const restoreCollapsed = mobile.matches && saved?.scope === scope && saved.collapsed === true;
        setCollapsed(restoreCollapsed);
        viewport.style.height = restoreCollapsed ? '0px' : '';
        navigation.style.transform = restoreCollapsed ? 'translateY(-100%)' : '';
        const start = () => {
            if (!mobile.matches || control.current || loading) return;
            loading = true;
            void import('../category-navigation-collapse')
                .then(({ bindCategoryNavigationCollapse }) => {
                    if (!active) return;
                    control.current = bindCategoryNavigationCollapse({
                        root,
                        viewport,
                        navigation,
                        initialCollapsed: restoreCollapsed,
                        onRemember: value => {
                            const entry = displayedEntry();
                            if (entry) entry.categoryNavigation = { scope, collapsed: value };
                        },
                        getLocks: () => locks.current,
                        onCollapsed: setCollapsed,
                    });
                })
                .catch(() => {
                    if (!active) return;
                    // Essential catalog controls remain available if optional motion cannot load.
                    setCollapsed(false);
                    viewport.style.height = '';
                    navigation.style.transform = '';
                })
                .finally(() => {
                    loading = false;
                });
        };
        start();
        mobile.addEventListener?.('change', start);
        return () => {
            active = false;
            mobile.removeEventListener?.('change', start);
            control.current?.dispose();
            control.current = null;
        };
    }, [resultsRef, scope, router]);
    useLayoutEffect(() => {
        control.current?.synchronize();
    }, [freeze, forceExpanded]);
    return { collapsed, viewportRef, navigationRef };
}
