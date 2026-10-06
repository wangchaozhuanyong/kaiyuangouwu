import DataLoader from 'dataloader';
import { getOperationAST, OperationTypeNode, parse } from 'graphql';

import { RequestContext } from '../api';
import { TRANSACTION_MANAGER_KEY } from '../common/constants';

/**
 * @description
 * This service is used to cache arbitrary data relative to an ongoing request.
 * It does this by using a WeakMap bound to the current RequestContext, so the cached
 * data is available for the duration of the request. Once the request completes, the
 * cached data will be automatically garbage-collected.
 *
 * This is useful for caching data which is expensive to compute and which is needed
 * multiple times during the handling of a single request.
 *
 * @docsCategory cache
 */
export class RequestContextCacheService {
    private caches = new WeakMap<RequestContext, Map<any, any>>();
    private loaders = new WeakMap<RequestContext, Map<string, DataLoader<string, unknown>>>();
    private retainResults = new WeakMap<RequestContext, boolean>();

    /** Start a fresh read generation when a surrounding snapshot retries after invalidation. */
    clear(ctx: RequestContext): void {
        this.caches.delete(ctx);
        this.loaders.delete(ctx);
        this.retainResults.delete(ctx);
    }

    /**
     * Batch read-only entity fields resolved concurrently within one request. The
     * scope must include any channel, language, currency or projection differences.
     * Never use this for a write's authoritative stock/price/permission validation.
     * Each batch is bounded, preserves caller order and shares in-flight promises.
     */
    load<V>(
        ctx: RequestContext,
        scope: string,
        id: string | number,
        batch: (ids: readonly string[]) => Promise<readonly V[]>,
    ): Promise<V> {
        let loaders = this.loaders.get(ctx);
        if (!loaders) {
            loaders = new Map();
            this.loaders.set(ctx, loaders);
        }
        let loader = loaders.get(scope) as DataLoader<string, V> | undefined;
        if (!loader) {
            loader = new DataLoader<string, V>(batch, {
                maxBatchSize: 200,
                cache: this.canRetainResults(ctx),
            });
            loaders.set(scope, loader);
        }
        return loader.load(String(id));
    }

    private canRetainResults(ctx: RequestContext): boolean {
        const previous = this.retainResults.get(ctx);
        if (previous !== undefined) return previous;
        // Mutation response fields can read after another serial mutation has
        // changed the same entity. Coalesce those fields, but never retain their
        // results across writes within the request or a transaction.
        let retain = !Object.getOwnPropertySymbols(ctx).includes(TRANSACTION_MANAGER_KEY);
        const body = ctx.req?.body;
        if (Array.isArray(body)) retain = false;
        if (typeof body?.query === 'string') {
            try {
                retain =
                    retain &&
                    getOperationAST(parse(body.query), body.operationName)?.operation ===
                        OperationTypeNode.QUERY;
            } catch {
                retain = false;
            }
        }
        this.retainResults.set(ctx, retain);
        return retain;
    }

    /**
     * @description
     * Set a value in the RequestContext cache.
     */
    set<T = any>(ctx: RequestContext, key: any, val: T): void {
        this.getContextCache(ctx).set(key, val);
    }

    /**
     * @description
     * Get a value from the RequestContext cache. If the value is not found, the `getDefault`
     * function will be called to get the value, which will then be cached and returned.
     */
    get<T = any>(ctx: RequestContext, key: any): T | undefined;
    get<T>(ctx: RequestContext, key: any, getDefault?: () => T): T;
    get<T>(ctx: RequestContext, key: any, getDefault?: () => T): T | Promise<T> | undefined {
        const ctxCache = this.getContextCache(ctx);
        const result = ctxCache.get(key);
        if (result) {
            return result;
        }
        if (getDefault) {
            const defaultResultOrPromise = getDefault();
            ctxCache.set(key, defaultResultOrPromise);
            return defaultResultOrPromise;
        } else {
            return;
        }
    }

    private getContextCache(ctx: RequestContext): Map<any, any> {
        let ctxCache = this.caches.get(ctx);
        if (!ctxCache) {
            ctxCache = new Map<any, any>();
            this.caches.set(ctx, ctxCache);
        }
        return ctxCache;
    }

    private isPromise<T>(input: T | Promise<T>): input is Promise<T> {
        return typeof (input as any).then === 'function';
    }
}
