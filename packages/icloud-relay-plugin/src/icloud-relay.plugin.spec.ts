import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from './constants';
import { IcloudRelayPlugin } from './icloud-relay.plugin';

describe('iCloud event configuration injection', () => {
    it('injects init options into the actual Nest providers', () => {
        const options = { realtimeEnabled: false, mailWebhookUrl: 'https://id.example.test/events' };
        IcloudRelayPlugin.init(options);
        const providers = Reflect.getMetadata('providers', IcloudRelayPlugin);
        const binding = providers.find(
            (provider: { provide?: unknown }) => provider.provide === ICLOUD_RELAY_PLUGIN_OPTIONS,
        );
        expect(binding.useFactory()).toBe(options);
        IcloudRelayPlugin.init({});
    });
});
