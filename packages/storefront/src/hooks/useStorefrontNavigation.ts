import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { categoryTargetSelection } from '../category-navigation';
import {
    routeFromHash,
    routeFromRouterLocation,
    routePath,
    routeSearch,
    RouteState,
    SortMode,
} from '../storefront-router';
import { FulfillmentType, StorefrontContentTargetType, type CollectionSummary } from '../types';
export function useStorefrontNavigation({ collections }: { collections: CollectionSummary[] }) {
    const router = useRouter();

    const tanstackNavigate = useNavigate();

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

    const [activeCollectionId, setActiveCollectionId] = useState(() => route.collectionId ?? 'all');

    const [activeChildId, setActiveChildId] = useState(() => route.childId ?? 'all');

    const [sortMode, setSortMode] = useState<SortMode>(() => route.sort ?? 'recommended');

    const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | FulfillmentType>(
        () => route.fulfillment ?? 'all',
    );

    const [inStockOnly, setInStockOnly] = useState(() => route.inStockOnly === true);

    const [minimumPrice, setMinimumPrice] = useState(() => route.minPrice ?? '');

    const [maximumPrice, setMaximumPrice] = useState(() => route.maxPrice ?? '');

    const categoryStateRef = useRef<
        Pick<
            RouteState,
            'collectionId' | 'childId' | 'sort' | 'fulfillment' | 'inStockOnly' | 'minPrice' | 'maxPrice'
        >
    >({});

    categoryStateRef.current = {
        collectionId: activeCollectionId === 'all' ? undefined : activeCollectionId,
        childId: activeChildId === 'all' ? undefined : activeChildId,
        sort: sortMode,
        fulfillment: fulfillmentFilter,
        inStockOnly,
        minPrice: minimumPrice || undefined,
        maxPrice: maximumPrice || undefined,
    };

    const navigate = useCallback(
        (next: RouteState, replace = false) => {
            const resolvedNext = next.name === 'category' ? { ...categoryStateRef.current, ...next } : next;
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

    useEffect(() => {
        if (route.name !== 'category') return;
        setActiveCollectionId(route.collectionId ?? 'all');
        setActiveChildId(route.childId ?? 'all');
        setSortMode(route.sort ?? 'recommended');
        setFulfillmentFilter(route.fulfillment ?? 'all');
        setInStockOnly(route.inStockOnly === true);
        setMinimumPrice(route.minPrice ?? '');
        setMaximumPrice(route.maxPrice ?? '');
    }, [route]);

    useEffect(() => {
        if (activeCollectionId === 'all' && collections.length) {
            setActiveCollectionId(collections[0].id);
            setActiveChildId(collections[0].children?.[0]?.id ?? collections[0].id);
        }
    }, [activeCollectionId, collections]);

    useEffect(() => {
        if (route.name !== 'category') return;
        setActiveCollectionId(route.collectionId ?? collections[0]?.id ?? 'all');
        setActiveChildId(route.childId ?? collections[0]?.children?.[0]?.id ?? collections[0]?.id ?? 'all');
        setSortMode(route.sort ?? 'recommended');
        setFulfillmentFilter(route.fulfillment ?? 'all');
        setInStockOnly(route.inStockOnly === true);
        setMinimumPrice(route.minPrice ?? '');
        setMaximumPrice(route.maxPrice ?? '');
    }, [collections, route]);

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
            setActiveCollectionId(next.collectionId ?? 'all');
            setActiveChildId(next.childId ?? 'all');
            setSortMode(next.sort ?? 'recommended');
            setFulfillmentFilter(next.fulfillment ?? 'all');
            setInStockOnly(next.inStockOnly === true);
            setMinimumPrice(next.minPrice ?? '');
            setMaximumPrice(next.maxPrice ?? '');
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
                setActiveCollectionId(target.collectionId);
                setActiveChildId(target.childId);
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
        setActiveCollectionId,
        setActiveChildId,
        activeChildId,
        sortMode,
        fulfillmentFilter,
        inStockOnly,
        minimumPrice,
        maximumPrice,
        setMinimumPrice,
        setMaximumPrice,
        navigate,
        goBack,
        updateCategory,
    };
}
