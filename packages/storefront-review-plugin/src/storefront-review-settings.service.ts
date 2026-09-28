import { Injectable, Optional } from '@nestjs/common';
import { EventBus, RequestContext, SettingsStoreService, UserInputError } from '@vendure/core';

import { StorefrontReviewSettingsChangedEvent } from './storefront-review-changed.event';

export const STOREFRONT_REVIEW_SETTINGS_NAMESPACE = 'storefrontReview';
const enabledKey = `${STOREFRONT_REVIEW_SETTINGS_NAMESPACE}.enabled`;

@Injectable()
export class StorefrontReviewSettingsService {
    constructor(
        private readonly settingsStore: SettingsStoreService,
        @Optional() private readonly eventBus?: EventBus,
    ) {}

    async get(ctx: RequestContext): Promise<{ enabled: boolean }> {
        const values = await this.settingsStore.getMany(ctx, [enabledKey]);
        // Existing stores keep their current review behavior until an admin disables it.
        const value: unknown = values[enabledKey];
        return { enabled: value !== false };
    }

    async update(ctx: RequestContext, enabled: boolean): Promise<{ enabled: boolean }> {
        if (typeof enabled !== 'boolean') {
            throw new UserInputError('enabled must be a boolean');
        }
        const results = await this.settingsStore.setMany(ctx, { [enabledKey]: enabled } as any);
        const failed = results.find(result => !result.result);
        if (failed) {
            throw new UserInputError(failed.error || 'Could not save review settings');
        }
        const saved = await this.get(ctx);
        if (saved.enabled !== enabled) {
            throw new UserInputError('Could not verify review settings');
        }
        await this.eventBus?.publish(new StorefrontReviewSettingsChangedEvent(ctx));
        return saved;
    }
}
