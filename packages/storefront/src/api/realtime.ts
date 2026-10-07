import { consumeStorefrontRealtimeStream, type StorefrontRealtimeEvent } from '../realtime-updates';

import { BaseDomainApi } from './base-domain-api';
import {
    abortableDelay,
    calculateStorefrontRealtimeRetry,
    cancelStorefrontRealtimeBody,
    createRequestSignal,
    SEND_CLIENT_CHANNEL_TOKEN,
    STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS,
    StorefrontRealtimeConnectionError,
    storefrontRealtimeUrl,
} from './helpers';

const STOREFRONT_REALTIME_RESPONSE_TIMEOUT_MS = 10_000;

export class RealtimeApi extends BaseDomainApi {
    async watchRealtime(
        onEvent: (event: StorefrontRealtimeEvent) => void,
        signal: AbortSignal,
        onConnectionChange?: (connected: boolean) => void,
    ): Promise<void> {
        onConnectionChange?.(false);
        signal.addEventListener('abort', () => onConnectionChange?.(false), { once: true });
        let retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
        while (!signal.aborted) {
            try {
                const headers: Record<string, string> = { accept: 'text/event-stream' };
                if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
                if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
                const request = createRequestSignal(signal, STOREFRONT_REALTIME_RESPONSE_TIMEOUT_MS);
                let response: Response;
                try {
                    response = await fetch(storefrontRealtimeUrl(), {
                        method: 'GET',
                        credentials: 'include',
                        headers,
                        cache: 'no-store',
                        signal: request.signal,
                    });
                } catch (error) {
                    if (request.didTimeout()) throw new Error('Storefront realtime response timed out');
                    throw error;
                } finally {
                    // The streaming reader owns cancellation after the response arrives.
                    request.cleanup();
                }
                if (!response.ok) {
                    const error = new StorefrontRealtimeConnectionError(
                        response.status,
                        response.headers.get('retry-after'),
                    );
                    await cancelStorefrontRealtimeBody(response.body, error);
                    throw error;
                }
                if (!response.body) {
                    throw new StorefrontRealtimeConnectionError(response.status, null);
                }
                await consumeStorefrontRealtimeStream(response.body, onEvent, {
                    signal,
                    onReady: () => {
                        onConnectionChange?.(true);
                        retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
                    },
                });
                if (!signal.aborted) throw new Error('Storefront realtime connection closed');
            } catch (error) {
                onConnectionChange?.(false);
                if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
                const retry = calculateStorefrontRealtimeRetry({
                    status: error instanceof StorefrontRealtimeConnectionError ? error.status : undefined,
                    retryAfter:
                        error instanceof StorefrontRealtimeConnectionError ? error.retryAfter : undefined,
                    baseDelayMs: retryDelayMs,
                });
                await abortableDelay(retry.delayMs, signal);
                retryDelayMs = retry.nextBaseDelayMs;
            }
        }
    }
}
