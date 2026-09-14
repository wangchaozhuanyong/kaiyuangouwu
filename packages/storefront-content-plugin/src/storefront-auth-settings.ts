import { Injectable } from '@nestjs/common';
import { RequestContext, SettingsStoreService, UserInputError } from '@vendure/core';

export const STOREFRONT_AUTH_SETTINGS_NAMESPACE = 'storefrontAuth';

export const storefrontAuthSettingKeys = {
    emailPasswordEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.emailPasswordEnabled`,
    emailAutoRegistrationEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.emailAutoRegistrationEnabled`,
    emailQuickRegistrationEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.emailQuickRegistrationEnabled`,
    googleOverrideEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.googleOverrideEnabled`,
    googleEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.googleEnabled`,
    googleClientId: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.googleClientId`,
    platformGoogleEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.platformGoogleEnabled`,
    platformGoogleClientId: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.platformGoogleClientId`,
} as const;

export interface StorefrontAuthSettings {
    emailPasswordEnabled: boolean;
    emailAutoRegistrationEnabled: boolean;
    emailQuickRegistrationEnabled: boolean;
    googleEnabled: boolean;
    googleClientId: string | null;
}

export interface StorefrontAuthConfiguration {
    emailPasswordEnabled: boolean;
    emailAutoRegistrationEnabled: boolean;
    emailQuickRegistrationEnabled: boolean;
    googleOverrideEnabled: boolean;
    storeGoogleEnabled: boolean;
    storeGoogleClientId: string | null;
    platformGoogleEnabled: boolean;
    platformGoogleClientId: string | null;
    effectiveGoogleEnabled: boolean;
    effectiveGoogleClientId: string | null;
    googleConfigurationSource: 'PLATFORM' | 'STORE';
}

export interface UpdateStorefrontAuthSettingsInput {
    emailPasswordEnabled: boolean;
    emailAutoRegistrationEnabled: boolean;
    emailQuickRegistrationEnabled: boolean;
    googleOverrideEnabled: boolean;
    storeGoogleEnabled: boolean;
    storeGoogleClientId: string | null;
}

export interface UpdateStorefrontGooglePlatformSettingsInput {
    googleEnabled: boolean;
    googleClientId: string | null;
}

export const defaultStorefrontAuthSettings: StorefrontAuthSettings = {
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: false,
    emailQuickRegistrationEnabled: false,
    googleEnabled: false,
    googleClientId: null,
};

export function normalizeGoogleClientId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

export function isGoogleWebClientId(value: string): boolean {
    return /^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/iu.test(value);
}

export async function readStorefrontAuthSettings(
    settingsStore: SettingsStoreService,
    ctx: RequestContext,
): Promise<StorefrontAuthSettings> {
    const configuration = await readStorefrontAuthConfiguration(settingsStore, ctx);
    return {
        emailPasswordEnabled: configuration.emailPasswordEnabled,
        emailAutoRegistrationEnabled: configuration.emailAutoRegistrationEnabled,
        emailQuickRegistrationEnabled: configuration.emailQuickRegistrationEnabled,
        googleEnabled: configuration.effectiveGoogleEnabled,
        googleClientId: configuration.effectiveGoogleClientId,
    };
}

export async function readStorefrontAuthConfiguration(
    settingsStore: SettingsStoreService,
    ctx: RequestContext,
): Promise<StorefrontAuthConfiguration> {
    const values = await settingsStore.getMany(ctx, Object.values(storefrontAuthSettingKeys));
    const booleanValue = (key: keyof typeof storefrontAuthSettingKeys, fallback: boolean) => {
        const value = values[storefrontAuthSettingKeys[key]];
        return typeof value === 'boolean' ? value : fallback;
    };
    const storeGoogleClientId = normalizeGoogleClientId(values[storefrontAuthSettingKeys.googleClientId]);
    const platformGoogleClientId = normalizeGoogleClientId(
        values[storefrontAuthSettingKeys.platformGoogleClientId],
    );
    const savedOverride = values[storefrontAuthSettingKeys.googleOverrideEnabled];
    const hasLegacyStoreGoogleSettings =
        typeof values[storefrontAuthSettingKeys.googleEnabled] === 'boolean' || storeGoogleClientId !== null;
    const googleOverrideEnabled =
        typeof savedOverride === 'boolean' ? savedOverride : hasLegacyStoreGoogleSettings;
    const storeGoogleEnabled = booleanValue('googleEnabled', false);
    const platformGoogleEnabled = booleanValue('platformGoogleEnabled', false);
    const googleConfigurationSource = googleOverrideEnabled ? 'STORE' : 'PLATFORM';
    return {
        emailPasswordEnabled: booleanValue('emailPasswordEnabled', true),
        emailAutoRegistrationEnabled: booleanValue('emailAutoRegistrationEnabled', false),
        emailQuickRegistrationEnabled: booleanValue('emailQuickRegistrationEnabled', false),
        googleOverrideEnabled,
        storeGoogleEnabled,
        storeGoogleClientId,
        platformGoogleEnabled,
        platformGoogleClientId,
        effectiveGoogleEnabled: googleOverrideEnabled ? storeGoogleEnabled : platformGoogleEnabled,
        effectiveGoogleClientId: googleOverrideEnabled ? storeGoogleClientId : platformGoogleClientId,
        googleConfigurationSource,
    };
}

