import type {
    MarketConfig,
    Order,
    StorefrontCart,
    StorefrontCheckoutSession,
    VendureLanguageCode,
} from '../types';
import type { ShopApiContext } from './client-context';
import type { ErrorResult } from './helpers';

import {
    API_URL,
    SEND_CLIENT_CHANNEL_TOKEN,
    ShopApiTimeoutError,
    createRequestSignal,
    type GraphQlResponse,
} from './helpers';

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

    protected createAuthTokenCapture(): (response: Response) => void {
        return this.ctx.createAuthTokenCapture();
    }

    protected clearAuthToken(): void {
        this.ctx.clearAuthToken();
    }

    protected authenticationRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        return this.ctx.authenticationRequest<T>(query, variables);
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

    protected async upload<T>(
        query: string,
        variables: Record<string, unknown>,
        file: File,
        timeoutMessage: string,
    ): Promise<T> {
        const form = new FormData();
        form.set('operations', JSON.stringify({ query, variables: { ...variables, file: null } }));
        form.set('map', JSON.stringify({ 0: ['variables.file'] }));
        form.set('0', file, file.name);
        const headers: Record<string, string> = {
            'language-code': this.languageCode,
            'Apollo-Require-Preflight': 'true',
        };
        if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
        if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
        const separator = API_URL.includes('?') ? '&' : '?';
        const timeout = createRequestSignal(undefined, 60_000);
        const captureAuthToken = this.createAuthTokenCapture();
        try {
            const response = await fetch(
                `${API_URL}${separator}languageCode=${encodeURIComponent(this.languageCode)}&currencyCode=${encodeURIComponent(this.market.currencyCode)}`,
                {
                    method: 'POST',
                    credentials: 'include',
                    headers,
                    body: form,
                    signal: timeout.signal,
                },
            );
            captureAuthToken(response);
            const body = (await response.json()) as GraphQlResponse<T>;
            if (!response.ok || body.errors?.length || !body.data)
                throw new Error(body.errors?.[0]?.message ?? `Image upload failed (${response.status})`);
            return body.data;
        } catch (error) {
            if (timeout.didTimeout()) throw new ShopApiTimeoutError(timeoutMessage);
            throw error;
        } finally {
            timeout.cleanup();
        }
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
