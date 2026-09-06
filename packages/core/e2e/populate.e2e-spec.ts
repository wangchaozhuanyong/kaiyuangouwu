import { INestApplication } from '@nestjs/common';
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { User } from '@vendure/core';
import { populate } from '@vendure/core/cli';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { InitialData } from '../src/index';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    createChannelDocument,
    getAssetListDocument,
    getChannelsDocument,
    getCollectionsDocument,
    getProductListDocument,
    getProductWithVariantsDocument,
} from './graphql/shared-definitions';

type ChannelFragment = FragmentOf<typeof channelFragment>;

describe('populate() function', () => {
    let channel2: ChannelFragment;
    const channel2Input = {
        code: 'Channel 2',
        token: 'channel-2',
        currencyCode: CurrencyCode.EUR,
        defaultLanguageCode: LanguageCode.en,
        defaultShippingZoneId: 'T_1',
        defaultTaxZoneId: 'T_2',
        pricesIncludeTax: true,
    };
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        // logger: new DefaultLogger(),
        customFields: {
            Product: [
                { type: 'string', name: 'pageType' },
                {
                    name: 'owner',
                    public: true,
                    nullable: true,
                    type: 'relation',
                    entity: User,
                    eager: true,
                },
                {
                    name: 'keywords',
                    public: true,
                    nullable: true,
                    type: 'string',
                    list: true,
                },
                {
                    name: 'localName',
                    type: 'localeString',
                },
            ],
            ProductVariant: [
                { type: 'boolean', name: 'valid' },
                { type: 'int', name: 'weight' },
            ],
        },
    });

    beforeAll(async () => {
        await server.init({
            initialData: { ...initialData, collections: [] },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-empty.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { createChannel } = await adminClient.query(createChannelDocument, { input: channel2Input });
        channel2 = createChannel as ChannelFragment;
        await server.destroy();
    }, TEST_SETUP_TIMEOUT_MS);

    describe('populating default channel', () => {
        let app: INestApplication;

        beforeAll(async () => {
            const initialDataForPopulate: InitialData = {
                defaultLanguage: initialData.defaultLanguage,
                defaultZone: initialData.defaultZone,
                taxRates: [],
                shippingMethods: [],
                paymentMethods: [],
                countries: [],
                collections: [{ name: 'Collection 1', filters: [] }],
            };
            const csvFile = path.join(__dirname, 'fixtures', 'product-import.csv');
            app = await populate(
                async () => {
                    await server.bootstrap();
                    return server.app;
                },
                initialDataForPopulate,
                csvFile,
            );
        }, TEST_SETUP_TIMEOUT_MS);

        afterAll(async () => {
            await app.close();
        });

        it('populates products', async () => {
            await adminClient.asSuperAdmin();
            const { products } = await adminClient.query(getProductListDocument);
            expect(products.totalItems).toBe(4);
            expect(products.items.map(i => i.name).sort()).toEqual([
                'Artists Smock',
                'Giotto Mega Pencils',
                'Mabef M/02 Studio Easel',
                'Perfect Paper Stretcher',
            ]);
        });

        it('populates assets', async () => {
            const { assets } = await adminClient.query(getAssetListDocument);
            expect(assets.items.map(i => i.name).sort()).toEqual([
                'box-of-12.jpg',
                'box-of-8.jpg',
                'pps1.jpg',
                'pps2.jpg',
            ]);
        });

        it('populates collections', async () => {
            const { collections } = await adminClient.query(getCollectionsDocument);
            expect(collections.items.map(i => i.name).sort()).toEqual(['Collection 1']);
        });
    });

    describe('populating a non-default channel', () => {
        let app: INestApplication;
        beforeAll(async () => {
            const initialDataForPopulate: InitialData = {
                defaultLanguage: initialData.defaultLanguage,
                defaultZone: initialData.defaultZone,
                taxRates: [],
                shippingMethods: [],
                paymentMethods: [],
                countries: [],
                collections: [{ name: 'Collection 2', filters: [] }],
            };
            const csvFile = path.join(__dirname, 'fixtures', 'product-import-channel.csv');

            app = await populate(
                async () => {
                    await server.bootstrap();
                    // Sql.js restores its seed on bootstrap, so recreate the target if the earlier
                    // test-only Channel was not persisted. Otherwise an unknown token falls back
                    // to the sole default Channel and the test never exercises a store import.
                    adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                    await adminClient.asSuperAdmin();
                    const { channels } = await adminClient.query(getChannelsDocument);
                    if (!channels.items.some(channel => channel.token === channel2.token)) {
                        const { createChannel } = await adminClient.query(createChannelDocument, {
                            input: channel2Input,
                        });
                        channel2 = createChannel as ChannelFragment;
                    }
                    return server.app;
                },
                initialDataForPopulate,
                csvFile,
                channel2.token,
            );
        });

        afterAll(async () => {
            await app.close();
        });

        it('populates products', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(channel2.token);
            const { products } = await adminClient.query(getProductListDocument);
            expect(products.totalItems).toBe(1);
            expect(products.items.map(i => i.name).sort()).toEqual(['Model Hand']);
        });

        it('populates assets', async () => {
            const { assets } = await adminClient.query(getAssetListDocument);
            expect(assets.items.map(i => i.name).sort()).toEqual(['vincent-botta-736919-unsplash.jpg']);
        });

        it('populates collections', async () => {
            const { collections } = await adminClient.query(getCollectionsDocument);
            expect(collections.items.map(i => i.name).sort()).toEqual(['Collection 2']);
        });

        it('retains the admin aggregate without assigning imported products to the default storefront', async () => {
            adminClient.setChannelToken(channel2.token);
            const { products } = await adminClient.query(getProductListDocument);
            const imported = products.items.find(item => item.name === 'Model Hand');
            if (!imported) throw new Error('Imported product missing from target channel');
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, { id: imported.id });
            expect(product?.channels.map(channel => channel.id)).toEqual([channel2.id]);
            expect(product?.variants[0].channels.map(channel => channel.id)).toEqual([channel2.id]);
            const query = gql`
                query ($id: ID!) {
                    product(id: $id) {
                        id
                    }
                }
            `;
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            expect((await shopClient.query(query, { id: imported.id })).product).toBeNull();
            shopClient.setChannelToken(channel2.token);
            expect((await shopClient.query(query, { id: imported.id })).product.id).toBe(imported.id);
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });

    // https://github.com/vendurehq/vendure/issues/1445
    describe('clashing option names', () => {
        let app: INestApplication;

        beforeAll(async () => {
            const initialDataForPopulate: InitialData = {
                defaultLanguage: initialData.defaultLanguage,
                defaultZone: initialData.defaultZone,
                taxRates: [],
                shippingMethods: [],
                paymentMethods: [],
                countries: [],
                collections: [{ name: 'Collection 1', filters: [] }],
            };
            const csvFile = path.join(__dirname, 'fixtures', 'product-import-option-values.csv');
            app = await populate(
                async () => {
                    await server.bootstrap();
                    return server.app;
                },
                initialDataForPopulate,
                csvFile,
            );
        }, TEST_SETUP_TIMEOUT_MS);

        afterAll(async () => {
            await app.close();
        });

        it('populates variants & options', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { products } = await adminClient.query(getProductListDocument, {
                options: {
                    filter: {
                        slug: { eq: 'foo' },
                    },
                },
            });
            expect(products.totalItems).toBe(1);
            const fooProduct = products.items[0];
            expect(fooProduct.name).toBe('Foo');

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: fooProduct.id,
            });

            expect(product?.variants.length).toBe(4);
            expect(product?.optionGroups.map(og => og.name).sort()).toEqual(['Bar', 'Foo']);
            expect(
                product?.variants
                    .find(v => v.sku === 'foo-fiz-buz')
                    ?.options.map(o => o.name)
                    .sort(),
            ).toEqual(['buz', 'fiz']);
        });
    });
});
