import { describe, expect, it, vi } from 'vitest';

import {
    defaultStorefrontAuthSettings,
    readStorefrontAuthConfiguration,
    readStorefrontAuthSettings,
    storefrontAuthSettingKeys,
    StorefrontAuthSettingsService,
} from './storefront-auth-settings';

const clientId = '123456789-test.apps.googleusercontent.com';
const platformClientId = '987654321-platform.apps.googleusercontent.com';
const enabledStoreSettings = {
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: true,
    emailQuickRegistrationEnabled: true,
    googleOverrideEnabled: true,
    storeGoogleEnabled: true,
    storeGoogleClientId: clientId,
};

describe('storefront auth settings', () => {
    it('uses safe defaults and platform inheritance when nothing has been saved', async () => {
        const settingsStore = { getMany: vi.fn().mockResolvedValue({}) };

        await expect(readStorefrontAuthSettings(settingsStore as never, {} as never)).resolves.toEqual(
            defaultStorefrontAuthSettings,
        );
        await expect(
            readStorefrontAuthConfiguration(settingsStore as never, {} as never),
        ).resolves.toMatchObject({
            googleOverrideEnabled: false,
            platformGoogleEnabled: false,
            effectiveGoogleEnabled: false,
            googleConfigurationSource: 'PLATFORM',
        });
        expect(settingsStore.getMany).toHaveBeenCalledWith({}, Object.values(storefrontAuthSettingKeys));
    });

    it('inherits the normalized platform Google configuration by default', async () => {
        const settingsStore = {
            getMany: vi.fn().mockResolvedValue({
                [storefrontAuthSettingKeys.emailPasswordEnabled]: false,
                [storefrontAuthSettingKeys.platformGoogleEnabled]: true,
                [storefrontAuthSettingKeys.platformGoogleClientId]: ` ${platformClientId} `,
            }),
        };

        await expect(readStorefrontAuthSettings(settingsStore as never, {} as never)).resolves.toEqual({
            ...defaultStorefrontAuthSettings,
            emailPasswordEnabled: false,
            googleEnabled: true,
            googleClientId: platformClientId,
        });
    });

    it('preserves legacy channel Google settings as an explicit store override', async () => {
        const settingsStore = {
            getMany: vi.fn().mockResolvedValue({
                [storefrontAuthSettingKeys.googleEnabled]: false,
                [storefrontAuthSettingKeys.googleClientId]: clientId,
                [storefrontAuthSettingKeys.platformGoogleEnabled]: true,
                [storefrontAuthSettingKeys.platformGoogleClientId]: platformClientId,
            }),
        };

        await expect(
            readStorefrontAuthConfiguration(settingsStore as never, {} as never),
        ).resolves.toMatchObject({
            googleOverrideEnabled: true,
            storeGoogleEnabled: false,
            storeGoogleClientId: clientId,
            effectiveGoogleEnabled: false,
            effectiveGoogleClientId: clientId,
            googleConfigurationSource: 'STORE',
        });
    });

    it('uses platform values when the store explicitly disables its override', async () => {
        const settingsStore = {
            getMany: vi.fn().mockResolvedValue({
                [storefrontAuthSettingKeys.googleOverrideEnabled]: false,
                [storefrontAuthSettingKeys.googleEnabled]: false,
                [storefrontAuthSettingKeys.googleClientId]: clientId,
                [storefrontAuthSettingKeys.platformGoogleEnabled]: true,
                [storefrontAuthSettingKeys.platformGoogleClientId]: platformClientId,
            }),
        };

        await expect(readStorefrontAuthSettings(settingsStore as never, {} as never)).resolves.toMatchObject({
            googleEnabled: true,
            googleClientId: platformClientId,
        });
    });

    it('rejects dependent email options and incomplete store Google configuration', async () => {
        const service = new StorefrontAuthSettingsService({} as never);

        await expect(
            service.update({} as never, {
                ...enabledStoreSettings,
                emailPasswordEnabled: false,
            }),
        ).rejects.toThrow('Email registration options require email and password sign-in');
        await expect(
            service.update({} as never, { ...enabledStoreSettings, storeGoogleClientId: null }),
        ).rejects.toThrow('A valid Google OAuth web client ID is required');
    });

    it('persists current-store settings separately and reports a failed write', async () => {
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

        await service.update(ctx as never, enabledStoreSettings);
        expect(setMany).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                [storefrontAuthSettingKeys.googleOverrideEnabled]: true,
                [storefrontAuthSettingKeys.googleClientId]: clientId,
                [storefrontAuthSettingKeys.googleEnabled]: true,
            }),
        );
        expect(setMany.mock.calls[0]?.[1]).not.toHaveProperty(
            storefrontAuthSettingKeys.platformGoogleClientId,
        );

        setMany.mockResolvedValue([
            {
                key: storefrontAuthSettingKeys.googleEnabled,
                result: false,
                error: 'write failed',
            },
        ]);
        await expect(service.update(ctx as never, enabledStoreSettings)).rejects.toThrow('write failed');
    });

    it('persists the platform Google default without changing channel values', async () => {
        const ctx = { channelId: 'channel-1' };
        const setMany = vi.fn((_: unknown, values: Record<string, unknown>) =>
            Promise.resolve(Object.keys(values).map(key => ({ key, result: true }))),
        );
        const service = new StorefrontAuthSettingsService({
            setMany,
            getMany: vi.fn().mockResolvedValue({}),
        } as never);

        await service.updatePlatformGoogle(ctx as never, {
            googleEnabled: true,
            googleClientId: ` ${platformClientId} `,
        });

        expect(setMany).toHaveBeenCalledWith(ctx, {
            [storefrontAuthSettingKeys.platformGoogleEnabled]: true,
            [storefrontAuthSettingKeys.platformGoogleClientId]: platformClientId,
        });
        expect(setMany.mock.calls[0]?.[1]).not.toHaveProperty(storefrontAuthSettingKeys.googleEnabled);
    });
});
