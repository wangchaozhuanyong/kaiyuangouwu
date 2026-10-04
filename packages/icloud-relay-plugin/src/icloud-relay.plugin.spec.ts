import { PluginConfigurationFn, RuntimeVendureConfig } from '@vendure/core';
import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import { MetadataArgsStorage } from 'typeorm/metadata-args/MetadataArgsStorage';
import { describe, expect, it } from 'vitest';

import { ICLOUD_RELAY_PLUGIN_OPTIONS } from './constants';
import { IcloudReceivedMail } from './entities/icloud-received-mail.entity';
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

    it.each(['mysql', 'mariadb', 'postgres', 'sqljs'] as const)(
        'uses a compatible mail body type on %s without altering unrelated columns',
        async type => {
            const config = {
                authOptions: { customPermissions: [] },
                dbConnectionOptions: { type },
                entityOptions: {},
            } as unknown as RuntimeVendureConfig;
            const configure = Reflect.getMetadata(
                'configuration',
                IcloudRelayPlugin,
            ) as PluginConfigurationFn;
            await configure(config);
            const metadata = new MetadataArgsStorage();
            metadata.columns.push(
                ...getMetadataArgsStorage().columns.map(column => ({
                    ...column,
                    options: { ...column.options },
                })),
            );
            for (const modifier of config.entityOptions.metadataModifiers ?? []) await modifier(metadata);
            const columns = metadata.columns.filter(column => column.target === IcloudReceivedMail);
            for (const name of ['bodyHtml', 'bodyText']) {
                expect(columns.find(column => column.propertyName === name)?.options).toMatchObject({
                    type: ['mysql', 'mariadb'].includes(type) ? 'longtext' : 'text',
                    nullable: true,
                });
            }
            expect(columns.find(column => column.propertyName === 'toAddressesJson')?.options.type).toBe(
                'text',
            );
        },
    );
});
