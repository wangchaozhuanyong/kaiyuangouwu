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
    balance: number;
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

const studioCache = new Map<string, ImageStudioCacheEntry>();
const activePreloads = new Map<string, Promise<void>>();
let cacheGeneration = 0;

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
        balance: data.balance !== undefined ? data.balance : (existing?.balance ?? 0),
        walletCurrencyCode:
            data.walletCurrencyCode !== undefined
                ? data.walletCurrencyCode
                : (existing?.walletCurrencyCode ?? ''),
        promptQuota: data.promptQuota !== undefined ? data.promptQuota : (existing?.promptQuota ?? null),
        modelQuotas: data.modelQuotas !== undefined ? data.modelQuotas : (existing?.modelQuotas ?? []),
        jobs: data.jobs !== undefined ? data.jobs : (existing?.jobs ?? []),
        historyIds: data.historyIds !== undefined ? data.historyIds : (existing?.historyIds ?? []),
        historyTotal: data.historyTotal !== undefined ? data.historyTotal : (existing?.historyTotal ?? 0),
        lastFetchedAt: Date.now(),
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

export function clearStudioCache(): void {
    cacheGeneration += 1;
    studioCache.clear();
    activePreloads.clear();
}

export async function preloadImageStudioData(
    api: ShopApi,
    customer: ActiveCustomer | null,
    market: MarketConfig,
): Promise<void> {
    const key = getStudioCacheKey(market.code, customer?.id);
    const existing = studioCache.get(key);
    if (existing?.config && Date.now() - existing.lastFetchedAt < 120_000) {
        return;
    }
    const activePreload = activePreloads.get(key);
    if (activePreload) return activePreload;
    const generation = cacheGeneration;

    const preload = (async () => {
        try {
            const studioConfig = await api.imageStudioConfig();
            if (generation !== cacheGeneration) return;
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
                });
                return;
            }
            const [wallet, loadedPromptQuota, loadedModelQuotas] = await Promise.allSettled([
                api.imageStudioWallet(),
                api.imagePromptQuotaStatus(),
                api.imageModelQuotaStatus(),
            ]);
            if (generation !== cacheGeneration) return;
            const walletVal = wallet.status === 'fulfilled' ? wallet.value : undefined;
            const promptQuotaVal = loadedPromptQuota.status === 'fulfilled' ? loadedPromptQuota.value : null;
            const modelQuotasVal = loadedModelQuotas.status === 'fulfilled' ? loadedModelQuotas.value : [];
            setStudioCachedData(market.code, customer.id, {
                config: studioConfig,
                balance: walletVal?.availableBalance ?? 0,
                walletCurrencyCode: walletVal?.currencyCode ?? market.currencyCode,
                promptQuota: promptQuotaVal,
                modelQuotas: modelQuotasVal,
                jobs: existing?.jobs ?? [],
                historyIds: existing?.historyIds ?? [],
                historyTotal: existing?.historyTotal ?? 0,
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
