import type {
    MarketConfig,
    Order,
    StorefrontCart,
    StorefrontCheckoutSession,
    VendureLanguageCode,
} from '../types';
import type { ErrorResult } from './helpers';

export interface ShopApiContext {
    readonly market: MarketConfig;
    readonly languageCode: VendureLanguageCode;
    getAuthToken: () => string | null;
    captureAuthToken: (response: Response) => void;
    clearAuthToken: () => void;
    request: <T>(
        query: string,
        variables?: Record<string, unknown>,
        signal?: AbortSignal,
        timeoutMs?: number,
        resultUnknownOnTimeout?: boolean,
    ) => Promise<T>;
    assertCart: (result: StorefrontCart & ErrorResult) => StorefrontCart;
    assertCheckoutSession: (result: StorefrontCheckoutSession & ErrorResult) => StorefrontCheckoutSession;
    assertOrder: (result: Order & ErrorResult) => Order;
    assertNoError: (result: ErrorResult) => void;
    getStorefrontCatalogAvailable: () => boolean | null;
    setStorefrontCatalogAvailable: (available: boolean) => void;
}
