import { describe, expect, it, vi } from 'vitest';

import { defaultAccountRecommendationSettings } from './shared/account-recommendation-settings';
import {
    accountRecommendationsKey,
    personalDataExportEnabledKey,
    StorefrontAccountSettingsService,
} from './storefront-account-settings';

describe('account recommendations settings', () => {
    it('defaults to eight products and verifies channel-scoped settings and invalidation', async () => {
        const values = new Map<string, unknown>();
        const store = {
            getMany: vi.fn((ctx: { channelId: string }) =>
                Promise.resolve({
                    [accountRecommendationsKey]: values.get(ctx.channelId),
                }),
            ),
            setMany: vi.fn((ctx: { channelId: string }, input: Record<string, unknown>) => {
                values.set(ctx.channelId, input[accountRecommendationsKey]);
                return Promise.resolve([{ result: true }]);
            }),
        };
        const events = { publish: vi.fn() };
        const service = new StorefrontAccountSettingsService(store as never, events as never);
        const a = { channelId: 'a' } as never;
        const b = { channelId: 'b' } as never;
        await expect(service.getRecommendations(a)).resolves.toEqual(defaultAccountRecommendationSettings);
        const value = { enabled: false, titleZh: '  店铺推荐  ', titleEn: 'Store picks', limit: 6 };
        await expect(service.updateRecommendations(a, value)).resolves.toEqual({
            ...value,
            titleZh: '店铺推荐',
        });
        await expect(service.getRecommendations(b)).resolves.toEqual(defaultAccountRecommendationSettings);
        expect(events.publish).toHaveBeenCalledTimes(1);
        expect(events.publish.mock.calls[0][0].ctx).toBe(a);
    });

    it.each([
        { limit: 0 },
        { limit: 11 },
        { limit: 2.5 },
        { enabled: 'true' },
        { titleZh: '  ' },
        { titleEn: 'a'.repeat(81) },
    ])('rejects invalid input %s before writing', async invalid => {
        const store = { setMany: vi.fn() };
        const service = new StorefrontAccountSettingsService(store as never);
        await expect(
            service.updateRecommendations(
                {} as never,
                { ...defaultAccountRecommendationSettings, ...invalid } as never,
            ),
        ).rejects.toThrow();
        expect(store.setMany).not.toHaveBeenCalled();
    });

    it('does not mistake defaults for persisted readback or publish failed writes', async () => {
        const store = {
            getMany: vi.fn().mockResolvedValue({}),
            setMany: vi.fn().mockResolvedValue([{ result: true }]),
        };
        const events = { publish: vi.fn() };
        const service = new StorefrontAccountSettingsService(store as never, events as never);
        await expect(
            service.updateRecommendations({} as never, { ...defaultAccountRecommendationSettings }),
        ).rejects.toThrow('verify');
        store.setMany.mockResolvedValue([{ result: false }]);
        await expect(
            service.updateRecommendations({} as never, { ...defaultAccountRecommendationSettings }),
        ).rejects.toThrow('save');
        expect(events.publish).not.toHaveBeenCalled();
    });
});

describe('personal-data export entry settings', () => {
    it.each([undefined, null, false, 'true', 1])('defaults off for %s', async value => {
        const store = { getMany: vi.fn().mockResolvedValue({ [personalDataExportEnabledKey]: value }) };
        const service = new StorefrontAccountSettingsService(store as never);
        await expect(service.getPersonalDataExportEnabled({ channelId: 'a' } as never)).resolves.toBe(false);
    });

    it('verifies store-scoped enable and disable and publishes content invalidation', async () => {
        const values = new Map<string, boolean>();
        const store = {
            getMany: vi.fn((ctx: { channelId: string }) =>
                Promise.resolve({
                    [personalDataExportEnabledKey]: values.get(ctx.channelId),
                }),
            ),
            setMany: vi.fn((ctx: { channelId: string }, input: Record<string, boolean>) => {
                values.set(ctx.channelId, input[personalDataExportEnabledKey]);
                return Promise.resolve([{ key: personalDataExportEnabledKey, result: true }]);
            }),
        };
        const events = { publish: vi.fn() };
        const service = new StorefrontAccountSettingsService(store as never, events as never);
        const context = { channelId: 'a' } as never;
        await expect(service.updatePersonalDataExportEnabled(context, true)).resolves.toBe(true);
        await expect(service.getPersonalDataExportEnabled({ channelId: 'b' } as never)).resolves.toBe(false);
        await expect(service.updatePersonalDataExportEnabled(context, false)).resolves.toBe(false);
        expect(events.publish).toHaveBeenCalledTimes(2);
        expect(events.publish.mock.calls[0][0].ctx).toBe(context);
    });

    it('rejects invalid writes and storage failures without publishing success', async () => {
        const store = {
            getMany: vi.fn(),
            setMany: vi.fn().mockResolvedValue([{ result: false, error: 'fixture failure' }]),
        };
        const events = { publish: vi.fn() };
        const service = new StorefrontAccountSettingsService(store as never, events as never);
        await expect(service.updatePersonalDataExportEnabled({} as never, 'true' as never)).rejects.toThrow(
            'boolean',
        );
        expect(store.setMany).not.toHaveBeenCalled();
        await expect(service.updatePersonalDataExportEnabled({} as never, true)).rejects.toThrow(
            'fixture failure',
        );
        store.setMany.mockResolvedValue([{ result: true, error: '' }]);
        store.getMany.mockResolvedValue({});
        await expect(service.updatePersonalDataExportEnabled({} as never, true)).rejects.toThrow('verify');
        expect(events.publish).not.toHaveBeenCalled();
    });
});
