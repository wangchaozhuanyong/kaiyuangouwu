import type { Query, QueryClient } from '@tanstack/react-query';

import {
    storefrontRealtimeQueryMatches,
    type StorefrontRealtimeEvent,
    type StorefrontRealtimeScope,
} from './realtime-updates';

const realtimeRefreshes = new WeakMap<
    QueryClient,
    Map<
        string,
        {
            signal?: AbortSignal;
            enqueue: (event: StorefrontRealtimeEvent) => void;
            promise: Promise<void>;
        }
    >
>();
const REALTIME_MERGE_DELAY_MS = 100;
const REALTIME_MAX_MERGE_DELAY_MS = 500;

/** Merge notifications, not response data. Query and the transport retain their existing owners. */
export function enqueueStorefrontRealtimeQueries(
    queryClient: QueryClient,
    event: StorefrontRealtimeEvent,
    scope: StorefrontRealtimeScope,
    signal?: AbortSignal,
): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    let scopes = realtimeRefreshes.get(queryClient);
    if (!scopes) realtimeRefreshes.set(queryClient, (scopes = new Map()));
    const key = JSON.stringify([scope.marketCode, scope.languageCode, scope.customerId]);
    const existing = scopes.get(key);
    if (existing && existing.signal === signal) {
        existing.enqueue(event);
        return existing.promise;
    }
    const pending = new Map<string, StorefrontRealtimeEvent>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let disposed = false;
    let firstPendingAt = 0;
    let lastPendingAt = 0;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    const finish = (error?: unknown) => {
        disposed = true;
        if (timer !== undefined) clearTimeout(timer);
        pending.clear();
        signal?.removeEventListener('abort', abort);
        if (scopes.get(key) === state) scopes.delete(key);
        if (error) reject(error);
        else resolve();
    };
    const abort = () => finish();
    const schedule = () => {
        if (disposed || running) return;
        if (timer !== undefined) clearTimeout(timer);
        const now = Date.now();
        timer = setTimeout(
            () => void flush(),
            Math.max(
                0,
                Math.min(
                    lastPendingAt + REALTIME_MERGE_DELAY_MS - now,
                    firstPendingAt + REALTIME_MAX_MERGE_DELAY_MS - now,
                ),
            ),
        );
    };
    const flush = async () => {
        timer = undefined;
        if (disposed) return;
        const events = [...pending.values()];
        pending.clear();
        running = true;
        try {
            await applyStorefrontRealtimeQueries(queryClient, events, scope, () => !disposed);
        } catch (error) {
            finish(error);
            return;
        }
        running = false;
        if (disposed) return;
        if (pending.size) schedule();
        else finish();
    };
    const state = {
        signal,
        promise,
        enqueue(next: StorefrontRealtimeEvent) {
            if (disposed) return;
            if (!pending.size) firstPendingAt = Date.now();
            lastPendingAt = Date.now();
            const target = JSON.stringify([[...next.topics].sort(), next.entityType]);
            const prior = pending.get(target);
            pending.set(
                target,
                prior
                    ? {
                          ...next,
                          // An untargeted notification must remain broad; never narrow it to later IDs.
                          entityIds:
                              prior.entityIds?.length && next.entityIds?.length
                                  ? [...new Set([...prior.entityIds, ...next.entityIds])]
                                  : undefined,
                      }
                    : next,
            );
            schedule();
        },
    };
    scopes.set(key, state);
    signal?.addEventListener('abort', abort, { once: true });
    state.enqueue(event);
    return promise;
}

async function applyStorefrontRealtimeQueries(
    queryClient: QueryClient,
    events: StorefrontRealtimeEvent[],
    scope: StorefrontRealtimeScope,
    current: () => boolean,
): Promise<void> {
    const matches = (query: Pick<Query, 'queryKey'>) =>
        events.some(event => storefrontRealtimeQueryMatches(query, event, scope));
    const publication = events.some(event =>
        event.topics.some(topic => ['catalog', 'content', 'config', 'coupons'].includes(topic)),
    );
    if (publication) {
        await queryClient.cancelQueries({
            predicate: query =>
                matchesPrefix(query.queryKey, ['storefront', scope.marketCode, scope.languageCode]) &&
                query.queryKey[3] !== 'private' &&
                (query.meta?.publicAggregatePart === true ||
                    query.queryKey[3] === 'config' ||
                    matches(query)),
        });
    }
    if (!current()) return;
    // Aggregate sections share config's read owner. Mark their cached values stale without
    // launching independent content/visual/collection requests.
    await queryClient.invalidateQueries({
        predicate: query => matches(query) && query.meta?.publicAggregatePart === true,
        refetchType: 'none',
    });
    if (!current()) return;
    await queryClient.invalidateQueries(
        {
            predicate: query =>
                query.meta?.publicAggregatePart !== true &&
                (matches(query) ||
                    (matchesPrefix(query.queryKey, [
                        'storefront',
                        scope.marketCode,
                        scope.languageCode,
                        'config',
                    ]) &&
                        publication)),
        },
        { cancelRefetch: false },
    );
}

function matchesPrefix(value: readonly unknown[], prefix: readonly unknown[]): boolean {
    return prefix.every((part, index) => value[index] === part);
}
