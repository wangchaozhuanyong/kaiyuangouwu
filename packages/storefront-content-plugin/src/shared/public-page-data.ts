import type { PublicGuideContent, PublicSeoDocument } from './public-seo';
import type { MediaDescriptor } from './responsive-image';

export type PublicPageCatalogInput = {
    term?: string;
    collectionId?: string;
    sort?: 'RECOMMENDED' | 'SALES' | 'NEWEST' | 'NAME' | 'PRICE_ASC' | 'PRICE_DESC';
    fulfillmentType?: 'PHYSICAL' | 'DIGITAL';
    inStockOnly?: boolean;
    minPriceWithTax?: number;
    maxPriceWithTax?: number;
    skip?: number;
    take?: number;
};
export type PublicPageRequest =
    | { kind: 'home' }
    | { kind: 'catalog'; input: PublicPageCatalogInput; path?: '/category' | '/search' }
    | { kind: 'product'; id: string }
    | { kind: 'article'; id: string }
    | { kind: 'page'; id: 'services' | 'support' | 'terms' | 'privacy' };

const publicId = /^[a-z0-9_-]{1,100}$/iu;
const publicSorts = ['RECOMMENDED', 'SALES', 'NEWEST', 'NAME', 'PRICE_ASC', 'PRICE_DESC'] as const;
const routeSorts = ['recommended', 'sales', 'newest', 'name', 'price-asc', 'price-desc'] as const;

export type PublicStorefrontLanguageCode = 'zh_Hans' | 'en';
const publicStorefrontPaths = new Set([
    '/',
    '/home',
    '/product',
    '/category',
    '/search',
    '/services',
    '/support',
    '/announcements',
    '/legal',
    '/promo',
    '/flash-sale',
    '/recommendations',
]);

