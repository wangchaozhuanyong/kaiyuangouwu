import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { StorefrontContentPlugin } from '../src/storefront-content.plugin';
import { type StorefrontVisualPresetConfig } from '../src/visual-presets';

const tempPath = mkdtempSync(path.join(tmpdir(), 'vendure-visual-preset-e2e-'));
registerInitializer('sqljs', new SqljsInitializer(tempPath));
const config = mergeConfig(testConfig, {
    apiOptions: { port: 3297 },
    plugins: [StorefrontContentPlugin],
});
const { server, adminClient, shopClient } = createTestEnvironment(config);
const read = gql`
    query {
        storefrontVisualPreset {
            channelId
            presetId
            revision
        }
    }
`;
const write = gql`
    mutation UpdateSkin($input: UpdateStorefrontVisualPresetInput!) {
        updateStorefrontVisualPreset(input: $input) {
            channelId
            presetId
            revision
        }
    }
`;

describe('visual preset Admin API to Shop API persistence', () => {
    beforeAll(async () => {
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
    }, 120_000);
    afterAll(async () => {
        await server.destroy();
        rmSync(tempPath, { recursive: true, force: true });
    });

    it('persists an encoded channel selection, hides system configuration from decoration, and restores classic', async () => {
        const original = (
            await adminClient.query<{ storefrontVisualPreset: StorefrontVisualPresetConfig }>(read)
        ).storefrontVisualPreset;
        expect(original.presetId).toBe('classic');
        const saved = (
            await adminClient.query<{ updateStorefrontVisualPreset: StorefrontVisualPresetConfig }>(write, {
                input: {
                    channelId: original.channelId,
                    presetId: 'modern-oriental',
                    expectedRevision: original.revision,
                },
            })
        ).updateStorefrontVisualPreset;
        expect(saved.presetId).toBe('modern-oriental');
        const published = (
            await shopClient.query<{ storefrontVisualPreset: StorefrontVisualPresetConfig }>(read)
        ).storefrontVisualPreset;
        expect(published).toEqual(saved);
        const channelData = await adminClient.query<{
            activeChannel: { token: string };
        }>(gql`
            query {
                activeChannel {
                    token
                }
            }
        `);
        const zone = await adminClient.query<{ createZone: { id: string } }>(gql`
            mutation {
                createZone(input: { name: "Visual preset test zone" }) {
                    id
                }
            }
        `);
        const created = await adminClient.query<{ createChannel: { id: string; token: string } }>(
            gql`
                mutation CreateStore($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            id
                            token
                        }
                    }
                }
            `,
            {
                input: {
                    code: 'visual-test-store-b',
                    token: 'visual-test-store-b',
                    defaultLanguageCode: 'en',
                    defaultCurrencyCode: 'USD',
                    pricesIncludeTax: false,
                    defaultTaxZoneId: zone.createZone.id,
                    defaultShippingZoneId: zone.createZone.id,
                },
            },
        );
        shopClient.setChannelToken(created.createChannel.token);
        const otherStore = await shopClient.query<{ storefrontVisualPreset: StorefrontVisualPresetConfig }>(
            read,
        );
        expect(otherStore.storefrontVisualPreset.presetId).toBe('classic');
        adminClient.setChannelToken(created.createChannel.token);
        await expect(
            adminClient.query(write, {
                input: { channelId: saved.channelId, presetId: 'classic', expectedRevision: saved.revision },
            }),
        ).rejects.toThrow(/店铺已切换/);
        adminClient.setChannelToken(channelData.activeChannel.token);
        shopClient.setChannelToken(channelData.activeChannel.token);
        const blocks = await adminClient.query<{ storefrontContentBlocks: unknown[] }>(gql`
            query {
                storefrontContentBlocks {
                    id
                }
            }
        `);
        expect(blocks.storefrontContentBlocks).toEqual([]);
        await adminClient.query(gql`
            mutation {
                reorderStorefrontContentBlocks(ids: []) {
                    id
                }
            }
        `);
        await expect(
            adminClient.query(write, {
                input: {
                    channelId: saved.channelId,
                    presetId: 'classic',
                    expectedRevision: original.revision,
                },
            }),
        ).rejects.toThrow(/其他管理员/);
        const reset = (
            await adminClient.query<{ updateStorefrontVisualPreset: StorefrontVisualPresetConfig }>(write, {
                input: { channelId: saved.channelId, presetId: 'classic', expectedRevision: saved.revision },
            })
        ).updateStorefrontVisualPreset;
        expect(reset.presetId).toBe('classic');
        expect(
            (await shopClient.query<{ storefrontVisualPreset: StorefrontVisualPresetConfig }>(read))
                .storefrontVisualPreset,
        ).toEqual(reset);
    });
});
