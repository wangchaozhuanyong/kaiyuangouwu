import { hashKey, notifyManager, skipToken, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore, type SetStateAction } from 'react';

import { type ShopApi } from '../api';
import {
    PUBLIC_QUERY_GC_TIME,
    ROUTE_QUERY_STALE_TIME,
    storefrontQueryClient,
    storefrontQueryKeys,
    type StorefrontRefreshScope,
} from '../query-client';
import {
    type ActiveCustomer,
    type ImageGenerationJob,
    type ImageModelQuotaStatus,
    type ImagePromptOptimizationResult,
    type ImagePromptQuotaStatus,
    type ImageReferenceMode,
    type ImageResolution,
    type ImageStudioConfig,
    type MarketConfig,
} from '../types';

import { studioCacheState } from './ai-image-studio-cache-state';

// Install resource cleanup only when this optional business module is loaded.
// The lightweight session owner still advances its generation synchronously.
studioCacheState.dispose = () => {
    const writes = storefrontQueryClient.getMutationCache();
    writes.findAll({ mutationKey: ['studio-write'] }).forEach(mutation => writes.remove(mutation));
    const predicate = (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === 'storefront' &&
        query.queryKey[3] === 'private' &&
        query.queryKey[6] === 'image-studio';
    void storefrontQueryClient.cancelQueries({ predicate });
    storefrontQueryClient.removeQueries({ predicate });
};

export { clearStudioCache } from './ai-image-studio-cache-state';
export type ImageStudioScope = Pick<StorefrontRefreshScope, 'marketCode' | 'languageCode'>;

export interface ImageStudioDraft {
    prompt: string;
    originalPrompt: string;
    optimized: boolean;
    optimizationReason: string;
    modelCode: string;
    aspectRatio: string;
    resolution: ImageResolution;
    quantity: number;
}

export interface ImageStudioSnapshot {
    config: ImageStudioConfig | null;
    balance: number | null;
    walletCurrencyCode: string;
    promptQuota: ImagePromptQuotaStatus | null;
    modelQuotas: ImageModelQuotaStatus[];
    jobs: ImageGenerationJob[];
    historyIds: string[];
    historyTotal: number;
    lastFetchedAt: number;
    walletReadReady: boolean;
    promptReadReady: boolean;
    modelReadReady: boolean;
}
export interface ImageStudioCacheEntry extends ImageStudioSnapshot {
    draft: ImageStudioDraft;
}
type StudioJobView = Pick<ImageStudioSnapshot, 'jobs' | 'historyIds' | 'historyTotal'>;
const jobFields = new Set<keyof ImageStudioSnapshot>(['jobs', 'historyIds', 'historyTotal']);
const emptyJobView = (): StudioJobView => ({ jobs: [], historyIds: [], historyTotal: 0 });

const defaultDraft = (): ImageStudioDraft => ({
    prompt: '',
    originalPrompt: '',
    optimized: false,
    optimizationReason: '',
    modelCode: '',
    aspectRatio: '1:1',
    resolution: '1K',
    quantity: 1,
});
const emptySnapshot = (): ImageStudioSnapshot => ({
    config: null,
    balance: null,
    walletCurrencyCode: '',
    promptQuota: null,
    modelQuotas: [],
    jobs: [],
    historyIds: [],
    historyTotal: 0,
    lastFetchedAt: 0,
    walletReadReady: false,
    promptReadReady: false,
    modelReadReady: false,
});

export function studioQueryKey(scope: ImageStudioScope, customerId?: string | null) {
    return [
        ...storefrontQueryKeys.customerScope(scope.marketCode, scope.languageCode, customerId ?? 'guest'),
        'image-studio',
    ] as const;
}
export function getStudioCacheKey(scope: ImageStudioScope, customerId?: string | null): string {
    return hashKey(studioQueryKey(scope, customerId));
}
export function getStudioCachedData(
    scope: ImageStudioScope,
    customerId?: string | null,
): ImageStudioCacheEntry | null {
    const data = storefrontQueryClient.getQueryData<ImageStudioSnapshot>(studioQueryKey(scope, customerId));
    const jobs = storefrontQueryClient.getQueryData<StudioJobView>([
        ...studioQueryKey(scope, customerId),
        'job-view',
    ]);
    return data
        ? {
              ...data,
              ...(jobs ?? {}),
              draft: studioCacheState.drafts.get(getStudioCacheKey(scope, customerId)) ?? defaultDraft(),
          }
        : null;
}

export function setStudioCachedData(
    scope: ImageStudioScope,
    customerId: string | null | undefined,
    data: Partial<ImageStudioSnapshot> & { draft?: Partial<ImageStudioDraft> },
): void {
    const { draft, jobs, historyIds, historyTotal, ...snapshot } = data;
    const key = studioQueryKey(scope, customerId);
    const updatedAt = data.lastFetchedAt ?? storefrontQueryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    storefrontQueryClient.setQueryData<ImageStudioSnapshot>(
        key,
        previous => ({
            ...(previous ?? emptySnapshot()),
            ...snapshot,
        }),
        { updatedAt },
    );
    if (jobs !== undefined || historyIds !== undefined || historyTotal !== undefined) {
        storefrontQueryClient.setQueryData<StudioJobView>([...key, 'job-view'], previous => ({
            ...(previous ?? emptyJobView()),
            ...(jobs !== undefined && { jobs }),
            ...(historyIds !== undefined && { historyIds }),
            ...(historyTotal !== undefined && { historyTotal }),
        }));
    }
    if (draft) updateStudioDraftCache(scope, customerId, draft);
}
export function updateStudioDraftCache(
    scope: ImageStudioScope,
    customerId: string | null | undefined,
    update: Partial<ImageStudioDraft>,
): void {
    const key = getStudioCacheKey(scope, customerId);
    studioCacheState.drafts.set(key, { ...(studioCacheState.drafts.get(key) ?? defaultDraft()), ...update });
}

export function studioQueryOptions(api: ShopApi, scope: ImageStudioScope, customerId?: string | null) {
    const queryKey = studioQueryKey(scope, customerId);
    return {
        queryKey,
        // A composite partial failure already retains successful fields. Retry only the read,
        // explicitly or on the next stale/online/focus refresh; never replay a studio write.
        retry: false,
        staleTime: ROUTE_QUERY_STALE_TIME,
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ImageStudioSnapshot> => {
            const generation = studioCacheState.generation;
            const assertCurrent = () => {
                signal.throwIfAborted();
                if (generation !== studioCacheState.generation)
                    throw new DOMException('Session changed', 'AbortError');
            };
            const previous = () =>
                storefrontQueryClient.getQueryData<ImageStudioSnapshot>(queryKey) ?? emptySnapshot();
            let partial = false;
            try {
                const config = await api.imageStudioConfig(signal);
                assertCurrent();
                if (!config)
                    throw new Error(
                        scope.languageCode.startsWith('zh')
                            ? '无法获取图片工坊配置'
                            : 'Could not load image studio configuration',
                    );
                if (!customerId) return { ...previous(), config, lastFetchedAt: Date.now() };
                const [wallet, prompt, models] = await Promise.allSettled([
                    api.imageStudioWallet(signal),
                    api.imagePromptQuotaStatus(signal),
                    api.imageModelQuotaStatus(signal),
                ]);
                assertCurrent();
                const complete = [wallet, prompt, models].every(result => result.status === 'fulfilled');
                const next = {
                    ...previous(),
                    config,
                    walletReadReady: wallet.status === 'fulfilled',
                    promptReadReady: prompt.status === 'fulfilled',
                    modelReadReady: models.status === 'fulfilled',
                    ...(wallet.status === 'fulfilled' && {
                        balance: wallet.value.availableBalance,
                        walletCurrencyCode: wallet.value.currencyCode,
                    }),
                    ...(prompt.status === 'fulfilled' && { promptQuota: prompt.value }),
                    ...(models.status === 'fulfilled' && { modelQuotas: models.value }),
                    ...(complete && { lastFetchedAt: Date.now() }),
                };
                if (!complete) {
                    partial = true;
                    storefrontQueryClient.setQueryData(queryKey, next, {
                        updatedAt: storefrontQueryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0,
                    });
                    throw new Error(
                        scope.languageCode.startsWith('zh')
                            ? '部分数据刷新失败，已保留现有内容'
                            : 'Some data could not be refreshed. Existing content is retained.',
                    );
                }
                return next;
            } catch (error) {
                assertCurrent();
                const cached = previous();
                // Retain readable values while requiring a fresh verification before paid actions.
                if (cached.config && !partial)
                    storefrontQueryClient.setQueryData(
                        queryKey,
                        { ...cached, walletReadReady: false, promptReadReady: false, modelReadReady: false },
                        { updatedAt: storefrontQueryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0 },
                    );
                throw error;
            }
        },
    };
}

/** The root QueryClient owns all server data; this adapter only binds field updates to its exact key. */
export function useImageStudioResource(api: ShopApi, scope: ImageStudioScope, customerId?: string | null) {
    const identity = getStudioCacheKey(scope, customerId);
    const queryKey = useMemo(() => studioQueryKey(scope, customerId), [identity]);
    const query = useQuery(
        { ...studioQueryOptions(api, scope, customerId), refetchOnMount: customerId ? 'always' : true },
        storefrontQueryClient,
    );
    // Read statuses stay on their own resources. Updating job rows cannot clear a wallet/configuration failure.
    const jobView = useQuery(
        {
            queryKey: [...queryKey, 'job-view'],
            queryFn: skipToken,
            enabled: false,
            initialData: emptyJobView,
        },
        storefrontQueryClient,
    );
    const setField = useCallback(
        <K extends keyof ImageStudioSnapshot>(field: K, update: SetStateAction<ImageStudioSnapshot[K]>) => {
            const targetKey = jobFields.has(field) ? [...queryKey, 'job-view'] : queryKey;
            storefrontQueryClient.setQueryData<ImageStudioSnapshot | StudioJobView>(
                targetKey,
                old => {
                    const previous = { ...emptySnapshot(), ...old };
                    const value = typeof update === 'function' ? update(previous[field]) : update;
                    if (jobFields.has(field)) {
                        const view = old;
                        return Object.is(previous[field], value) && view
                            ? view
                            : { ...(view ?? emptyJobView()), [field]: value };
                    }
                    return Object.is(previous[field], value) ? previous : { ...previous, [field]: value };
                },
                { updatedAt: storefrontQueryClient.getQueryState(targetKey)?.dataUpdatedAt ?? 0 },
            );
        },
        [queryKey],
    );
    const setters = useMemo(
        () => ({
            setBalance: (value: SetStateAction<number | null>) => setField('balance', value),
            setWalletCurrencyCode: (value: SetStateAction<string>) => setField('walletCurrencyCode', value),
            setPromptQuota: (value: SetStateAction<ImagePromptQuotaStatus | null>) =>
                setField('promptQuota', value),
            setModelQuotas: (value: SetStateAction<ImageModelQuotaStatus[]>) =>
                setField('modelQuotas', value),
            setJobs: (value: SetStateAction<ImageGenerationJob[]>) => setField('jobs', value),
            setHistoryIds: (value: SetStateAction<string[]>) => setField('historyIds', value),
            setHistoryTotal: (value: SetStateAction<number>) => setField('historyTotal', value),
            setWalletReadReady: (value: SetStateAction<boolean>) => setField('walletReadReady', value),
            setPromptReadReady: (value: SetStateAction<boolean>) => setField('promptReadReady', value),
            setModelReadReady: (value: SetStateAction<boolean>) => setField('modelReadReady', value),
        }),
        [setField],
    );
    return { query, data: { ...(query.data ?? emptySnapshot()), ...jobView.data }, ...setters };
}

export async function preloadImageStudioData(
    api: ShopApi,
    customer: ActiveCustomer | null,
    market: MarketConfig,
    languageCode = market.defaultLanguageCode,
): Promise<void> {
    const scope = { marketCode: storefrontQueryKeys.market(market), languageCode };
    try {
        await storefrontQueryClient.fetchQuery(studioQueryOptions(api, scope, customer?.id));
    } catch {
        /* Optional warmup never replaces the destination's error recovery. */
    }
}

// Writes use the root client's MutationCache. Failed retry identities and an
// undelivered optimization survive navigation in memory, never in persistence.
type StudioWriteKind = 'GENERATE' | 'OPTIMIZE';
const studioWriteKey = (storeCode: string, customerId?: string) => [
    'studio-write',
    storeCode,
    customerId ?? 'guest',
];
export function useStudioPendingWrite(
    storeCode: string,
    customerId?: string,
): StudioWriteKind | 'OPTIMIZED' | '' {
    const cache = storefrontQueryClient.getMutationCache();
    const key = useMemo(() => studioWriteKey(storeCode, customerId), [storeCode, customerId]);
    const subscribe = useCallback(
        (notify: () => void) => cache.subscribe(notifyManager.batchCalls(notify)),
        [cache],
    );
    const snapshot = useCallback(() => {
        const kind = cache.find({ mutationKey: key, status: 'pending' })?.options.meta?.studioKind;
        if (kind === 'GENERATE' || kind === 'OPTIMIZE') return kind;
        return cache
            .findAll({ mutationKey: key, status: 'success' })
            .some(item => item.options.meta?.studioKind === 'OPTIMIZE')
            ? 'OPTIMIZED'
            : '';
    }, [cache, key]);
    return useSyncExternalStore(subscribe, snapshot, () => '');
}
export function takeStudioOptimization(storeCode: string, customerId?: string) {
    const cache = storefrontQueryClient.getMutationCache();
    const mutation = cache
        .findAll({ mutationKey: studioWriteKey(storeCode, customerId), status: 'success' })
        .find(item => item.options.meta?.studioKind === 'OPTIMIZE');
    if (!mutation) return null;
    cache.remove(mutation);
    return {
        result: mutation.state.data as ImagePromptOptimizationResult,
        input: JSON.parse((mutation.options.meta?.request as { fingerprint: string }).fingerprint) as {
            prompt: string;
            optimizedPrompt: string | null;
            referenceMode: ImageReferenceMode;
            referenceAssetIds: string[];
            referenceInstruction: string | null;
        },
    };
}
export function studioWriteAttempt(
    storeCode: string,
    customerId: string | undefined,
    kind: StudioWriteKind,
    fingerprint: string,
) {
    const mutation = storefrontQueryClient
        .getMutationCache()
        .findAll({ mutationKey: studioWriteKey(storeCode, customerId) })
        .find(
            item =>
                item.options.meta?.studioKind === kind &&
                (item.options.meta?.request as { fingerprint?: string } | undefined)?.fingerprint ===
                    fingerprint,
        );
    return mutation?.options.meta?.request as { fingerprint: string; idempotencyKey: string } | undefined;
}
export function executeStudioWrite<T>(
    storeCode: string,
    customerId: string | undefined,
    kind: StudioWriteKind,
    request: { fingerprint: string; idempotencyKey: string },
    write: () => Promise<T>,
    ownsReadback: () => boolean,
): Promise<T> {
    const client = storefrontQueryClient;
    const cache = client.getMutationCache();
    const key = studioWriteKey(storeCode, customerId);
    if (cache.find({ mutationKey: key, status: 'pending' }))
        return Promise.reject(new Error('A studio operation is still pending'));
    // The caller has already recovered the matching retry identity, if any.
    cache
        .findAll({ mutationKey: key })
        .filter(item => item.options.meta?.studioKind === kind)
        .forEach(item => cache.remove(item));
    const generation = studioCacheState.generation;
    const mutation = cache.build<T, Error, void, unknown>(client, {
        mutationKey: key,
        mutationFn: write,
        retry: false,
        networkMode: 'always',
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: { studioKind: kind, request },
        onSettled: (_data, error) => {
            if (generation === studioCacheState.generation) {
                const predicate = (query: { queryKey: readonly unknown[] }) =>
                    query.queryKey[0] === 'storefront' &&
                    typeof query.queryKey[1] === 'string' &&
                    query.queryKey[1].startsWith(storeCode + ':') &&
                    query.queryKey[3] === 'private' &&
                    query.queryKey[5] === customerId &&
                    query.queryKey[6] === 'image-studio';
                // A departed page cannot publish its old readback. The current observer
                // owns reconciliation; an unchanged caller retains its existing readback.
                void client.cancelQueries({ predicate });
                void client
                    .invalidateQueries({ predicate, refetchType: ownsReadback() ? 'none' : 'active' })
                    .catch(() => undefined);
            }
            // A completed optimization has no history endpoint. Keep its result in
            // memory until its editor consumes it, including after navigation.
            if ((!error && kind !== 'OPTIMIZE') || generation !== studioCacheState.generation)
                cache.remove(mutation);
        },
    });
    return mutation.execute(undefined);
}
