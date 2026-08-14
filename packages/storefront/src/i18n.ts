import { MarketCode, MarketConfig, StorefrontLanguage, VendureLanguageCode } from './types';

export const markets: Record<MarketCode, MarketConfig> = {
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
    .filter((code: string): code is MarketCode => code in markets);

export const enabledMarkets: MarketConfig[] = configuredMarketCodes.length
    ? configuredMarketCodes.map((code: MarketCode) => markets[code])
    : [markets['cn-mainland']];

export function languageCodeFor(language: StorefrontLanguage): VendureLanguageCode {
    return language === 'zh' ? 'zh_Hans' : 'en';
}

export function localeFor(language: StorefrontLanguage, market: MarketConfig): string {
    if (language === 'zh') return 'zh-CN';
    return market.code === 'my-malaysia' ? 'en-MY' : 'en-US';
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
