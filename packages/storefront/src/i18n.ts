import { MarketConfig, StorefrontConfig, StorefrontLanguage, VendureLanguageCode } from './types';

export const markets: Record<string, MarketConfig> = {
    'cn-mainland': {
        code: 'cn-mainland',
        defaultLanguageCode: 'zh_Hans',
        currencyCode: 'CNY',
        countryCode: 'CN',
        locale: 'zh-CN',
        label: '中国大陆',
    },
    'my-malaysia': {
        code: 'my-malaysia',
        defaultLanguageCode: 'en',
        currencyCode: 'MYR',
        countryCode: 'MY',
        locale: 'en-MY',
        label: 'Malaysia',
    },
};

const configuredMarketCodes = (
    import.meta.env.VITE_MARKET_CODES ??
    import.meta.env.VITE_STOREFRONT_MARKETS ??
    'cn-mainland,my-malaysia'
)
    .split(',')
    .map((code: string) => code.trim())
    .filter(Boolean);

function fallbackMarket(code: string): MarketConfig {
    return (
        markets[code] ?? {
            code,
            defaultLanguageCode: 'en',
            currencyCode: 'USD',
            countryCode: 'US',
            locale: 'en-US',
            label: code,
        }
    );
}

export const enabledMarkets: MarketConfig[] = configuredMarketCodes.length
    ? configuredMarketCodes.map(fallbackMarket)
    : [markets['cn-mainland']];

export const supportedStorefrontLanguages = ['zh', 'en'] as const satisfies readonly StorefrontLanguage[];

export interface ManualStorefrontLanguagePreference {
    version: 2;
    source: 'manual';
    language: StorefrontLanguage;
}

export function languageFromPrimaryTag(
    languageTag: string | null | undefined,
    fallback: StorefrontLanguage = 'en',
): StorefrontLanguage {
    const normalized = languageTag?.trim();
    if (!normalized) return fallback;
    return /^zh(?:[-_]|$)/i.test(normalized) ? 'zh' : 'en';
}

export function detectSystemLanguage(fallback: StorefrontLanguage = 'en'): StorefrontLanguage {
    if (typeof navigator === 'undefined') return fallback;
    const primaryLanguage = navigator.language || navigator.languages?.[0];
    return languageFromPrimaryTag(primaryLanguage, fallback);
}

export function parseManualStorefrontLanguagePreference(
    value: string | null | undefined,
): StorefrontLanguage | null {
    if (!value) return null;
    try {
        const parsed = JSON.parse(value) as Partial<ManualStorefrontLanguagePreference>;
        return parsed.version === 2 &&
            parsed.source === 'manual' &&
            supportedStorefrontLanguages.includes(parsed.language as StorefrontLanguage)
            ? (parsed.language as StorefrontLanguage)
            : null;
    } catch {
        return null;
    }
}

export function serializeManualStorefrontLanguagePreference(language: StorefrontLanguage): string {
    return JSON.stringify({ version: 2, source: 'manual', language });
}

export function defaultStorefrontLanguageFor(market: MarketConfig): StorefrontLanguage {
    const marketFallback: StorefrontLanguage = market.defaultLanguageCode === 'en' ? 'en' : 'zh';
    return detectSystemLanguage(marketFallback);
}

export function resolveStorefrontLanguage(
    market: MarketConfig,
    storedLanguage: string | null | undefined,
): StorefrontLanguage {
    if (supportedStorefrontLanguages.includes(storedLanguage as StorefrontLanguage)) {
        return storedLanguage as StorefrontLanguage;
    }
    return defaultStorefrontLanguageFor(market);
}

export function marketForStorefrontConfig(
    config: StorefrontConfig,
    currentMarket?: MarketConfig,
): MarketConfig {
    const knownMarket = markets[config.code];
    const countryCode =
        knownMarket?.countryCode ??
        config.availableCountries[0]?.code?.toUpperCase() ??
        currentMarket?.countryCode ??
        'US';
    const defaultLanguageCode: VendureLanguageCode =
        config.defaultLanguageCode === 'zh_Hans' ? 'zh_Hans' : 'en';

    return {
        code: config.code,
        defaultLanguageCode,
        currencyCode: config.defaultCurrencyCode || knownMarket?.currencyCode || 'USD',
        countryCode,
        locale: defaultLanguageCode === 'zh_Hans' ? 'zh-CN' : localeForCountry(countryCode),
        label: knownMarket?.label ?? config.code,
    };
}

