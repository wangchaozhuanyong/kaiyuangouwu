import {
    isPublicStorefrontPathname,
    publicLanguageFromUrl,
    publicLocalizedHref,
    publicUnlocalizedPathname,
} from '../../storefront-content-plugin/src/shared/public-page-data';

import { FulfillmentType, ProductSearchSort } from './types';

export type MainPage = 'home' | 'category' | 'services' | 'cart' | 'account';
export type RouteName =
    | MainPage
    | 'product'
    | 'guide'
    | 'search'
    | 'purchase'
    | 'checkout'
    | 'payment'
    | 'order-confirmation'
    | 'orders'
    | 'logistics'
    | 'order-detail'
    | 'addresses'
    | 'account-security'
    | 'favorites'
    | 'announcements'
    | 'history'
    | 'notifications'
    | 'coupons'
    | 'referral'
    | 'flash-sale'
    | 'recommendations'
    | 'support'
    | 'reviews'
    | 'image-studio'
    | 'two-factor'
    | 'mail-query'
    | 'gpt-recharge'
    | 'login'
    | 'register'
    | 'verify-account'
    | 'forgot-password'
    | 'reset-password'
    | 'legal'
    | 'not-found';

export type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'completed' | 'service';
export type SortMode = ProductSearchSort;
const checkoutRoutes = ['purchase', 'checkout', 'payment'] as const;
export type CheckoutRouteName = (typeof checkoutRoutes)[number];

export function isCheckoutRoute(name: string): name is CheckoutRouteName {
    return checkoutRoutes.includes(name as CheckoutRouteName);
}

export function routePageIdentity(route: RouteState): string {
    switch (route.name) {
        case 'product':
        case 'guide':
        case 'legal':
            return `${route.name}:${route.id ?? ''}`;
        case 'order-detail':
            return `order-detail:${route.id ?? route.orderCode ?? ''}`;
        case 'announcements':
            return `announcements:${route.id ?? 'list'}`;
        default:
            // Category, search and order filters keep the same page identity.
            return route.name;
    }
}

export interface RouteState {
    name: RouteName;
    publicLanguage?: 'zh' | 'en';
    returnTo?: CheckoutRouteName;
    source?: 'logistics' | 'logistics-detail';
    deliveryStatus?: 'all' | 'preparing' | 'transit' | 'delivered' | 'cancelled';
    addressId?: string;
    checkoutOrderId?: string;
    editAddress?: boolean;
    id?: string;
    quantity?: number;
    page?: number;
    variantId?: string;
    orderCode?: string;
    focus?: 'evaluation';
    tab?: OrderTab;
    token?: string;
    term?: string;
    collectionId?: string;
    childId?: string;
    sort?: SortMode;
    fulfillment?: 'all' | FulfillmentType;
    inStockOnly?: boolean;
    minPrice?: string;
    maxPrice?: string;
}

export const rootPages: MainPage[] = ['home', 'category', 'services', 'cart', 'account'];
export const orderTabs: OrderTab[] = ['all', 'pending', 'shipping', 'receiving', 'completed', 'service'];
export const cartResolvedRoutes: RouteName[] = ['cart', ...checkoutRoutes, 'coupons'];
export const customerResolvedRoutes: RouteName[] = [
    'account',
    ...cartResolvedRoutes,
    'referral',
    'orders',
    'logistics',
    'order-detail',
    'addresses',
    'account-security',
    'notifications',
    'reviews',
    'image-studio',
];

// Registration, path generation and enumeration retain one canonical route order.
export const storefrontRouteNames = [
    ...rootPages,
    'product',
    'guide',
    'search',
    ...checkoutRoutes,
    'order-confirmation',
    'orders',
    'logistics',
    'order-detail',
    'addresses',
    'account-security',
    'favorites',
    'announcements',
    'history',
    'notifications',
    'coupons',
    'referral',
    'flash-sale',
    'recommendations',
    'support',
    'reviews',
    'image-studio',
    'two-factor',
    'mail-query',
    'gpt-recharge',
    'login',
    'register',
    'verify-account',
    'forgot-password',
    'reset-password',
    'legal',
    'not-found',
] as const satisfies readonly RouteName[];

// Assigning the inferred keys to Record<RouteName, string> also checks that no route is omitted.
const routePaths: Record<RouteName, string> = Object.fromEntries(
    storefrontRouteNames.map(name => [
        name,
        name === 'home' ? '/' : name === 'guide' ? '/guides' : `/${name}`,
    ]),
) as Record<(typeof storefrontRouteNames)[number], string>;

const routeNamesByPath = new Map(Object.entries(routePaths).map(([name, path]) => [path, name as RouteName]));