/** Language prefixes apply only to public content, never account or checkout routes. */
export function publicLanguageFromUrl(pathAndSearch: string): PublicStorefrontLanguageCode | undefined {
    const match = /^\/(zh|en)(?:\/|\?|$)/u.exec(pathAndSearch);
    if (!match) return;
    const pathname = pathAndSearch.split(/[?#]/u, 1)[0];
    const unprefixed = pathname.slice(match[1].length + 1) || '/';
    if (
        !publicStorefrontPaths.has(unprefixed === '/' ? '/' : unprefixed.replace(/\/+$/u, '')) &&
        !/^\/guides\/[a-z0-9_-]{1,100}\/?$/iu.test(unprefixed)
    )
        return;
    return match[1] === 'zh' ? 'zh_Hans' : 'en';
}

export function publicUnlocalizedPathname(pathname: string): string {
    return publicLanguageFromUrl(pathname) ? pathname.replace(/^\/(zh|en)(?=\/|$)/u, '') || '/' : pathname;
}

export function isPublicStorefrontPathname(pathname: string): boolean {
    const path = publicUnlocalizedPathname(pathname);
    return (
        publicStorefrontPaths.has(path === '/' ? '/' : path.replace(/\/+$/u, '')) ||
        /^\/guides\/[a-z0-9_-]{1,100}\/?$/iu.test(path)
    );
}

export function publicLocalizedHref(
    pathAndSearch: string,
    languageCode: PublicStorefrontLanguageCode,
): string {
    if (!pathAndSearch.startsWith('/') || pathAndSearch.startsWith('//') || /[\\\r\n]/u.test(pathAndSearch))
        throw new Error('Invalid public location');
    const url = new URL(pathAndSearch, 'https://storefront.invalid');
    if (!isPublicStorefrontPathname(url.pathname)) return pathAndSearch;
    const pathname = publicUnlocalizedPathname(url.pathname);
    url.pathname = `/${languageCode === 'zh_Hans' ? 'zh' : 'en'}${pathname === '/home' ? '/' : pathname}`;
    return url.pathname + url.search + url.hash;
}

/** One deterministic identity for SSI, early browser reads and navigation. No private route inputs. */
export function canonicalPublicPageRequest(value: PublicPageRequest): PublicPageRequest {
    if (value.kind === 'home') return { kind: 'home' };
    if (value.kind === 'page') {
        if (!['services', 'support', 'terms', 'privacy'].includes(value.id))
            throw new Error('Invalid public page');
        return { kind: 'page', id: value.id };
    }
    if (value.kind === 'product' || value.kind === 'article') {
        if (typeof value.id !== 'string' || !publicId.test(value.id))
            throw new Error('Invalid public product');
        return { kind: value.kind, id: value.id };
    }
    if (
        value.kind !== 'catalog' ||
        !value.input ||
        typeof value.input !== 'object' ||
        Array.isArray(value.input)
    )
        throw new Error('Invalid public catalog');
    if (value.path != null && value.path !== '/category' && value.path !== '/search')
        throw new Error('Invalid public catalog route');
    const raw = value.input;
    const input: PublicPageCatalogInput = {};
    if (raw.term != null) {
        if (typeof raw.term !== 'string' || raw.term.length > 200) throw new Error('Invalid public search');
        if (raw.term.trim()) input.term = raw.term.trim();
    }
    if (raw.collectionId != null) {
        if (typeof raw.collectionId !== 'string' || !publicId.test(raw.collectionId))
            throw new Error('Invalid public collection');
        input.collectionId = raw.collectionId;
    }
    if (raw.sort != null && !publicSorts.includes(raw.sort)) throw new Error('Invalid public sort');
    input.sort = raw.sort ?? 'RECOMMENDED';
    if (raw.fulfillmentType != null) {
        if (raw.fulfillmentType !== 'PHYSICAL' && raw.fulfillmentType !== 'DIGITAL')
            throw new Error('Invalid public fulfillment');
        input.fulfillmentType = raw.fulfillmentType;
    }
    if (raw.inStockOnly != null && typeof raw.inStockOnly !== 'boolean')
        throw new Error('Invalid public stock filter');
    input.inStockOnly = raw.inStockOnly === true;
    for (const key of ['minPriceWithTax', 'maxPriceWithTax', 'skip', 'take'] as const) {
        const number = raw[key] ?? (key === 'skip' ? 0 : key === 'take' ? 12 : undefined);
        if (number == null) continue;
        if (
            !Number.isSafeInteger(number) ||
            number < 0 ||
            (key === 'take' && (number < 1 || number > 48)) ||
            (key === 'skip' && number > 100_000)
        )
            throw new Error('Invalid public pagination or price');
        input[key] = number;
    }
    return { kind: 'catalog', path: value.path ?? '/category', input };
}

export function publicPageRequestKey(request: PublicPageRequest): string {
    return JSON.stringify(canonicalPublicPageRequest(request));
}

/** Parse only a relative public location. Account tokens and unrelated query parameters are discarded. */
export function publicPageRequestFromUrl(
    pathAndSearch: string,
    options: { take?: number } = {},
): PublicPageRequest | undefined {
    if (
        !pathAndSearch.startsWith('/') ||
        pathAndSearch.startsWith('//') ||
        pathAndSearch.length > 4096 ||
        /[\\\r\n]/u.test(pathAndSearch)
    )
        return;
    const url = new URL(pathAndSearch, 'https://storefront.invalid');
    if (url.origin !== 'https://storefront.invalid') return;
    const rawPathname = publicUnlocalizedPathname(url.pathname);
    const pathname = rawPathname === '/' ? '/' : rawPathname.replace(/\/+$/u, '');
    if (pathname === '/' || pathname === '/home') return { kind: 'home' };
    const article = /^\/guides\/([a-z0-9_-]{1,100})\/?$/iu.exec(pathname);
    if (article) return { kind: 'article', id: article[1] };
    if (pathname === '/services' || pathname === '/support')
        return { kind: 'page', id: pathname.slice(1) as 'services' | 'support' };
    if (pathname === '/legal') {
        const id = url.searchParams.get('id');
        if (id !== 'terms' && id !== 'privacy') throw new Error('Invalid public legal page');
        return { kind: 'page', id };
    }
    if (pathname === '/product') {
        return canonicalPublicPageRequest({ kind: 'product', id: url.searchParams.get('id') ?? '' });
    }
    if (pathname !== '/category' && pathname !== '/search') return;
    const query = url.searchParams;
    const child = query.get('childId') || query.get('child');
    const collection =
        child && child !== 'all' ? child : query.get('collectionId') || query.get('collection');
    const routeSort = query.get('sort') ?? 'recommended';
    const sortIndex = (routeSorts as readonly string[]).indexOf(routeSort);
    if (sortIndex < 0) throw new Error('Invalid public sort');
    const fulfillment = query.get('fulfillment');
    if (fulfillment && !['all', 'physical', 'digital'].includes(fulfillment))
        throw new Error('Invalid public fulfillment');
    const price = (key: string) => {
        const value = query.get(key);
        if (!value?.trim()) return undefined;
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) throw new Error('Invalid public price');
        return Math.round(number * 100);
    };
    const rawTake = query.get('take');
    const take = rawTake === null ? (options.take ?? 12) : Number(rawTake);
    if (!Number.isSafeInteger(take) || take < 1 || take > 48) throw new Error('Invalid public pagination');
    const rawPage = query.get('page');
    const page = rawPage === null ? 1 : Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 1 || (page - 1) * take > 100_000)
        throw new Error('Invalid public pagination');
    const rawSkip = query.get('skip');
    const skip = rawSkip === null ? (page - 1) * take : Number(rawSkip);
    if (
        !Number.isSafeInteger(skip) ||
        skip < 0 ||
        skip > 100_000 ||
        (rawSkip !== null && rawPage !== null && skip !== (page - 1) * take)
    )
        throw new Error('Invalid public pagination');
    return canonicalPublicPageRequest({
        kind: 'catalog',
        path: pathname,
        input: {
            term: query.get('term') ?? undefined,
            collectionId: collection && collection !== 'all' ? collection : undefined,
            sort: publicSorts[sortIndex],
            fulfillmentType:
                fulfillment === 'physical' ? 'PHYSICAL' : fulfillment === 'digital' ? 'DIGITAL' : undefined,
            inStockOnly: query.get('inStockOnly') === 'true' || query.get('stock') === '1',
            minPriceWithTax: price('minPrice'),
            maxPriceWithTax: price('maxPrice'),
            skip,
            take,
        },
    });
}

