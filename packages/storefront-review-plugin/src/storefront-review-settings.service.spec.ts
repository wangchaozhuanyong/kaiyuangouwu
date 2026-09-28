import { describe, expect, it, vi } from 'vitest';

import { StorefrontReviewSettingsService } from './storefront-review-settings.service';

describe('StorefrontReviewSettingsService', () => {
    it('defaults existing stores to enabled and reads back a disabled channel setting', async () => {
        const valuesByChannel = new Map<string, Record<string, unknown>>();
        const settingsStore = {
            getMany: vi.fn((requestContext: { channelId: string }) =>
                Promise.resolve({ ...valuesByChannel.get(requestContext.channelId) }),
            ),
            setMany: vi.fn((requestContext: { channelId: string }, input: Record<string, unknown>) => {
                valuesByChannel.set(requestContext.channelId, {
                    ...valuesByChannel.get(requestContext.channelId),
                    ...input,
                });
                return Promise.resolve(Object.keys(input).map(key => ({ key, result: true })));
            }),
        };
        const publish = vi.fn(() => Promise.resolve(undefined));
        const service = new StorefrontReviewSettingsService(settingsStore as any, { publish } as any);
        const ctx = { channelId: 'store-a' } as any;
        const otherStore = { channelId: 'store-b' } as any;

        await expect(service.get(ctx)).resolves.toEqual({ enabled: true });
        await expect(service.update(ctx, false)).resolves.toEqual({ enabled: false });
        expect(settingsStore.setMany).toHaveBeenCalledWith(ctx, { 'storefrontReview.enabled': false });
        await expect(service.get(ctx)).resolves.toEqual({ enabled: false });
        await expect(service.get(otherStore)).resolves.toEqual({ enabled: true });
        expect(publish).toHaveBeenCalledWith(
            expect.objectContaining({ realtimeEventKind: 'storefront-review-settings-changed', ctx }),
        );
    });

    it('does not claim a failed settings write succeeded', async () => {
        const service = new StorefrontReviewSettingsService({
            setMany: vi.fn(() => Promise.resolve([{ key: 'storefrontReview.enabled', result: false }])),
        } as any);
        await expect(service.update({ channelId: 'store-a' } as any, false)).rejects.toThrow(
            'Could not save review settings',
        );
    });

    it('rejects a write that does not survive readback', async () => {
        const service = new StorefrontReviewSettingsService({
            setMany: vi.fn(() => Promise.resolve([{ key: 'storefrontReview.enabled', result: true }])),
            getMany: vi.fn(() => Promise.resolve({})),
        } as any);
        await expect(service.update({ channelId: 'store-a' } as any, false)).rejects.toThrow(
            'Could not verify review settings',
        );
    });
});
