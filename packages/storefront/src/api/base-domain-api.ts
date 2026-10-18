import type { ShopAbuseProof } from '../shop-abuse';
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
    createRequestSignal,
    shopApiHeaders,
    ShopApiTimeoutError,
    shopApiUrl,
    type GraphQlResponse,
} from './helpers';
import { sessionTransport } from './session-transport';

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

    protected authenticationRequest<T>(
        query: string,
        variables: Record<string, unknown>,
        signal?: AbortSignal,
        timeoutMs?: number,
        resultUnknownOnTimeout?: boolean,
        proof?: ShopAbuseProof,
    ): Promise<T> {
        return this.ctx.authenticationRequest<T>(
            query,
            variables,
            signal,
            timeoutMs,
            resultUnknownOnTimeout,
            ...(proof ? [proof] : []),
        );
    }

    protected request<T>(
        query: string,
        variables?: Record<string, unknown>,
        signal?: AbortSignal,
        timeoutMs?: number,
        resultUnknownOnTimeout?: boolean,
        readCurrencyCode?: string,
        proof?: ShopAbuseProof,
    ): Promise<T> {
        return this.ctx.request<T>(
            query,
            variables,
            signal,
            timeoutMs,
            resultUnknownOnTimeout,
            readCurrencyCode,
            ...(proof ? [proof] : []),
        );
    }

    protected async upload<T>(
        query: string,
        variables: Record<string, unknown>,
        file: File,
        timeoutMessage: string,
    ): Promise<T> {
        return this.uploadFiles(query, variables, [file], timeoutMessage, 'file');
    }

    protected async uploadFiles<T>(
        query: string,
        variables: Record<string, unknown>,
        files: File[],
        timeoutMessage: string,
        variableName: string,
    ): Promise<T> {
        const form = new FormData();
        form.set(
            'operations',
            JSON.stringify({
                query,
                variables: {
                    ...variables,
                    [variableName]: variableName === 'file' ? null : files.map(() => null),
                },
            }),
        );
        form.set(
            'map',
            JSON.stringify(
                Object.fromEntries(
                    files.map((_, index) => [
                        index,
                        [`variables.${variableName}${variableName === 'file' ? '' : `.${index}`}`],
                    ]),
                ),
            ),
        );
        files.forEach((file, index) => form.set(String(index), file, file.name));
        const url = shopApiUrl(this.languageCode, this.market.currencyCode);
        const timeout = createRequestSignal(undefined, 60_000);
        try {
            const response = await sessionTransport(url, false, timeout.signal, async () => {
                const headers: Record<string, string> = {
                    ...shopApiHeaders(this.languageCode, this.market.code, this.authToken),
                    'Apollo-Require-Preflight': 'true',
                };
                const capture = this.createAuthTokenCapture();
                const uploaded = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    headers,
                    body: form,
                    signal: timeout.signal,
                });
                capture(uploaded);
                return uploaded;
            });
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
