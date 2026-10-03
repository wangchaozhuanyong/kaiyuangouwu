import 'reflect-metadata';

import { ForbiddenError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { defaultAccountRecommendationSettings } from './shared/account-recommendation-settings';
import { StorefrontContentAdminResolver, StorefrontContentShopResolver } from './storefront-content.resolver';

describe('account recommendation configuration API', () => {
    it.each([StorefrontContentAdminResolver, StorefrontContentShopResolver])(
        'returns channel settings through %s',
        async ResolverClass => {
            const account = {
                getPersonalDataExportEnabled: vi.fn().mockResolvedValue(false),
                getRecommendations: vi.fn().mockResolvedValue(defaultAccountRecommendationSettings),
            };
            const resolver = new ResolverClass(
                { getSettings: vi.fn().mockResolvedValue({ heroAutoplayIntervalSeconds: 5 }) } as never,
                { get: vi.fn().mockResolvedValue({}) } as never,
                account as never,
            );
            const ctx = { channelId: 'store-a' } as never;
            expect((await resolver.storefrontContentSettings(ctx)).accountRecommendations).toEqual(
                defaultAccountRecommendationSettings,
            );
            expect(account.getRecommendations).toHaveBeenCalledWith(ctx);
        },
    );
    it('passes the selected channel and input to the settings service', () => {
        const account = {
            updateRecommendations: vi.fn().mockReturnValue(defaultAccountRecommendationSettings),
        };
        const resolver = new StorefrontContentAdminResolver({} as never, {} as never, account as never);
        const ctx = { channelId: 'store-a' } as never;
        expect(
            resolver.updateStorefrontAccountRecommendations(ctx, defaultAccountRecommendationSettings),
        ).toEqual(defaultAccountRecommendationSettings);
        expect(account.updateRecommendations).toHaveBeenCalledWith(ctx, defaultAccountRecommendationSettings);
    });
});

describe('StorefrontContentAdminResolver composite permissions', () => {
    it('requires create permission when a batch creates content blocks', () => {
        const storefrontContentService = { applyChanges: vi.fn() };
        const resolver = new StorefrontContentAdminResolver(
            storefrontContentService as any,
            {} as any,
            {} as any,
        );
        const ctx = {
            userHasPermissions: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
        };

        expect(() =>
            resolver.applyStorefrontContentChanges(
                ctx as any,
                {
                    expectedBlocks: [],
                    creates: [{ code: 'hero', type: 'hero' }],
                    updates: [],
                    orderedCodes: ['hero'],
                } as any,
            ),
        ).toThrow(ForbiddenError);
        expect(storefrontContentService.applyChanges).not.toHaveBeenCalled();
    });

    it('allows an update-only batch without create permission', () => {
        const storefrontContentService = { applyChanges: vi.fn().mockReturnValue([]) };
        const resolver = new StorefrontContentAdminResolver(
            storefrontContentService as any,
            {} as any,
            {} as any,
        );
        const ctx = {
            userHasPermissions: vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
        };
        const input = {
            expectedBlocks: [],
            creates: [],
            updates: [],
            orderedCodes: [],
        };

        expect(resolver.applyStorefrontContentChanges(ctx as any, input)).toEqual([]);
        expect(storefrontContentService.applyChanges).toHaveBeenCalledWith(ctx, input);
    });
});