@Injectable()
export class StorefrontAuthSettingsService {
    constructor(private readonly settingsStore: SettingsStoreService) {}

    get(ctx: RequestContext): Promise<StorefrontAuthSettings> {
        return readStorefrontAuthSettings(this.settingsStore, ctx);
    }

    getConfiguration(ctx: RequestContext): Promise<StorefrontAuthConfiguration> {
        return readStorefrontAuthConfiguration(this.settingsStore, ctx);
    }

    async update(
        ctx: RequestContext,
        input: UpdateStorefrontAuthSettingsInput,
    ): Promise<StorefrontAuthConfiguration> {
        this.validateStoreSettings(input);
        const storeGoogleClientId = normalizeGoogleClientId(input.storeGoogleClientId);
        const results = await this.settingsStore.setMany(ctx, {
            [storefrontAuthSettingKeys.emailPasswordEnabled]: input.emailPasswordEnabled,
            [storefrontAuthSettingKeys.emailAutoRegistrationEnabled]: input.emailAutoRegistrationEnabled,
            [storefrontAuthSettingKeys.emailQuickRegistrationEnabled]: input.emailQuickRegistrationEnabled,
            [storefrontAuthSettingKeys.googleOverrideEnabled]: input.googleOverrideEnabled,
            [storefrontAuthSettingKeys.googleEnabled]: input.storeGoogleEnabled,
            [storefrontAuthSettingKeys.googleClientId]: storeGoogleClientId,
        } as any);
        this.assertWritesSucceeded(results);
        return this.getConfiguration(ctx);
    }

    async updatePlatformGoogle(
        ctx: RequestContext,
        input: UpdateStorefrontGooglePlatformSettingsInput,
    ): Promise<StorefrontAuthConfiguration> {
        this.validateGoogleSettings(input.googleEnabled, input.googleClientId);
        const results = await this.settingsStore.setMany(ctx, {
            [storefrontAuthSettingKeys.platformGoogleEnabled]: input.googleEnabled,
            [storefrontAuthSettingKeys.platformGoogleClientId]: normalizeGoogleClientId(input.googleClientId),
        } as any);
        this.assertWritesSucceeded(results);
        return this.getConfiguration(ctx);
    }

    private validateStoreSettings(input: UpdateStorefrontAuthSettingsInput): void {
        for (const [key, value] of Object.entries(input)) {
            if (key === 'storeGoogleClientId') continue;
            if (typeof value !== 'boolean') {
                throw new UserInputError(`${key} must be a boolean`);
            }
        }
        if (
            !input.emailPasswordEnabled &&
            (input.emailAutoRegistrationEnabled || input.emailQuickRegistrationEnabled)
        ) {
            throw new UserInputError('Email registration options require email and password sign-in');
        }
        this.validateGoogleSettings(input.storeGoogleEnabled, input.storeGoogleClientId);
    }

    private validateGoogleSettings(enabled: boolean, clientId: string | null): void {
        if (typeof enabled !== 'boolean') {
            throw new UserInputError('googleEnabled must be a boolean');
        }
        const googleClientId = normalizeGoogleClientId(clientId);
        if (enabled && (!googleClientId || !isGoogleWebClientId(googleClientId))) {
            throw new UserInputError('A valid Google OAuth web client ID is required');
        }
        if (googleClientId && !isGoogleWebClientId(googleClientId)) {
            throw new UserInputError('The Google OAuth client ID format is invalid');
        }
    }

    private assertWritesSucceeded(results: Array<{ key: string; result: boolean; error?: string }>): void {
        const failed = results.find(result => !result.result);
        if (failed) {
            throw new UserInputError(failed.error || `Unable to save ${failed.key}`);
        }
    }
}
