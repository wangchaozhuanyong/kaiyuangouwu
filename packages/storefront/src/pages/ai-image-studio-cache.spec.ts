import { dehydrate } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { storefrontQueryClient, storefrontQueryKeys } from '../query-client';
import { type ActiveCustomer, type ImageStudioConfig, type MarketConfig } from '../types';

import {
    clearStudioCache,
    executeStudioWrite,
    getStudioCachedData,
    getStudioCacheKey,
    preloadImageStudioData,
    setStudioCachedData,
    studioWriteAttempt,
    updateStudioDraftCache,
} from './ai-image-studio-cache';
import { clearStudioCache as clearSessionStudioCache } from './ai-image-studio-cache-state';

describe('ai-image-studio-cache', () => {
    beforeEach(() => {
        clearStudioCache();
    });
    afterEach(() => vi.useRealTimers());

    const mockMarket: MarketConfig = {
        code: 'MY',
        currencyCode: 'MYR',
        locale: 'zh-CN',
        defaultLanguageCode: 'zh_Hans',
        countryCode: 'MY',
        label: 'Malaysia',
    };

    const mockScope = { marketCode: 'MY:MYR', languageCode: 'zh_Hans' };

    const mockCustomer: ActiveCustomer = {
        id: 'customer-123',
        emailAddress: 'user@example.com',
        firstName: 'Test',
        lastName: 'User',
        phoneNumber: null,
        addresses: [],
        orders: { items: [], totalItems: 0 },
    };

    const mockConfig: ImageStudioConfig = {
        enabled: true,
        promptOptimizationEnabled: true,
        promptOptimizerModelIds: ['fixture-model'],
        defaultModelCode: 'model-a',
        models: [
            {
                id: 'model-1',
                code: 'model-a',
                displayNameZh: '通用模型',
                displayNameEn: 'General model',
                descriptionZh: '',
                descriptionEn: '',
                officialModelId: 'fixture',
                unitPrice: 100,
                unitPrice2K: 0,
                unitPrice4K: 0,
                currencyCode: 'MYR',
                position: 0,
                isDefault: true,
                healthStatus: 'HEALTHY',
                freeImageEnabled: true,
                dailyFreeImageLimit: 10,
                dailyFreeImageUnlimited: false,
                paidAfterFreeEnabled: true,
                dailyGenerationSafetyLimit: 50,
                resolutionOptions: [{ resolution: '1K', unitPrice: 100, supportedAspectRatios: ['1:1'] }],
            },
        ],
        outputRetentionDays: 30,
        referenceRetentionHours: 24,
        maxReferenceBytes: 5_000_000,
        maxReferencePixels: 4_000_000,
        maxQuantity: 4,
        paidPromptOptimizationEnabled: false,
        paidPromptOptimizationPrice: 0,
        paidPromptOptimizationCurrencyCode: 'MYR',
        promptDailyFreeLimit: 10,
        promptDailyFreeUnlimited: false,
        promptRateLimitPerMinute: 5,
        termsVersion: '1',
        termsZh: '',
        termsEn: '',
    };

    it('isolates cache by marketCode and customerId', () => {
        expect(getStudioCacheKey(mockScope, 'customer-1')).not.toBe(
            getStudioCacheKey(mockScope, 'customer-2'),
        );
        expect(getStudioCacheKey(mockScope, null)).not.toBe(
            getStudioCacheKey({ ...mockScope, languageCode: 'en' }, null),
        );
        expect(getStudioCacheKey(mockScope, null)).not.toBe(
            getStudioCacheKey({ ...mockScope, marketCode: 'MY:CNY' }, null),
        );
    });

    it('stores and retrieves cached studio data', () => {
        expect(getStudioCachedData(mockScope, 'customer-123')).toBeNull();

        setStudioCachedData(mockScope, 'customer-123', {
            config: mockConfig,
            balance: 5000,
            walletCurrencyCode: 'MYR',
        });

        const cached = getStudioCachedData(mockScope, 'customer-123');
        expect(cached).not.toBeNull();
        expect(cached?.config?.defaultModelCode).toBe('model-a');
        expect(cached?.balance).toBe(5000);
        expect(cached?.walletCurrencyCode).toBe('MYR');
        expect(cached?.draft.aspectRatio).toBe('1:1');
    });

    it('updates working draft without overwriting fetched data', () => {
        setStudioCachedData(mockScope, 'customer-123', {
            config: mockConfig,
            balance: 5000,
        });

        updateStudioDraftCache(mockScope, 'customer-123', {
            prompt: '赛博朋克风猫咪',
            aspectRatio: '16:9',
            resolution: '2K',
        });

        const cached = getStudioCachedData(mockScope, 'customer-123');
        expect(cached?.draft.prompt).toBe('赛博朋克风猫咪');
        expect(cached?.draft.aspectRatio).toBe('16:9');
        expect(cached?.draft.resolution).toBe('2K');
        expect(cached?.balance).toBe(5000);
    });

    it('does not clear a public product whose ID equals the studio namespace', () => {
        const key = storefrontQueryKeys.product(mockScope.marketCode, mockScope.languageCode, 'image-studio');
        storefrontQueryClient.setQueryData(key, { id: 'image-studio' });
        try {
            clearStudioCache();
            expect(storefrontQueryClient.getQueryData(key)).toEqual({ id: 'image-studio' });
        } finally {
            storefrontQueryClient.removeQueries({ queryKey: key, exact: true });
        }
    });

    it('clears all cached entries', () => {
        setStudioCachedData(mockScope, 'customer-123', { config: mockConfig });
        expect(getStudioCachedData(mockScope, 'customer-123')).not.toBeNull();

        clearStudioCache();
        expect(getStudioCachedData(mockScope, 'customer-123')).toBeNull();
    });

    it('clears pending writes on session reset and rejects their late readback', async () => {
        let finish!: (result: string) => void;
        const request = { fingerprint: 'fixture', idempotencyKey: 'fixture-request' };
        const readback = vi.fn(() => false);
        const invalidate = vi.spyOn(storefrontQueryClient, 'invalidateQueries');
        try {
            const pending = executeStudioWrite(
                'MY',
                'customer-123',
                'GENERATE',
                request,
                () =>
                    new Promise<string>(resolve => {
                        finish = resolve;
                    }),
                readback,
            );
            await Promise.resolve();
            expect(studioWriteAttempt('MY', 'customer-123', 'GENERATE', 'fixture')).toEqual(request);
            expect(studioWriteAttempt('MY', 'customer-other', 'GENERATE', 'fixture')).toBeUndefined();
            clearStudioCache();
            expect(studioWriteAttempt('MY', 'customer-123', 'GENERATE', 'fixture')).toBeUndefined();
            finish('accepted');
            await pending;
            expect(readback).not.toHaveBeenCalled();
            expect(invalidate).not.toHaveBeenCalled();
            expect(
                storefrontQueryClient.getMutationCache().findAll({ mutationKey: ['studio-write'] }),
            ).toHaveLength(0);
        } finally {
            invalidate.mockRestore();
        }
    });

    it('never dehydrates pending writes or undelivered optimization results', async () => {
        let finish!: (result: { optimizedPrompt: string }) => void;
        const pending = executeStudioWrite(
            'MY',
            'customer-123',
            'OPTIMIZE',
            { fingerprint: 'private-fixture-prompt', idempotencyKey: 'fixture-request' },
            () =>
                new Promise<{ optimizedPrompt: string }>(resolve => {
                    finish = resolve;
                }),
            () => false,
        );
        await Promise.resolve();
        expect(dehydrate(storefrontQueryClient).mutations).toHaveLength(0);
        finish({ optimizedPrompt: 'Private fixture response' });
        await pending;
        expect(
            storefrontQueryClient.getMutationCache().findAll({ mutationKey: ['studio-write'] }),
        ).toHaveLength(1);
        expect(dehydrate(storefrontQueryClient).mutations).toHaveLength(0);
        clearStudioCache();
        expect(
            storefrontQueryClient.getMutationCache().findAll({ mutationKey: ['studio-write'] }),
        ).toHaveLength(0);
    });

    it('shares the same synchronous clear API with the lightweight session owner', () => {
        expect(clearSessionStudioCache).toBe(clearStudioCache);
        setStudioCachedData(mockScope, 'customer-123', { config: mockConfig });
        clearSessionStudioCache();
        expect(getStudioCachedData(mockScope, 'customer-123')).toBeNull();
    });

    it('preloads image studio data into cache', async () => {
        const imageStudioConfig = vi.fn().mockResolvedValue(mockConfig);
        const imageStudioWallet = vi.fn().mockResolvedValue({ availableBalance: 3000, currencyCode: 'MYR' });
        const mockApi = {
            imageStudioConfig,
            imageStudioWallet,
            imagePromptQuotaStatus: vi.fn().mockResolvedValue({
                paidEnabled: false,
                paidPrice: 0,
                currencyCode: 'MYR',
                minute: {
                    limit: 5,
                    unlimited: false,
                    reserved: 0,
                    consumed: 0,
                    remaining: 5,
                    windowEndsAt: '2099-01-01',
                },
                daily: {
                    limit: 10,
                    unlimited: false,
                    reserved: 0,
                    consumed: 0,
                    remaining: 10,
                    windowEndsAt: '2099-01-01',
                },
            }),
            imageModelQuotaStatus: vi.fn().mockResolvedValue([]),
        } as unknown as ShopApi;

        await preloadImageStudioData(mockApi, mockCustomer, mockMarket);

        const cached = getStudioCachedData(mockScope, 'customer-123');
        expect(cached).not.toBeNull();
        expect(cached?.config?.defaultModelCode).toBe('model-a');
        expect(cached?.balance).toBe(3000);
        expect(imageStudioConfig).toHaveBeenCalledTimes(1);
        expect(imageStudioWallet).toHaveBeenCalledTimes(1);

        // Immediate subsequent preload within 120s does not refetch
        await preloadImageStudioData(mockApi, mockCustomer, mockMarket);
        expect(imageStudioConfig).toHaveBeenCalledTimes(1);
    });

    it('preloads another customer while the first account is still waiting', async () => {
        let finishFirst: (config: ImageStudioConfig) => void = () => undefined;
        const firstConfig = new Promise<ImageStudioConfig>(resolve => {
            finishFirst = resolve;
        });
        const firstApi = { imageStudioConfig: vi.fn(() => firstConfig) } as unknown as ShopApi;
        const secondApi = {
            imageStudioConfig: vi.fn().mockResolvedValue(mockConfig),
            imageStudioWallet: vi.fn().mockResolvedValue({ availableBalance: 4000, currencyCode: 'MYR' }),
            imagePromptQuotaStatus: vi.fn().mockResolvedValue(null),
            imageModelQuotaStatus: vi.fn().mockResolvedValue([]),
        } as unknown as ShopApi;
        const secondCustomer = { ...mockCustomer, id: 'customer-456' };

        const firstPreload = preloadImageStudioData(firstApi, mockCustomer, mockMarket);
        const secondPreload = preloadImageStudioData(secondApi, secondCustomer, mockMarket);
        await secondPreload;
        expect(getStudioCachedData(mockScope, secondCustomer.id)?.balance).toBe(4000);
        expect(getStudioCachedData(mockScope, mockCustomer.id)).toBeNull();

        finishFirst(mockConfig);
        await firstPreload;
    });

    it('does not restore a prior session preload after the cache is cleared', async () => {
        let finish: (config: ImageStudioConfig) => void = () => undefined;
        const config = new Promise<ImageStudioConfig>(resolve => {
            finish = resolve;
        });
        const api = { imageStudioConfig: vi.fn(() => config) } as unknown as ShopApi;
        const preload = preloadImageStudioData(api, mockCustomer, mockMarket);
        clearStudioCache();
        finish(mockConfig);
        await preload;
        expect(getStudioCachedData(mockScope, mockCustomer.id)).toBeNull();
    });

    it('preserves failed fields and the draft without refreshing a partial snapshot', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(200_000);
        setStudioCachedData(mockScope, mockCustomer.id, {
            config: mockConfig,
            balance: 5000,
            walletCurrencyCode: 'MYR',
            modelQuotas: [{ modelCode: 'old-model' }] as never,
            lastFetchedAt: 1000,
            draft: { prompt: 'keep my draft' },
        });
        const api = {
            imageStudioConfig: vi.fn().mockResolvedValue({ ...mockConfig, maxQuantity: 2 }),
            imageStudioWallet: vi.fn().mockRejectedValue(new Error('offline')),
            imagePromptQuotaStatus: vi.fn().mockResolvedValue(null),
            imageModelQuotaStatus: vi.fn().mockRejectedValue(new Error('offline')),
        } as unknown as ShopApi;
        await preloadImageStudioData(api, mockCustomer, mockMarket);
        expect(getStudioCachedData(mockScope, mockCustomer.id)).toMatchObject({
            config: { maxQuantity: 2 },
            balance: 5000,
            walletCurrencyCode: 'MYR',
            modelQuotas: [{ modelCode: 'old-model' }],
            lastFetchedAt: 1000,
            draft: { prompt: 'keep my draft' },
        });
        await preloadImageStudioData(api, mockCustomer, mockMarket);
        expect(api.imageStudioWallet).toHaveBeenCalledTimes(2);
    });

    it('does not invent a zero wallet or a fresh timestamp on cold partial failure', async () => {
        const api = {
            imageStudioConfig: vi.fn().mockResolvedValue(mockConfig),
            imageStudioWallet: vi
                .fn()
                .mockRejectedValueOnce(new Error('offline'))
                .mockResolvedValue({ availableBalance: 0, currencyCode: 'MYR' }),
            imagePromptQuotaStatus: vi.fn().mockResolvedValue(null),
            imageModelQuotaStatus: vi.fn().mockResolvedValue([]),
        } as unknown as ShopApi;
        await preloadImageStudioData(api, mockCustomer, mockMarket);
        expect(getStudioCachedData(mockScope, mockCustomer.id)?.balance).toBeNull();
        expect(getStudioCachedData(mockScope, mockCustomer.id)?.lastFetchedAt).toBe(0);
        await preloadImageStudioData(api, mockCustomer, mockMarket);
        expect(getStudioCachedData(mockScope, mockCustomer.id)?.balance).toBe(0);
        expect(getStudioCachedData(mockScope, mockCustomer.id)?.lastFetchedAt).toBeGreaterThan(0);
    });

    it('does not refresh the composite snapshot when only jobs, history or drafts change', () => {
        setStudioCachedData(mockScope, mockCustomer.id, { config: mockConfig, lastFetchedAt: 1000 });
        setStudioCachedData(mockScope, mockCustomer.id, { jobs: [], historyIds: ['new'], historyTotal: 1 });
        updateStudioDraftCache(mockScope, mockCustomer.id, { prompt: 'new draft' });
        expect(getStudioCachedData(mockScope, mockCustomer.id)?.lastFetchedAt).toBe(1000);
    });

    it('does not roll back history or drafts edited while a preload is waiting', async () => {
        let finishWallet: (value: { availableBalance: number; currencyCode: string }) => void = () =>
            undefined;
        const wallet = new Promise<{ availableBalance: number; currencyCode: string }>(resolve => {
            finishWallet = resolve;
        });
        setStudioCachedData(mockScope, mockCustomer.id, { config: mockConfig });
        const api = {
            imageStudioConfig: vi.fn().mockResolvedValue(mockConfig),
            imageStudioWallet: vi.fn(() => wallet),
            imagePromptQuotaStatus: vi.fn().mockResolvedValue(null),
            imageModelQuotaStatus: vi.fn().mockResolvedValue([]),
        } as unknown as ShopApi;
        const preload = preloadImageStudioData(api, mockCustomer, mockMarket);
        setStudioCachedData(mockScope, mockCustomer.id, { historyIds: ['new-history'], historyTotal: 1 });
        updateStudioDraftCache(mockScope, mockCustomer.id, { prompt: 'new draft' });
        finishWallet({ availableBalance: 10, currencyCode: 'MYR' });
        await preload;
        expect(getStudioCachedData(mockScope, mockCustomer.id)).toMatchObject({
            historyIds: ['new-history'],
            historyTotal: 1,
            draft: { prompt: 'new draft' },
        });
    });
});
