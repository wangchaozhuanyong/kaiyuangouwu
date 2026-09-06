import { FulfillmentType, ProductSearchSort } from './types';

export type MainPage = 'home' | 'category' | 'services' | 'cart' | 'account';
export type RouteName =
    | MainPage
    | 'product'
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
    | 'login'
    | 'register'
    | 'verify-account'
    | 'forgot-password'
    | 'reset-password'
    | 'legal'
    | 'not-found';
export type OrderTab = 'all' | 'pending' | 'shipping' | 'receiving' | 'service';
export type SortMode = ProductSearchSort;

export interface RouteState {
    name: RouteName;
    id?: string;
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
export const orderTabs: OrderTab[] = ['all', 'pending', 'shipping', 'receiving', 'service'];
export const customerResolvedRoutes: RouteName[] = [
    'account',
    'cart',
    'purchase',
    'checkout',
    'payment',
    'coupons',
    'referral',
    'orders',
    'logistics',
    'order-detail',
    'addresses',
    'account-security',
    'notifications',
    'reviews',
    'image-studio',
    'two-factor',
];
export const cartResolvedRoutes: RouteName[] = ['cart', 'purchase', 'checkout', 'payment', 'coupons'];

const routePaths: Record<RouteName, string> = {
    home: '/',
    category: '/category',
    services: '/services',
    cart: '/cart',
    account: '/account',
    product: '/product',
    search: '/search',
    purchase: '/purchase',
    checkout: '/checkout',
    payment: '/payment',
    'order-confirmation': '/order-confirmation',
    orders: '/orders',
    logistics: '/logistics',
    'order-detail': '/order-detail',
    addresses: '/addresses',
    'account-security': '/account-security',
    favorites: '/favorites',
    announcements: '/announcements',
    history: '/history',
    notifications: '/notifications',
    coupons: '/coupons',
    referral: '/referral',
    'flash-sale': '/flash-sale',
    recommendations: '/recommendations',
    support: '/support',
    reviews: '/reviews',
    'image-studio': '/image-studio',
    'two-factor': '/two-factor',
    login: '/login',
    register: '/register',
    'verify-account': '/verify-account',
    'forgot-password': '/forgot-password',
    'reset-password': '/reset-password',
    legal: '/legal',
    'not-found': '/not-found',
};

const routeNamesByPath = new Map(Object.entries(routePaths).map(([name, path]) => [path, name as RouteName]));

export type StorefrontRouteSearch = Omit<RouteState, 'name'>;

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
    const pathname = location.pathname === '/' ? '/' : location.pathname.replace(/\/+$/, '');
    // Each category/filter navigation starts at the top; back restores that history entry.
    if (pathname === '/category') return location.state.__TSR_key ?? location.href;
    if (rootPagePaths.has(pathname)) return `root:${pathname}`;
    return location.state.__TSR_key ?? location.href;
}

export function routeSearch(route: RouteState): StorefrontRouteSearch {
    const { name: _name, ...search } = route;
    return search;
}

export function routeNavigateOptions(route: RouteState) {
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
    return {
        id: stringValue('id'),
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
    const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
    return {
        name: routeNamesByPath.get(normalizedPath) ?? 'not-found',
        ...normalizeRouteSearch(search),
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
    if (search.id) params.set('id', search.id);
    if (search.tab) params.set('tab', search.tab);
    if (search.token) params.set('token', search.token);
    if (search.term) params.set('term', search.term);
    if (search.collectionId) params.set('collectionId', search.collectionId);
    if (search.childId) params.set('childId', search.childId);
    if (search.sort && search.sort !== 'recommended') params.set('sort', search.sort);
    if (search.fulfillment && search.fulfillment !== 'all') params.set('fulfillment', search.fulfillment);
    if (search.inStockOnly) params.set('inStockOnly', 'true');
    if (search.minPrice) params.set('minPrice', search.minPrice);
    if (search.maxPrice) params.set('maxPrice', search.maxPrice);
    const path = routePath(route.name);
    return `${path}${params.size ? `?${params.toString()}` : ''}`;
}

export function routeHash(route: RouteState): string {
    return `#${routeHref(route)}`;
}
