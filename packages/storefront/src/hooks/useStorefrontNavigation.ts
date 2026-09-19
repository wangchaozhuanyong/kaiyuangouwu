import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { catalogRouteSearch, catalogRouteState, type CatalogRouteState } from '../catalog-route-query';
import { categoryTargetSelection } from '../category-navigation';
import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { preloadRouteMedia } from '../route-media-preload';
import {
    routeFromHash,
    routeFromRouterLocation,
    routeHref,
    routePath,
    routeSearch,
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
}: {
    collections: CollectionSummary[];
    contentBlocks?: StorefrontContentBlock[];
    products?: Product[];
}) {
    const router = useRouter();

    const tanstackNavigate = useNavigate();
    const mediaContext = useRef({ contentBlocks, products });
    mediaContext.current = { contentBlocks, products };
    useEffect(() => {
        const prepare = (next: RouteState) => {
            void preloadStorefrontRouteComponent(next.name);
            preloadRouteMedia(next, mediaContext.current.contentBlocks, mediaContext.current.products);
        };
        const unsubscribe = router.subscribe('onBeforeNavigate', event => {
            prepare(routeFromRouterLocation(event.toLocation.pathname, event.toLocation.search));
        });
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
            unsubscribe();
            document.removeEventListener('pointerover', onIntent);
            document.removeEventListener('focusin', onIntent);
            document.removeEventListener('pointerdown', onIntent);
        };
    }, [router]);

    const routerLocation = useRouterState({ select: state => state.location });

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

    const navigate = useCallback(
        (next: RouteState, replace = false) => {
            const resolvedNext = next.name === 'category' ? { ...categoryStateRef.current, ...next } : next;
            if (resolvedNext.name === 'category') {
                categoryStateRef.current = catalogRouteSearch(resolvedNext);
            }
            void tanstackNavigate({
                to: routePath(resolvedNext.name),
                search: routeSearch(resolvedNext),
                replace,
            } as never);
        },
        [tanstackNavigate],
    );

    const goBack = useCallback(() => {
        if (window.history.length > 1) router.history.back();
        else navigate({ name: 'home' }, true);
    }, [navigate, router.history]);

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
            const next = { ...categoryStateRef.current, ...updates };
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
        activeCollectionId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice,
        maximumPrice,
        navigate,
        goBack,
        updateCategory,
    };
}