export type StorefrontRouteSearch = Omit<RouteState, 'name'> & {
    __route?: string;
    __storefrontLanguage?: 'zh' | 'en';
    auth?: 'login' | 'register' | 'forgot-password';
    authTarget?: string;
};

export function routePath(name: RouteName): string {
    return routePaths[name];
}

interface ScrollRestorationLocation {
    href: string;
    pathname: string;
    state: { __TSR_key?: string };
}

const rootPagePaths = new Set(rootPages.map(routePath));

export function getStorefrontScrollRestorationKey(location: ScrollRestorationLocation): string {
    const path = publicUnlocalizedPathname(location.pathname);
    const pathname = path === '/' ? '/' : path.replace(/\/+$/, '');
    // Each category/filter navigation starts at the top; back restores that history entry.
    if (pathname === '/category') return location.state.__TSR_key ?? location.href;
    if (rootPagePaths.has(pathname)) return `root:${pathname}`;
    return location.state.__TSR_key ?? location.href;
}

/** Select the visible page's owner; TanStack remains the only scroll-position cache. */
export function createStorefrontScrollRestorationKey(
    readState: () => {
        isLoading: boolean;
        location?: ScrollRestorationLocation;
        resolvedLocation?: ScrollRestorationLocation;
    },
) {
    let displayed: ScrollRestorationLocation | undefined;
    const commit = (location: ScrollRestorationLocation) => {
        displayed = location;
    };
    return {
        commit,
        getKey(location: ScrollRestorationLocation): string {
            const state = readState();
            // isLoading clears in the same batch that publishes matches. status and
            // resolvedLocation may still describe the previous page at onRendered.
            if (!state.isLoading) {
                // Router also asks for the previous key during restoration. That
                // lookup must not move the displayed owner back to the old page.
                commit(state.location ?? location);
                return getStorefrontScrollRestorationKey(location);
            }
            return getStorefrontScrollRestorationKey(displayed ?? state.resolvedLocation ?? location);
        },
    };
}

export function routeSearch(route: RouteState): StorefrontRouteSearch {
    const { name: _name, publicLanguage, ...search } = route;
    const code = typeof window === 'undefined' ? undefined : publicLanguageFromUrl(window.location.pathname);
    const language = publicLanguage ?? (code === 'zh_Hans' ? 'zh' : code === 'en' ? 'en' : undefined);
    return {
        ...search,
        ...((route.name === 'guide' || isPublicStorefrontPathname(routePath(route.name))) && language
            ? { __storefrontLanguage: language }
            : {}),
    };
}

export function routeNavigateOptions(route: RouteState) {
    if (route.name === 'guide')
        return {
            to: '/guides/$slug',
            params: { slug: route.id ?? '' },
            search: routeSearch(route),
        };
    return {
        to: routePath(route.name),
        search: routeSearch(route),
    };
}

export function normalizeRouteSearch(search: Record<string, unknown>): StorefrontRouteSearch {
    const stringValue = (key: string) => {
        const value = search[key];
        if (typeof value === 'string') return value || undefined;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value === 'boolean') return String(value);
        return undefined;
    };
    const tab = stringValue('tab');
    const sort = stringValue('sort');
    const fulfillment = stringValue('fulfillment');
    const returnTo = stringValue('returnTo');
    const rawQuantity = stringValue('quantity');
    const quantity = rawQuantity && /^\d+$/.test(rawQuantity) ? Number(rawQuantity) : undefined;
    const focus = stringValue('focus');
    const page = Number(stringValue('page'));
    return {
        __route: stringValue('__route'),
        __storefrontLanguage:
            search.__storefrontLanguage === 'zh' || search.__storefrontLanguage === 'en'
                ? search.__storefrontLanguage
                : undefined,
        auth:
            search.auth === 'login' || search.auth === 'register' || search.auth === 'forgot-password'
                ? search.auth
                : undefined,
        authTarget: stringValue('authTarget'),
        returnTo: returnTo && isCheckoutRoute(returnTo) ? returnTo : undefined,
        source:
            search.source === 'logistics' || search.source === 'logistics-detail' ? search.source : undefined,
        deliveryStatus: ['all', 'preparing', 'transit', 'delivered', 'cancelled'].includes(
            String(search.deliveryStatus),
        )
            ? (search.deliveryStatus as RouteState['deliveryStatus'])
            : undefined,
        addressId: stringValue('addressId'),
        checkoutOrderId: stringValue('checkoutOrderId'),
        editAddress: search.editAddress === true || search.editAddress === 'true' || undefined,
        id: stringValue('id'),
        quantity: quantity && Number.isSafeInteger(quantity) && quantity > 0 ? quantity : undefined,
        page: Number.isSafeInteger(page) && page > 0 && page <= 1000000 ? page : undefined,
        variantId: stringValue('variantId'),
        orderCode: stringValue('orderCode'),
        focus: focus === 'evaluation' ? focus : undefined,
        tab: orderTabs.includes(tab as OrderTab) ? (tab as OrderTab) : undefined,
        token: stringValue('token'),
        term: stringValue('term'),
        collectionId: stringValue('collectionId') ?? stringValue('collection'),
        childId: stringValue('childId') ?? stringValue('child'),
        sort: ['recommended', 'sales', 'newest', 'name', 'price-asc', 'price-desc'].includes(sort ?? '')
            ? (sort as SortMode)
            : undefined,
        fulfillment: ['all', 'physical', 'digital'].includes(fulfillment ?? '')
            ? (fulfillment as 'all' | FulfillmentType)
            : undefined,
        inStockOnly:
            search.inStockOnly === true || search.inStockOnly === 'true' || search.stock === '1' || undefined,
        minPrice: stringValue('minPrice'),
        maxPrice: stringValue('maxPrice'),
    };
}