export function publicPageRouteHref(value: PublicPageRequest): string {
    const request = canonicalPublicPageRequest(value);
    if (request.kind === 'home') return '/';
    if (request.kind === 'product') return `/product?id=${encodeURIComponent(request.id)}`;
    if (request.kind === 'article') return `/guides/${encodeURIComponent(request.id)}`;
    if (request.kind === 'page')
        return request.id === 'terms' || request.id === 'privacy'
            ? `/legal?id=${request.id}`
            : `/${request.id}`;
    const query = new URLSearchParams();
    const input = request.input;
    if (input.term) query.set('term', input.term);
    if (input.collectionId) query.set('collectionId', input.collectionId);
    if (input.sort && input.sort !== 'RECOMMENDED')
        query.set('sort', routeSorts[publicSorts.indexOf(input.sort)]);
    if (input.fulfillmentType) query.set('fulfillment', input.fulfillmentType.toLowerCase());
    if (input.inStockOnly) query.set('inStockOnly', 'true');
    if (input.minPriceWithTax != null) query.set('minPrice', String(input.minPriceWithTax / 100));
    if (input.maxPriceWithTax != null) query.set('maxPrice', String(input.maxPriceWithTax / 100));
    const take = input.take ?? 12;
    const skip = input.skip ?? 0;
    if (take === 12 && skip % take === 0) {
        if (skip) query.set('page', String(skip / take + 1));
    } else {
        if (skip) query.set('skip', String(skip));
        query.set('take', String(take));
    }
    return `${request.path ?? '/category'}${query.size ? `?${query}` : ''}`;
}

export function publicPageDataSearchParams(
    value: PublicPageRequest,
    scope: { languageCode?: string; currencyCode?: string } = {},
): URLSearchParams {
    const request = canonicalPublicPageRequest(value);
    const parameters = new URLSearchParams({ kind: request.kind });
    if (request.kind === 'product' || request.kind === 'article' || request.kind === 'page')
        parameters.set('id', request.id);
    if (request.kind === 'catalog') {
        parameters.set('path', request.path ?? '/category');
        parameters.set('input', JSON.stringify(request.input));
    }
    if (scope.languageCode) parameters.set('languageCode', scope.languageCode);
    if (scope.currencyCode) parameters.set('currencyCode', scope.currencyCode);
    return parameters;
}

/** Shared navigation visibility; a configured image keeps an otherwise empty category visible. */
export interface PublicNavigationCollection {
    id?: string;
    productVariantCount?: number | null;
    featuredAsset?: { preview?: string | null } | null;
    children?: PublicNavigationCollection[] | null;
}

export function storefrontNavigationCollections<T extends PublicNavigationCollection>(items: T[]): T[] {
    const visible = (item: PublicNavigationCollection) =>
        item.productVariantCount == null ||
        item.productVariantCount > 0 ||
        Boolean(item.featuredAsset?.preview?.trim());
    return items
        .map(item => ({ ...item, children: (item.children ?? []).filter(visible) }))
        .filter(item => visible(item) || item.children.length > 0);
}

/** Public data only. Neither sessions nor Channel tokens belong in this contract. */
export interface StorefrontPageData<
    Config = unknown,
    Content = unknown,
    Product = unknown,
    Collection = unknown,
> {
    seo?: PublicSeoDocument;
    publicContent?: PublicGuideContent;
    schemaVersion: 1;
    version: string;
    generatedAt: number;
    scope: {
        host: string;
        channelCode: string;
        languageCode: string;
        currencyCode: string;
        priceContext: 'public';
    };
    route: string;
    /** Additive v1 fields: absent only on older deployments. */
    request?: PublicPageRequest;
    requestKey?: string;
    config: Config;
    content?: Content;
    products?: Product[];
    flashSales?: unknown[];
    catalog?: { items: Product[]; totalItems: number };
    product?: Product | null;
    collections?: Collection[];
    visualPreset?: { presetId: string };
    media: MediaDescriptor[];
    failures: Array<'content' | 'products' | 'collections' | 'visualPreset' | 'flashSales'>;
}

export const STOREFRONT_PAGE_DATA_ELEMENT_ID = 'storefront-public-page-data';

/** Preview responses can be viewed for the current request, but cannot become shared snapshots. */
export function isReusablePublicPageData(page: { config?: unknown } | null | undefined): boolean {
    return (page?.config as { accessMode?: unknown } | undefined)?.accessMode === 'LIVE';
}

/** An inert JSON script must also escape HTML parser terminators, not only JSON quotes. */
export function serializeStorefrontPageData(data: StorefrontPageData): string {
    return JSON.stringify(data).replace(
        /[<>&\u2028\u2029]/gu,
        value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
}
