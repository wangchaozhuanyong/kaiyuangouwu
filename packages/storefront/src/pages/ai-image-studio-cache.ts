import type { ShopApi } from '../api';
import type {
    ActiveCustomer,
    ImageGenerationJob,
    ImageModelQuotaStatus,
    ImagePromptQuotaStatus,
    ImageResolution,
    ImageStudioConfig,
    MarketConfig,
} from '../types';

import { studioCacheState } from './ai-image-studio-cache-state';

export { clearStudioCache } from './ai-image-studio-cache-state';

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

export interface ImageStudioCacheEntry {
    config: ImageStudioConfig | null;
    balance: number | null;
    walletCurrencyCode: string;
    promptQuota: ImagePromptQuotaStatus | null;
    modelQuotas: ImageModelQuotaStatus[];
    jobs: ImageGenerationJob[];
    historyIds: string[];
    historyTotal: number;
    lastFetchedAt: number;
    draft: ImageStudioDraft;
}

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

const { entries: studioCache, activePreloads } = studioCacheState;

export function getStudioCacheKey(marketCode: string, customerId?: string | null): string {
    return `${marketCode}:${customerId ?? 'guest'}`;
}

export function getStudioCachedData(
    marketCode: string,
    customerId?: string | null,
): ImageStudioCacheEntry | null {
    return studioCache.get(getStudioCacheKey(marketCode, customerId)) ?? null;
}

export function setStudioCachedData(
    marketCode: string,
    customerId: string | null | undefined,
    data: Partial<Omit<ImageStudioCacheEntry, 'draft'>> & {
        draft?: Partial<ImageStudioDraft>;
    },
): void {
    const key = getStudioCacheKey(marketCode, customerId);
    const existing = studioCache.get(key);
    const draft: ImageStudioDraft = {
        ...(existing?.draft ?? defaultDraft()),
        ...(data.draft ?? {}),
    };

    studioCache.set(key, {
        config: data.config !== undefined ? data.config : (existing?.config ?? null),
        balance: data.balance !== undefined ? data.balance : (existing?.balance ?? null),
        walletCurrencyCode:
            data.walletCurrencyCode !== undefined
                ? data.walletCurrencyCode
                : (existing?.walletCurrencyCode ?? ''),
        promptQuota: data.promptQuota !== undefined ? data.promptQuota : (existing?.promptQuota ?? null),
        modelQuotas: data.modelQuotas !== undefined ? data.modelQuotas : (existing?.modelQuotas ?? []),
        jobs: data.jobs !== undefined ? data.jobs : (existing?.jobs ?? []),
        historyIds: data.historyIds !== undefined ? data.historyIds : (existing?.historyIds ?? []),
        historyTotal: data.historyTotal !== undefined ? data.historyTotal : (existing?.historyTotal ?? 0),
        lastFetchedAt: data.lastFetchedAt ?? existing?.lastFetchedAt ?? 0,
        draft,
    });
}

export function updateStudioDraftCache(
    marketCode: string,
    customerId: string | null | undefined,
    draftUpdate: Partial<ImageStudioDraft>,
): void {
    const key = getStudioCacheKey(marketCode, customerId);
    const existing = studioCache.get(key);
    if (!existing) return;
    Object.assign(existing.draft, draftUpdate);
}

export async function preloadImageStudioData(
    api: ShopApi,
    customer: ActiveCustomer | null,
    market: MarketConfig,
): Promise<void> {
    const key = getStudioCacheKey(market.code, customer?.id);
    const existing = studioCache.get(key);
    if (existing?.config && existing.lastFetchedAt > 0 && Date.now() - existing.lastFetchedAt < 120_000) {
        return;
    }
    const activePreload = activePreloads.get(key);
    if (activePreload) return activePreload;
    const generation = studioCacheState.generation;

    const preload = (async () => {
        try {
            const studioConfig = await api.imageStudioConfig();
            if (generation !== studioCacheState.generation) return;
            if (!studioConfig) return;
            if (!customer) {
                setStudioCachedData(market.code, null, {
                    config: studioConfig,
                    balance: 0,
                    walletCurrencyCode: market.currencyCode,
                    promptQuota: null,
                    modelQuotas: [],
                    jobs: [],
                    historyIds: [],
                    historyTotal: 0,
                    lastFetchedAt: Date.now(),
                });
                return;
            }
            const [wallet, loadedPromptQuota, loadedModelQuotas] = await Promise.allSettled([
                api.imageStudioWallet(),
                api.imagePromptQuotaStatus(),
                api.imageModelQuotaStatus(),
            ]);
            if (generation !== studioCacheState.generation) return;
            setStudioCachedData(market.code, customer.id, {
                config: studioConfig,
                ...(wallet.status === 'fulfilled' && {
                    balance: wallet.value.availableBalance,
                    walletCurrencyCode: wallet.value.currencyCode,
                }),
                ...(loadedPromptQuota.status === 'fulfilled' && { promptQuota: loadedPromptQuota.value }),
                ...(loadedModelQuotas.status === 'fulfilled' && { modelQuotas: loadedModelQuotas.value }),
                ...([wallet, loadedPromptQuota, loadedModelQuotas].every(
                    result => result.status === 'fulfilled',
                ) && {
                    lastFetchedAt: Date.now(),
                }),
            });
        } catch {
            // Ignore background prefetch errors
        }
    })();
    activePreloads.set(key, preload);
    void preload.finally(() => {
        if (activePreloads.get(key) === preload) activePreloads.delete(key);
    });
    return preload;
}
