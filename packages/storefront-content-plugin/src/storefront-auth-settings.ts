import { Injectable } from '@nestjs/common';
import { RequestContext, SettingsStoreService, UserInputError } from '@vendure/core';

export const STOREFRONT_AUTH_SETTINGS_NAMESPACE = 'storefrontAuth';

export const storefrontAuthSettingKeys = {
    emailPasswordEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.emailPasswordEnabled`,
    emailAutoRegistrationEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.emailAutoRegistrationEnabled`,
    emailQuickRegistrationEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.emailQuickRegistrationEnabled`,
    googleEnabled: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.googleEnabled`,
    googleClientId: `${STOREFRONT_AUTH_SETTINGS_NAMESPACE}.googleClientId`,
} as const;

export interface StorefrontAuthSettings {
    emailPasswordEnabled: boolean;
    emailAutoRegistrationEnabled: boolean;
    emailQuickRegistrationEnabled: boolean;
    googleEnabled: boolean;
    googleClientId: string | null;
}

export type UpdateStorefrontAuthSettingsInput = StorefrontAuthSettings;

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
    const values = await settingsStore.getMany(ctx, Object.values(storefrontAuthSettingKeys));
    const booleanValue = (key: keyof typeof storefrontAuthSettingKeys, fallback: boolean) => {
        const value = values[storefrontAuthSettingKeys[key]];
        return typeof value === 'boolean' ? value : fallback;
    };
    return {
        emailPasswordEnabled: booleanValue('emailPasswordEnabled', true),
        emailAutoRegistrationEnabled: booleanValue('emailAutoRegistrationEnabled', false),
        emailQuickRegistrationEnabled: booleanValue('emailQuickRegistrationEnabled', false),
        googleEnabled: booleanValue('googleEnabled', false),
        googleClientId: normalizeGoogleClientId(values[storefrontAuthSettingKeys.googleClientId]),
    };
}

@Injectable()
export class StorefrontAuthSettingsService {
    constructor(private readonly settingsStore: SettingsStoreService) {}

    get(ctx: RequestContext): Promise<StorefrontAuthSettings> {
        return readStorefrontAuthSettings(this.settingsStore, ctx);
    }

    async update(
        ctx: RequestContext,
        input: UpdateStorefrontAuthSettingsInput,
    ): Promise<StorefrontAuthSettings> {
        this.validate(input);
        const googleClientId = normalizeGoogleClientId(input.googleClientId);
        const results = await this.settingsStore.setMany(ctx, {
            [storefrontAuthSettingKeys.emailPasswordEnabled]: input.emailPasswordEnabled,
            [storefrontAuthSettingKeys.emailAutoRegistrationEnabled]: input.emailAutoRegistrationEnabled,
            [storefrontAuthSettingKeys.emailQuickRegistrationEnabled]: input.emailQuickRegistrationEnabled,
            [storefrontAuthSettingKeys.googleEnabled]: input.googleEnabled,
            [storefrontAuthSettingKeys.googleClientId]: googleClientId,
        } as any);
        const failed = results.find(result => !result.result);
        if (failed) {
            throw new UserInputError(failed.error || `Unable to save ${failed.key}`);
        }
        return this.get(ctx);
    }

    private validate(input: UpdateStorefrontAuthSettingsInput): void {
        for (const [key, value] of Object.entries(input)) {
            if (key === 'googleClientId') continue;
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
        const googleClientId = normalizeGoogleClientId(input.googleClientId);
        if (input.googleEnabled && (!googleClientId || !isGoogleWebClientId(googleClientId))) {
            throw new UserInputError('A valid Google OAuth web client ID is required');
        }
        if (googleClientId && !isGoogleWebClientId(googleClientId)) {
            throw new UserInputError('The Google OAuth client ID format is invalid');
        }
    }
}