export function routeFromRouterLocation(pathname: string, search: Record<string, unknown>): RouteState {
    const languageCode = publicLanguageFromUrl(pathname);
    const path = publicUnlocalizedPathname(pathname);
    const normalizedPath = path === '/' ? '/' : path.replace(/\/+$/, '');
    const guide = /^\/guides\/[a-z0-9_-]{1,100}$/iu.test(normalizedPath);
    // Overlay state must not change the background page/query/readiness identity.
    const {
        auth: _auth,
        authTarget: _target,
        __storefrontLanguage,
        __route: _codePath,
        ...pageSearch
    } = normalizeRouteSearch(search);
    return {
        name: guide ? 'guide' : (routeNamesByPath.get(normalizedPath) ?? 'not-found'),
        ...(languageCode || __storefrontLanguage
            ? {
                  publicLanguage: languageCode === 'zh_Hans' ? 'zh' : (languageCode ?? __storefrontLanguage),
              }
            : {}),
        ...pageSearch,
        ...(guide ? { id: normalizedPath.slice('/guides/'.length) } : {}),
    };
}

export function routeFromHash(hash: string): RouteState {
    const raw = hash.replace(/^#\/?/, '');
    const [rawPath = '', query = ''] = raw.split('?');
    const legacyName = rawPath.replace(/^\/+|\/+$/g, '') || 'home';
    const pathname = legacyName === 'home' ? '/' : `/${legacyName}`;
    return routeFromRouterLocation(pathname, Object.fromEntries(new URLSearchParams(query)));
}

export function routeFromLocation(): RouteState {
    return routeFromRouterLocation(
        window.location.pathname,
        Object.fromEntries(new URLSearchParams(window.location.search)),
    );
}

export function routeHref(route: RouteState): string {
    const params = new URLSearchParams();
    const search = routeSearch(route);
    // Preserve parameter order, omission rules and URLSearchParams coercion.
    for (const key of [
        'returnTo',
        'source',
        'deliveryStatus',
        'addressId',
        'checkoutOrderId',
        'editAddress',
        'id',
        'quantity',
        'page',
        'orderCode',
        'focus',
        'tab',
        'token',
        'term',
        'collectionId',
        'childId',
        'sort',
        'fulfillment',
        'inStockOnly',
        'minPrice',
        'maxPrice',
    ] as const) {
        const value = search[key];
        if (
            value &&
            !(key === 'id' && route.name === 'guide') &&
            !(key === 'sort' && value === 'recommended') &&
            !(key === 'fulfillment' && value === 'all')
        ) {
            params.set(
                key,
                key === 'editAddress' || key === 'inStockOnly'
                    ? 'true'
                    : key === 'quantity' || key === 'page'
                      ? String(value)
                      : (value as string),
            );
        }
    }
    const code = route.publicLanguage === 'zh' ? 'zh_Hans' : route.publicLanguage;
    const locationCode =
        typeof window === 'undefined' ? undefined : publicLanguageFromUrl(window.location.pathname);
    const languageCode = code ?? locationCode;
    const plainPath =
        route.name === 'guide' ? `/guides/${encodeURIComponent(route.id ?? '')}` : routePath(route.name);
    const path = languageCode ? publicLocalizedHref(plainPath, languageCode) : plainPath;
    return `${path}${params.size ? `?${params.toString()}` : ''}`;
}

export function routeHash(route: RouteState): string {
    return `#${routeHref(route)}`;
}
