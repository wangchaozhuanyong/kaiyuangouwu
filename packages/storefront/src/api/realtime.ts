import { consumeStorefrontRealtimeStream, type StorefrontRealtimeEvent } from '../realtime-updates';

import { BaseDomainApi } from './base-domain-api';
import {
    abortableDelay,
    calculateStorefrontRealtimeRetry,
    cancelStorefrontRealtimeBody,
    SEND_CLIENT_CHANNEL_TOKEN,
    STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS,
    StorefrontRealtimeConnectionError,
    storefrontRealtimeUrl,
} from './helpers';

export class RealtimeApi extends BaseDomainApi {
    async watchRealtime(
        onEvent: (event: StorefrontRealtimeEvent) => void,
        signal: AbortSignal,
    ): Promise<void> {
        let retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
        while (!signal.aborted) {
            try {
                const headers: Record<string, string> = { accept: 'text/event-stream' };
                if (SEND_CLIENT_CHANNEL_TOKEN) headers['vendure-token'] = this.market.code;
                if (this.authToken) headers.authorization = `Bearer ${this.authToken}`;
                const response = await fetch(storefrontRealtimeUrl(), {
                    method: 'GET',
                    credentials: 'include',
                    headers,
                    cache: 'no-store',
                    signal,
                });
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
                        retryDelayMs = STOREFRONT_REALTIME_INITIAL_RETRY_DELAY_MS;
                    },
                });
                if (!signal.aborted) throw new Error('Storefront realtime connection closed');
            } catch (error) {
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
