import type { ShopApi } from '../api';
import type { MarketConfig, StorefrontLanguage, VendureLanguageCode } from '../types';

export interface StorefrontQueryContext {
    api: ShopApi;
    market: MarketConfig;
    language: StorefrontLanguage;
    vendureLanguageCode: VendureLanguageCode;
    storefrontContextResolved: boolean;
}
