import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import { Country, LanguageCode, mergeConfig, Province, TransactionalConnection } from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const config = mergeConfig(testConfig(), {
    apiOptions: { shopListQueryLimit: 2 },
    plugins: [
        StorefrontCartPlugin,
        ContentTranslationPlugin.init({
            provider: {
                name: 'region-test',
                isConfigured: () => false,
                translate: () =>
                    Promise.reject(new Error('Region test must not call a translation provider')),
            },
        }),
        StoreManagementPlugin.init({
            enabled: false,
            signingSecret: 'region-e2e-isolated-test-secret-at-least-32-characters',
        }),
    ],
});
const { server, shopClient } = createTestEnvironment(config);

describe('storefront province public API pagination', () => {
    let countryCode: string;

    beforeAll(async () => {
        registerInitializer(
            'sqljs',
            new SqljsInitializer(mkdtempSync(join(tmpdir(), 'vendure-region-api-'))),
        );
        await server.init({
            initialData: { ...initialData, collections: [], paymentMethods: [] },
            customerCount: 0,
        });
        const connection = server.app.get(TransactionalConnection).rawConnection;
        const country = await connection.getRepository(Country).findOneByOrFail({ enabled: true });
        countryCode = country.code;
        for (let index = 0; index < 5; index++) {
            // Seed only this isolated fixture database, including the internal country relation.
            const province = await connection
                .getRepository(Province)
                .save(new Province({ code: `REGION-${index}`, enabled: true, parent: country }));
            await connection.getRepository('RegionTranslation').save({
                languageCode: LanguageCode.en,
                name: `Region ${index}`,
                base: province,
            });
        }
        await shopClient.asAnonymousUser();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('returns every province through the real public list guard without an over-limit error', async () => {
        const result = await shopClient.query(gql`
            query StorefrontProvinces {
                availableStorefrontProvinces {
                    code
                    name
                    countryCode
                }
            }
        `);
        expect(result.availableStorefrontProvinces).toEqual(
            Array.from({ length: 5 }, (_, index) => ({
                code: `REGION-${index}`,
                name: `Region ${index}`,
                countryCode,
            })),
        );
    });
});
