import type {
    MarketConfig,
    Order,
    StorefrontCart,
    StorefrontCheckoutSession,
    VendureLanguageCode,
} from '../types';
import type { ShopApiContext } from './client-context';
import type { ErrorResult } from './helpers';

export abstract class BaseDomainApi {
    constructor(protected readonly ctx: ShopApiContext) {}

    protected get market(): MarketConfig {
        return this.ctx.market;
    }

    protected get languageCode(): VendureLanguageCode {
        return this.ctx.languageCode;
    }

    protected get authToken(): string | null {
        return this.ctx.getAuthToken();
    }

    protected captureAuthToken(response: Response): void {
        this.ctx.captureAuthToken(response);
    }

    protected clearAuthToken(): void {
        this.ctx.clearAuthToken();
    }

    protected request<T>(
        query: string,
        variables?: Record<string, unknown>,
        signal?: AbortSignal,
        timeoutMs?: number,
        resultUnknownOnTimeout?: boolean,
    ): Promise<T> {
        return this.ctx.request<T>(query, variables, signal, timeoutMs, resultUnknownOnTimeout);
    }

    protected assertCart(result: StorefrontCart & ErrorResult): StorefrontCart {
        return this.ctx.assertCart(result);
    }

    protected assertCheckoutSession(
        result: StorefrontCheckoutSession & ErrorResult,
    ): StorefrontCheckoutSession {
        return this.ctx.assertCheckoutSession(result);
    }

    protected assertOrder(result: Order & ErrorResult): Order {
        return this.ctx.assertOrder(result);
    }

    protected assertNoError(result: ErrorResult): void {
        this.ctx.assertNoError(result);
    }
}
