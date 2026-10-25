import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
    authOverlayForNavigation,
    isAuthOverlayMode,
    readAuthOverlay,
    type AuthOverlayMode,
    type AuthOverlayRequest,
} from '../auth-overlay-navigation';
import {
    catalogRouteSearch,
    catalogRouteState,
    resolveCategoryRoute,
    type CatalogRouteState,
} from '../catalog-route-query';
import { categoryTargetSelection } from '../category-navigation';
import { internalContentRoute } from '../content-target-href';
import { goBackInStorefront, returnToStorefrontRoute } from '../storefront-navigation-history';
import {
    routeFromHash,
    routeFromRouterLocation,
    routeHref,
    routeNavigateOptions,
    RouteState,
} from '../storefront-router';
import {
    StorefrontContentTargetType,
    type CollectionSummary,
    type Product,
    type StorefrontContentBlock,
} from '../types';

export function useStorefrontNavigation({
    collections,
    contentBlocks = [],
    products = [],
    prepareProduct,
    authenticated = true,
}: {
    collections: CollectionSummary[];
    contentBlocks?: StorefrontContentBlock[];
    products?: Product[];
    prepareProduct?: (id: string) => Promise<void>;
    authenticated?: boolean;
}) {
    const router = useRouter();

    const tanstackNavigate = useNavigate();
    const navigationIntent = useRef(0);
    const mediaContext = useRef({ contentBlocks, products });
    mediaContext.current = { contentBlocks, products };
    useEffect(() => {
        const unsubscribe = router.subscribe('onBeforeNavigate', () => navigationIntent.current++);
        const unsubscribeLoad = router.subscribe('onBeforeLoad', () => navigationIntent.current++);
        let active = true;
        let removeHints: (() => void) | undefined;
        void import('../storefront-navigation-hints')
            .then(({ installNavigationHints }) => {
                if (active) removeHints = installNavigationHints(mediaContext);
            })
            .catch(() => undefined);
        return () => {
            active = false;
            navigationIntent.current++;
            unsubscribe();
            unsubscribeLoad();
            removeHints?.();
        };
    }, [router]);

    const routerLocation = useRouterState({ select: state => state.location });
    const authOverlay = readAuthOverlay(routerLocation.search);

    const isNavigationPending = useRouterState({ select: state => state.status === 'pending' });

    // Keep content, selected navigation and action callbacks on the published match
    // while the next destination prepares. The latest URL can already point ahead;
    // resolvedLocation can still lag behind the destination's actual commit.
    const presentedMatch = useRouterState({ select: state => state.matches.at(-1) });
    const displayedRouterLocation = presentedMatch ?? routerLocation;
    const targetRoute = useMemo(
        () => routeFromRouterLocation(routerLocation.pathname, routerLocation.search),
        [routerLocation.pathname, routerLocation.search],
    );
    const resolvedTargetRoute = useMemo(
        () => resolveCategoryRoute(targetRoute, collections),
        [targetRoute, collections],
    );
    useEffect(() => {
        if (resolvedTargetRoute === targetRoute) return;
        const options = routeNavigateOptions(resolvedTargetRoute);
        const location = router.state.location;
        const replacement = {
            ...options,
            search: { ...routerLocation.search, ...options.search },
            replace: true,
            resetScroll: false,
        };
        // The category code is already mounted. Canonicalization does not need a
        // second preparation cycle, and may never replace a newer user destination.
        if (location === routerLocation) void tanstackNavigate(replacement as never);
    }, [resolvedTargetRoute, targetRoute, routerLocation.search, router, tanstackNavigate]);

    const route = useMemo(
        () =>
            resolveCategoryRoute(
                routeFromRouterLocation(displayedRouterLocation.pathname, displayedRouterLocation.search),
                collections,
            ),
        [displayedRouterLocation.pathname, displayedRouterLocation.search, collections],
    );
    const displayedRoute = route;

    // The URL is the rendering source of truth. This ref only remembers the last explicit
    // category URL so links returning from another route can preserve the user's filters.
    const categoryStateRef = useRef<CatalogRouteState>(catalogRouteSearch(route));
    const lastCategoryLocation = useRef('');
    if (route.name === 'category') {
        const routeLocation = routeHref(route);
        if (routeLocation !== lastCategoryLocation.current) {
            categoryStateRef.current = catalogRouteSearch(route);
            lastCategoryLocation.current = routeLocation;
        }
    }

    const visibleCategoryState = catalogRouteState(
        route.name === 'category' ? route : { name: 'category', ...categoryStateRef.current },
    );
    const activeCollectionId = visibleCategoryState.collectionId ?? 'all';
    const activeChildId = visibleCategoryState.childId ?? 'all';
    const sortMode = visibleCategoryState.sort ?? 'recommended';
    const fulfillmentFilter = visibleCategoryState.fulfillment ?? 'all';
    const inStockOnly = visibleCategoryState.inStockOnly === true;
    const minimumPrice = visibleCategoryState.minPrice ?? '';
    const maximumPrice = visibleCategoryState.maxPrice ?? '';

    const navigatePage = useCallback(
        (next: RouteState, replace = false) => {
            navigationIntent.current++;
            const resolvedNext = resolveCategoryRoute(
                next.name === 'category' ? { ...categoryStateRef.current, ...next } : next,
                collections,
            );
            if (resolvedNext.name === 'category') {
                categoryStateRef.current = catalogRouteSearch(resolvedNext);
            }
            // The router owns the latest navigation intent. Warm data in parallel;
            // a late response must never commit a second navigation or restart a click delay.
            if (resolvedNext.name === 'product' && resolvedNext.id) {
                const current = routeFromRouterLocation(
                    router.state.location.pathname,
                    router.state.location.search,
                );
                if (
                    routeHref(current) === routeHref(resolvedNext) &&
                    current.variantId === resolvedNext.variantId &&
                    !replace
                )
                    return;
                void prepareProduct?.(resolvedNext.id).catch(() => undefined);
            }
            void tanstackNavigate({
                ...routeNavigateOptions(resolvedNext),
                replace,
                ...(readAuthOverlay(router.state.location.search) &&
                routeHref(resolvedNext) ===
                    routeHref(
                        routeFromRouterLocation(router.state.location.pathname, router.state.location.search),
                    )
                    ? { resetScroll: false }
                    : {}),
            } as never);
        },
        [collections, prepareProduct, router, tanstackNavigate],
    );

    const applyAuthAction = useCallback(
        (request: AuthOverlayRequest | null, fallback: RouteState, replace = false) => {
            const intent = ++navigationIntent.current;
            const location = router.state.location;
            // A new action belongs to the page the customer can still see, not
            // an unfinished destination whose URL has already moved ahead.
            const background = request && isNavigationPending ? route : undefined;
            const isCurrent = () => navigationIntent.current === intent && router.state.location === location;
            void import('../auth-overlay-navigation-actions')
                .then(({ applyAuthOverlayNavigation }) => {
                    if (isCurrent())
                        applyAuthOverlayNavigation(
                            router,
                            tanstackNavigate,
                            request,
                            replace || !!background,
                            background,
                        );
                })
                .catch(() => {
                    // Preserve the existing standalone route if the optional action chunk fails to load.
                    if (isCurrent()) navigatePage(fallback, request ? replace : true);
                });
        },
        [navigatePage, router, tanstackNavigate, isNavigationPending, route],
    );

    const navigate = useCallback(
        (next: RouteState, replace = false) => {
            const location = router.state.location;
            const current = routeFromRouterLocation(location.pathname, location.search);
            const request = authOverlayForNavigation(next, authenticated);
            // Direct links and verification/reset flows keep their existing page fallback.
            if (
                request &&
                !isAuthOverlayMode(current.name) &&
                current.name !== 'reset-password' &&
                current.name !== 'verify-account'
            ) {
                applyAuthAction(request, next, replace);
                return;
            }
            navigatePage(next, replace);
        },
        [applyAuthAction, authenticated, navigatePage, router],
    );

    const changeAuthOverlay = useCallback(
        (mode: AuthOverlayMode) => navigate({ name: mode }, true),
        [navigate],
    );

    const closeAuthOverlay = useCallback(() => {
        const location = router.state.location;
        applyAuthAction(null, routeFromRouterLocation(location.pathname, location.search));
    }, [applyAuthAction, router]);

    const goBack = useCallback(() => {
        navigationIntent.current++;
        goBackInStorefront(router);
    }, [router]);

    const returnToRoute = useCallback(
        (target: RouteState) => {
            navigationIntent.current++;
            returnToStorefrontRoute(router, target);
        },
        [router],
    );

    const updateCategory = useCallback(
        (
            updates: Partial<
                Pick<
                    RouteState,
                    | 'collectionId'
                    | 'childId'
                    | 'sort'
                    | 'fulfillment'
                    | 'inStockOnly'
                    | 'minPrice'
                    | 'maxPrice'
                >
            >,
        ) => {
            const next = { ...categoryStateRef.current, ...updates, page: undefined };
            navigate({ name: 'category', ...next });
        },
        [navigate],
    );
    const openContentTarget = useCallback(
        (targetType: StorefrontContentTargetType, targetValue: string | null) => {
            const value = targetValue?.trim();
            if (targetType === 'NONE' || !value) return;
            if (targetType === 'PRODUCT') {
                navigate({ name: 'product', id: value });
                return;
            }
            if (targetType === 'COLLECTION' || targetType === 'CATEGORY') {
                const target = categoryTargetSelection(collections, value);
                navigate({ name: 'category', ...target });
                return;
            }
            if (targetType === 'SEARCH') {
                navigate({ name: 'search', term: value });
                return;
            }
            const internal = internalContentRoute(value);
            if (internal) {
                navigate(internal);
                return;
            }
            if (targetType === 'PAGE' && !/^(?:https?:)?\/\//iu.test(value)) {
                navigate(routeFromHash(value.startsWith('#') ? value : `#/${value.replace(/^\//, '')}`));
                return;
            }
            if (targetType === 'SUPPORT') {
                if (!/^(?:(?:https?:)?\/\/|mailto:|tel:)/i.test(value)) {
                    navigate({ name: 'support' });
                    return;
                }
            }
            if (/^\/(?!\/)|^(mailto:|tel:)/i.test(value)) {
                window.location.assign(value);
            } else {
                window.open(value, '_blank', 'noopener,noreferrer');
            }
        },
        [collections, navigate],
    );

    return {
        openContentTarget,
        route,
        displayedRoute,
        displayedRouterLocation,
        isNavigationPending,
        isPreparingProduct: false,
        activeCollectionId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice,
        maximumPrice,
        navigate,
        goBack,
        returnToRoute,
        updateCategory,
        authOverlay,
        changeAuthOverlay,
        closeAuthOverlay,
        navigateAfterAuthentication: navigatePage,
    };
}
