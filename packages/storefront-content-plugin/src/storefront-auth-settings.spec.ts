import { describe, expect, it, vi } from 'vitest';

import {
    defaultStorefrontAuthSettings,
    readStorefrontAuthSettings,
    storefrontAuthSettingKeys,
    StorefrontAuthSettingsService,
} from './storefront-auth-settings';

const enabledSettings = {
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: true,
    emailQuickRegistrationEnabled: true,
    googleEnabled: true,
    googleClientId: '123456789-test.apps.googleusercontent.com',
};

describe('storefront auth settings', () => {
    it('uses safe defaults when a channel has no saved settings', async () => {
        const settingsStore = { getMany: vi.fn().mockResolvedValue({}) };

        await expect(readStorefrontAuthSettings(settingsStore as never, {} as never)).resolves.toEqual(
            defaultStorefrontAuthSettings,
        );
        expect(settingsStore.getMany).toHaveBeenCalledWith({}, Object.values(storefrontAuthSettingKeys));
    });

    it('normalizes the public Google client ID and keeps channel values', async () => {
        const settingsStore = {
            getMany: vi.fn().mockResolvedValue({
                [storefrontAuthSettingKeys.emailPasswordEnabled]: false,
                [storefrontAuthSettingKeys.googleEnabled]: true,
                [storefrontAuthSettingKeys.googleClientId]: ' 123456789-test.apps.googleusercontent.com ',
            }),
        };

        await expect(readStorefrontAuthSettings(settingsStore as never, {} as never)).resolves.toEqual({
            ...defaultStorefrontAuthSettings,
            emailPasswordEnabled: false,
            googleEnabled: true,
            googleClientId: '123456789-test.apps.googleusercontent.com',
        });
    });

    it('rejects dependent email options and incomplete Google configuration', async () => {
        const service = new StorefrontAuthSettingsService({} as never);

        await expect(
            service.update({} as never, {
                ...enabledSettings,
                emailPasswordEnabled: false,
            }),
        ).rejects.toThrow('Email registration options require email and password sign-in');
        await expect(
            service.update({} as never, { ...enabledSettings, googleClientId: null }),
        ).rejects.toThrow('A valid Google OAuth web client ID is required');
    });

    it('persists all current-channel settings and reports a failed write', async () => {
        const ctx = { channelId: 'channel-1' };
        const setMany = vi.fn(
            (
                _ctx: unknown,
                values: Record<string, unknown>,
            ): Promise<Array<{ key: string; result: boolean; error?: string }>> =>
                Promise.resolve(Object.keys(values).map(key => ({ key, result: true }))),
        );
        const settingsStore = {
            setMany,
            getMany: vi.fn().mockResolvedValue({}),
        };
        const service = new StorefrontAuthSettingsService(settingsStore as never);

        await service.update(ctx as never, enabledSettings);
        expect(setMany).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                [storefrontAuthSettingKeys.googleClientId]: enabledSettings.googleClientId,
                [storefrontAuthSettingKeys.googleEnabled]: true,
            }),
        );

        setMany.mockResolvedValue([
            {
                key: storefrontAuthSettingKeys.googleEnabled,
                result: false,
                error: 'write failed',
            },
        ]);
        await expect(service.update(ctx as never, enabledSettings)).rejects.toThrow('write failed');
    });
});
