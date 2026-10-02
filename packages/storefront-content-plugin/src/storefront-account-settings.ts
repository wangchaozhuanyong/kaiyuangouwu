import { Injectable, Optional } from '@nestjs/common';
import { EventBus, RequestContext, SettingsStoreService, UserInputError } from '@vendure/core';

import { StorefrontContentChangedEvent } from './storefront-content-changed.event';

export const STOREFRONT_ACCOUNT_SETTINGS_NAMESPACE = 'storefrontAccount';
export const personalDataExportEnabledKey = `${STOREFRONT_ACCOUNT_SETTINGS_NAMESPACE}.personalDataExportEnabled`;

/** Controls the client entry only; the existing authenticated export API is unchanged. */
@Injectable()
export class StorefrontAccountSettingsService {
    constructor(
        private readonly settingsStore: SettingsStoreService,
        @Optional() private readonly eventBus?: EventBus,
    ) {}

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
