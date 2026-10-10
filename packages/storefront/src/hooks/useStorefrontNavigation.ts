import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
    authOverlayForNavigation,
    isAuthOverlayMode,
    readAuthOverlay,
    type AuthOverlayMode,
    type AuthOverlayRequest,
} from '../auth-overlay-navigation';
import { catalogRouteSearch, catalogRouteState, type CatalogRouteState } from '../catalog-route-query';
import { categoryTargetSelection } from '../category-navigation';
import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { preloadRouteMedia } from '../route-media-preload';
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
        const prepare = (next: RouteState) => {
            void preloadStorefrontRouteComponent(next.name);
            preloadRouteMedia(next, mediaContext.current.contentBlocks, mediaContext.current.products);
        };
        const unsubscribe = router.subscribe('onBeforeNavigate', event => {
            navigationIntent.current++;
            prepare(routeFromRouterLocation(event.toLocation.pathname, event.toLocation.search));
        });
        const unsubscribeLoad = router.subscribe('onBeforeLoad', () => navigationIntent.current++);
        const onIntent = (event: Event) => {
            const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
            if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== window.location.origin) return;
            prepare(
                routeFromRouterLocation(
                    anchor.pathname,
                    Object.fromEntries(new URLSearchParams(anchor.search)),
                ),
            );
        };
        document.addEventListener('pointerover', onIntent);
        document.addEventListener('focusin', onIntent);
        document.addEventListener('pointerdown', onIntent);
        return () => {
            navigationIntent.current++;
            unsubscribe();
            unsubscribeLoad();
            document.removeEventListener('pointerover', onIntent);
            document.removeEventListener('focusin', onIntent);
            document.removeEventListener('pointerdown', onIntent);
        };
    }, [router]);

    const routerLocation = useRouterState({ select: state => state.location });
    const authOverlay = readAuthOverlay(routerLocation.search);

    const isNavigationPending = useRouterState({ select: state => state.status === 'pending' });

    const resolvedRouterLocation = useRouterState({ select: state => state.resolvedLocation });

    const displayedRouterLocation =
        isNavigationPending && resolvedRouterLocation ? resolvedRouterLocation : routerLocation;

    const route = useMemo(
        () =>
            routeFromRouterLocation(
                routerLocation.pathname,
                routerLocation.search as Record<string, unknown>,
            ),
        [routerLocation.pathname, routerLocation.search],
    );

    const displayedRoute = useMemo(
        () =>
            routeFromRouterLocation(
                displayedRouterLocation.pathname,
                displayedRouterLocation.search as Record<string, unknown>,
            ),
        [displayedRouterLocation.pathname, displayedRouterLocation.search],
    );

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
            const resolvedNext = next.name === 'category' ? { ...categoryStateRef.current, ...next } : next;
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
        [prepareProduct, router, tanstackNavigate],
    );

    const applyAuthAction = useCallback(
        (request: AuthOverlayRequest | null, fallback: RouteState, replace = false) => {
            const intent = ++navigationIntent.current;
            const location = router.state.location;
            const isCurrent = () => navigationIntent.current === intent && router.state.location === location;
            void import('../auth-overlay-navigation-actions')
                .then(({ applyAuthOverlayNavigation }) => {
                    if (isCurrent()) applyAuthOverlayNavigation(router, tanstackNavigate, request, replace);
                })
                .catch(() => {
                    // Preserve the existing standalone route if the optional action chunk fails to load.
                    if (isCurrent()) navigatePage(fallback, request ? replace : true);
                });
        },
        [navigatePage, router, tanstackNavigate],
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
            if (targetType === 'PAGE') {
                navigate(routeFromHash(value.startsWith('#') ? value : `#/${value.replace(/^\//, '')}`));
                return;
            }
            if (targetType === 'SUPPORT') {
                if (value === '/support' || value === 'support' || value === '#/support') {
                    navigate({ name: 'support' });
                } else if (/^(mailto:|tel:)/i.test(value)) {
                    window.location.assign(value);
                } else if (/^https?:\/\//i.test(value)) {
                    window.open(value, '_blank', 'noopener,noreferrer');
                } else {
                    navigate({ name: 'support' });
                }
                return;
            }
            if (value.startsWith('#/')) {
                navigate(routeFromHash(value));
            } else if (value.startsWith('/')) {
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