export function languageCodeFor(language: StorefrontLanguage): VendureLanguageCode {
    return language === 'zh' ? 'zh_Hans' : 'en';
}

export function localeFor(language: StorefrontLanguage, market: MarketConfig): string {
    if (language === 'zh') return 'zh-CN';
    if (market.code === 'cn-mainland') return 'en-US';
    return market.locale || localeForCountry(market.countryCode);
}

export function documentLanguageFor(language: StorefrontLanguage): 'zh-CN' | 'en' {
    return language === 'zh' ? 'zh-CN' : 'en';
}

function localeForCountry(countryCode: string): string {
    return /^[A-Z]{2}$/.test(countryCode) ? `en-${countryCode}` : 'en-US';
}

export const uiCopy = {
    zh: {
        home: '首页',
        products: '商品',
        cart: '购物车',
        account: '我的',
        search: '搜索商品、分类',
        retry: '重新加载',
        loading: '正在加载',
        loadError: '内容加载失败',
        emptyProducts: '暂时没有可售商品',
        emptyCart: '购物车还是空的',
        emptyCartHint: '去挑几件喜欢的商品吧',
        browse: '去逛商品',
        add: '加入购物车',
        buy: '立即购买',
        checkout: '结算',
        submitOrder: '提交订单',
        back: '返回',
        all: '全部',
        total: '合计',
        selected: '已选',
        selectAll: '全选',
        selectedAll: '已全选',
        order: '我的订单',
        login: '登录',
        guest: '登录后查看订单、地址与售后进度',
        noResults: '没有找到相关商品',
        noResultsHint: '换个关键词或查看其他分类',
        unavailable: '该功能暂未开通',
    },
    en: {
        home: 'Home',
        products: 'Shop',
        cart: 'Cart',
        account: 'Account',
        search: 'Search products and categories',
        retry: 'Try again',
        loading: 'Loading',
        loadError: 'Could not load content',
        emptyProducts: 'No products available yet',
        emptyCart: 'Your cart is empty',
        emptyCartHint: 'Browse the shop to add something',
        browse: 'Browse products',
        add: 'Add to cart',
        buy: 'Buy now',
        checkout: 'Checkout',
        submitOrder: 'Submit order',
        back: 'Back',
        all: 'All',
        total: 'Total',
        selected: 'Selected',
        selectAll: 'Select all',
        selectedAll: 'All selected',
        order: 'My orders',
        login: 'Sign in',
        guest: 'Sign in to view orders, addresses and support progress',
        noResults: 'No matching products',
        noResultsHint: 'Try another search or browse a category',
        unavailable: 'This feature is not available yet',
    },
} as const;

/**
 * Short, customer-facing labels for space-constrained navigation surfaces.
 * Keep these separate from API states and longer explanatory copy: compact UI
 * labels should be localized for the available space rather than translated word-for-word.
 */
export const compactUiCopy = {
    zh: {
        orders: {
            title: '我的订单',
            viewAll: '查看全部',
            all: '全部',
            unpaid: '待付款',
            processing: '待发货',
            shipped: '待收货',
            returns: '售后',
            due: '应付',
        },
        home: {
            catalog: '全部商品',
            featured: '本周精选',
            cart: '购物车',
            orders: '订单',
        },
        trust: {
            tracking: '订单可查',
            pricing: '价格透明',
            security: '账户安全',
            support: '客服支持',
        },
        services: {
            favorites: '我的收藏',
            coupons: '优惠券',
            announcements: '网站公告',
            addresses: '地址管理',
            messages: '消息通知',
            reviews: '评价中心',
            support: '客服中心',
            store: '店铺首页',
        },
    },
    en: {
        orders: {
            title: 'My orders',
            viewAll: 'View all',
            all: 'All',
            unpaid: 'Unpaid',
            processing: 'Processing',
            shipped: 'Shipped',
            returns: 'Returns',
            due: 'Due',
        },
        home: {
            catalog: 'Catalog',
            featured: 'Featured',
            cart: 'Cart',
            orders: 'Orders',
        },
        trust: {
            tracking: 'Tracking',
            pricing: 'Pricing',
            security: 'Security',
            support: 'Support',
        },
        services: {
            favorites: 'Favorites',
            coupons: 'Coupons',
            announcements: 'Notices',
            addresses: 'Addresses',
            messages: 'Messages',
            reviews: 'Reviews',
            support: 'Support',
            store: 'Store',
        },
    },
} as const satisfies Record<StorefrontLanguage, object>;
