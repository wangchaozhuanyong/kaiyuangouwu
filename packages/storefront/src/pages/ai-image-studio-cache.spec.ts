import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShopApi } from '../api';
import type { ActiveCustomer, ImageStudioConfig, MarketConfig } from '../types';

import {
    clearStudioCache,
    getStudioCachedData,
    getStudioCacheKey,
    preloadImageStudioData,
    setStudioCachedData,
    updateStudioDraftCache,
} from './ai-image-studio-cache';

describe('ai-image-studio-cache', () => {
    beforeEach(() => {
        clearStudioCache();
    });

    const mockMarket: MarketConfig = {
        code: 'MY',
        currencyCode: 'MYR',
        locale: 'zh-CN',
        defaultLanguageCode: 'zh_Hans',
        countryCode: 'MY',
        label: 'Malaysia',
    };

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
        expect(getStudioCacheKey('MY', 'customer-1')).toBe('MY:customer-1');
        expect(getStudioCacheKey('CN', null)).toBe('CN:guest');
    });

    it('stores and retrieves cached studio data', () => {
        expect(getStudioCachedData('MY', 'customer-123')).toBeNull();

        setStudioCachedData('MY', 'customer-123', {
            config: mockConfig,
            balance: 5000,
            walletCurrencyCode: 'MYR',
        });

        const cached = getStudioCachedData('MY', 'customer-123');
        expect(cached).not.toBeNull();
        expect(cached?.config?.defaultModelCode).toBe('model-a');
        expect(cached?.balance).toBe(5000);
        expect(cached?.walletCurrencyCode).toBe('MYR');
        expect(cached?.draft.aspectRatio).toBe('1:1');
    });

    it('updates working draft without overwriting fetched data', () => {
        setStudioCachedData('MY', 'customer-123', {
            config: mockConfig,
            balance: 5000,
        });

        updateStudioDraftCache('MY', 'customer-123', {
            prompt: '赛博朋克风猫咪',
            aspectRatio: '16:9',
            resolution: '2K',
        });

        const cached = getStudioCachedData('MY', 'customer-123');
        expect(cached?.draft.prompt).toBe('赛博朋克风猫咪');
        expect(cached?.draft.aspectRatio).toBe('16:9');
        expect(cached?.draft.resolution).toBe('2K');
        expect(cached?.balance).toBe(5000);
    });

    it('clears all cached entries', () => {
        setStudioCachedData('MY', 'customer-123', { config: mockConfig });
        expect(getStudioCachedData('MY', 'customer-123')).not.toBeNull();

        clearStudioCache();
        expect(getStudioCachedData('MY', 'customer-123')).toBeNull();
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

        const cached = getStudioCachedData('MY', 'customer-123');
        expect(cached).not.toBeNull();
        expect(cached?.config?.defaultModelCode).toBe('model-a');
        expect(cached?.balance).toBe(3000);
        expect(imageStudioConfig).toHaveBeenCalledTimes(1);
        expect(imageStudioWallet).toHaveBeenCalledTimes(1);

        // Immediate subsequent preload within 120s does not refetch
        await preloadImageStudioData(mockApi, mockCustomer, mockMarket);
        expect(imageStudioConfig).toHaveBeenCalledTimes(1);
    });
});
