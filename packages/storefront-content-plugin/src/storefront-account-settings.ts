import { Injectable, Optional } from '@nestjs/common';
import { EventBus, RequestContext, SettingsStoreService, UserInputError } from '@vendure/core';

import {
    accountRecommendationSettingsEqual,
    accountRecommendationSettingsError,
    resolveAccountRecommendationSettings,
    type AccountRecommendationSettings,
} from './shared/account-recommendation-settings';
import { StorefrontContentChangedEvent } from './storefront-content-changed.event';

export const STOREFRONT_ACCOUNT_SETTINGS_NAMESPACE = 'storefrontAccount';
export const personalDataExportEnabledKey = `${STOREFRONT_ACCOUNT_SETTINGS_NAMESPACE}.personalDataExportEnabled`;

export const accountRecommendationsKey = `${STOREFRONT_ACCOUNT_SETTINGS_NAMESPACE}.recommendations`;

/** Channel-scoped account display settings; authenticated account APIs are unchanged. */
@Injectable()
export class StorefrontAccountSettingsService {
    constructor(
        private readonly settingsStore: SettingsStoreService,
        @Optional() private readonly eventBus?: EventBus,
    ) {}

    async getRecommendations(ctx: RequestContext): Promise<AccountRecommendationSettings> {
        const values = await this.settingsStore.getMany(ctx, [accountRecommendationsKey]);
        return resolveAccountRecommendationSettings(values[accountRecommendationsKey]);
    }

    async updateRecommendations(
        ctx: RequestContext,
        input: AccountRecommendationSettings,
    ): Promise<AccountRecommendationSettings> {
        const error = accountRecommendationSettingsError(input);
        if (error) throw new UserInputError(error);
        const value = resolveAccountRecommendationSettings(input);
        const results = await this.settingsStore.setMany(ctx, { [accountRecommendationsKey]: value } as any);
        const failed = results.find(result => !result.result);
        if (failed) throw new UserInputError(failed.error || 'Could not save account recommendations');
        // Compare the raw persisted value: a default fallback must never prove a successful save.
        const values = await this.settingsStore.getMany(ctx, [accountRecommendationsKey]);
        if (
            !accountRecommendationSettingsEqual(
                values[accountRecommendationsKey] as AccountRecommendationSettings,
                value,
            )
        )
            throw new UserInputError('Could not verify account recommendations');
        await this.eventBus?.publish(new StorefrontContentChangedEvent(ctx));
        return value;
    }

    async getPersonalDataExportEnabled(ctx: RequestContext): Promise<boolean> {
        const values = await this.settingsStore.getMany(ctx, [personalDataExportEnabledKey]);
        // Existing and newly created stores both opt in explicitly.
        const value: unknown = values[personalDataExportEnabledKey];
        return value === true;
    }

    async updatePersonalDataExportEnabled(ctx: RequestContext, enabled: boolean): Promise<boolean> {
        if (typeof enabled !== 'boolean') throw new UserInputError('enabled must be a boolean');
        const results = await this.settingsStore.setMany(ctx, {
            [personalDataExportEnabledKey]: enabled,
        } as any);
        const failed = results.find(result => !result.result);
        if (failed) throw new UserInputError(failed.error || 'Could not save personal-data export settings');
        const saved = await this.getPersonalDataExportEnabled(ctx);
        if (saved !== enabled) throw new UserInputError('Could not verify personal-data export settings');
        await this.eventBus?.publish(new StorefrontContentChangedEvent(ctx));
        return saved;
    }
}
