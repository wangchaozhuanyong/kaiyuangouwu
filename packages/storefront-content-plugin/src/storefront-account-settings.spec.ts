import { describe, expect, it, vi } from 'vitest';

import {
    personalDataExportEnabledKey,
    StorefrontAccountSettingsService,
} from './storefront-account-settings';

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
