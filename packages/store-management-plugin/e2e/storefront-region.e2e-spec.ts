import { ContentTranslationPlugin } from '@vendure/content-translation-plugin';
import {
    Country,
    LanguageCode,
    mergeConfig,
    Province,
    RequestContextService,
    TaxCategory,
    TransactionalConnection,
    Zone,
} from '@vendure/core';
import { StorefrontCartPlugin } from '@vendure/storefront-cart-plugin';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import {
    physicalSubtotalShippingCalculator,
    supportedDestinationEligibilityChecker,
} from '../../commerce-fulfillment-plugin/src/commerce-shipping-options';
import { StoreCommerceSettingsService } from '../src/store-commerce-settings.service';
import { StoreManagementPlugin } from '../src/store-management.plugin';

const config = mergeConfig(testConfig(), {
    apiOptions: { shopListQueryLimit: 2 },
    shippingOptions: {
        shippingCalculators: [physicalSubtotalShippingCalculator],
        shippingEligibilityCheckers: [supportedDestinationEligibilityChecker],
    },
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

    it('commits dedicated tax and shipping zones in one store transaction', async () => {
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        await connection
            .getRepository(ctx, TaxCategory)
            .save(new TaxCategory({ name: 'Local transaction test tax category', isDefault: true }));
        const service = server.app.get(StoreCommerceSettingsService);
        const current = await service.get(ctx);
        const updated = await connection.withTransaction(ctx, txCtx =>
            service.update(txCtx, {
                expectedUpdatedAt: current.updatedAt,
                pricesIncludeTax: current.pricesIncludeTax,
                countryCode,
                taxRate: 0,
                shippingMethodNameZh: '测试配送',
                shippingMethodNameEn: 'Test shipping',
                shippingDescriptionZh: '仅供本地事务验收',
                shippingDescriptionEn: 'Local transaction acceptance only',
                baseRate: 0,
                freeShippingThreshold: 0,
                shippingTaxRate: 0,
                shippingPriceIncludesTax: false,
                estimateMinDays: 1,
                estimateMaxDays: 2,
                blockedPostalPrefixes: '',
            }),
        );
        if (!updated.taxZoneName || !updated.shippingZoneName) {
            throw new Error('Dedicated transaction fixture zones were not created');
        }
        const zones = await connection.getRepository(ctx, Zone).find({
            where: [{ name: updated.taxZoneName }, { name: updated.shippingZoneName }],
            relations: ['members'],
        });
        expect(updated.taxZoneName).not.toBe(updated.shippingZoneName);
        expect(zones).toHaveLength(2);
        expect(zones.every(zone => zone.members.some(member => member.code === countryCode))).toBe(true);
        expect((await service.get(ctx)).countryCode).toBe(countryCode);
    });
});
