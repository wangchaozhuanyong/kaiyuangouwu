import assert from 'node:assert/strict';
import test from 'node:test';

import {
    collectProductOwnershipPreflight,
    summarizeProductOwnership,
} from './product-ownership-preflight.mjs';

test('ownership summary blocks shared products and mismatched related entities', () => {
    const report = summarizeProductOwnership('1', {
        product: {
            id: '1',
            channels: [
                { id: '2', code: 'store-a' },
                { id: '3', code: 'store-b' },
            ],
        },
        related: {
            variants: [
                { id: '11', label: 'SKU-11', missingEntity: false, channels: [{ id: '3', code: 'store-b' }] },
            ],
        },
    });
    assert.equal(report.editableAsExclusiveStoreProduct, false);
    assert.deepEqual(
        report.blockers.map(item => item.code),
        ['PRODUCT_SHARED_ACROSS_STORES', 'RELATED_OWNERSHIP_CONFLICT'],
    );
});

test('collector traces product, SKU, asset, category, facet and option ownership without writes', async () => {
    const { default: initialize } = await import('sql.js');
    const SQL = await initialize();
    const database = new SQL.Database();
    try {
        database.run(`
            CREATE TABLE channel (id INTEGER, code TEXT);
            CREATE TABLE product (id INTEGER, featuredAssetId INTEGER, deletedAt TEXT);
            CREATE TABLE product_channels_channel (productId INTEGER, channelId INTEGER);
            CREATE TABLE product_variant (id INTEGER, productId INTEGER, sku TEXT, featuredAssetId INTEGER, deletedAt TEXT);
            CREATE TABLE product_variant_channels_channel (productVariantId INTEGER, channelId INTEGER);
            CREATE TABLE product_asset (productId INTEGER, assetId INTEGER);
            CREATE TABLE product_variant_asset (productVariantId INTEGER, assetId INTEGER);
            CREATE TABLE asset (id INTEGER);
            CREATE TABLE asset_channels_channel (assetId INTEGER, channelId INTEGER);
            CREATE TABLE collection (id INTEGER);
            CREATE TABLE collection_channels_channel (collectionId INTEGER, channelId INTEGER);
            CREATE TABLE collection_product_variants_product_variant (collectionId INTEGER, productVariantId INTEGER);
            CREATE TABLE facet (id INTEGER, code TEXT);
            CREATE TABLE facet_channels_channel (facetId INTEGER, channelId INTEGER);
            CREATE TABLE facet_value (id INTEGER, code TEXT, facetId INTEGER);
            CREATE TABLE facet_value_channels_channel (facetValueId INTEGER, channelId INTEGER);
            CREATE TABLE product_facet_values_facet_value (productId INTEGER, facetValueId INTEGER);
            CREATE TABLE product_variant_facet_values_facet_value (productVariantId INTEGER, facetValueId INTEGER);
            CREATE TABLE product_option_group (id INTEGER, code TEXT);
            CREATE TABLE product_option_group_channels_channel (productOptionGroupId INTEGER, channelId INTEGER);
            CREATE TABLE product_option_groups_product_option_group (productId INTEGER, productOptionGroupId INTEGER);
            CREATE TABLE product_option (id INTEGER, code TEXT, groupId INTEGER);
            CREATE TABLE product_option_channels_channel (productOptionId INTEGER, channelId INTEGER);
            CREATE TABLE product_variant_options_product_option (productVariantId INTEGER, productOptionId INTEGER);
            INSERT INTO channel VALUES (1, '__default_channel__'), (2, 'moyao-ai'), (3, 'other-store');
            INSERT INTO product VALUES (1, 20, NULL);
            INSERT INTO product_channels_channel VALUES (1, 2);
            INSERT INTO product_variant VALUES (11, 1, 'SKU-11', NULL, NULL);
            INSERT INTO product_variant_channels_channel VALUES (11, 2);
            INSERT INTO product_asset VALUES (1, 20);
            INSERT INTO asset VALUES (20);
            INSERT INTO asset_channels_channel VALUES (20, 2);
            INSERT INTO collection VALUES (50);
            INSERT INTO collection_channels_channel VALUES (50, 2);
            INSERT INTO collection_product_variants_product_variant VALUES (50, 11);
            INSERT INTO facet VALUES (40, 'brand');
            INSERT INTO facet_channels_channel VALUES (40, 2);
            INSERT INTO facet_value VALUES (41, 'moyao', 40);
            INSERT INTO facet_value_channels_channel VALUES (41, 2);
            INSERT INTO product_facet_values_facet_value VALUES (1, 41);
            INSERT INTO product_option_group VALUES (30, 'size');
            INSERT INTO product_option_group_channels_channel VALUES (30, 2);
            INSERT INTO product_option_groups_product_option_group VALUES (1, 30);
            INSERT INTO product_option VALUES (31, 'small', 30);
            INSERT INTO product_option_channels_channel VALUES (31, 2);
            INSERT INTO product_variant_options_product_option VALUES (11, 31);
        `);
        const statements = [];
        const adapter = {
            tableExists: async table => {
                const statement = database.prepare(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                );
                statement.bind([table]);
                const exists = statement.step();
                statement.free();
                return exists;
            },
            query: async (sql, parameters = []) => {
                statements.push(sql);
                const statement = database.prepare(sql);
                statement.bind(parameters);
                const rows = [];
                while (statement.step()) rows.push(statement.getAsObject());
                statement.free();
                return rows;
            },
        };
        const report = await collectProductOwnershipPreflight(adapter, '1');
        assert.equal(report.editableAsExclusiveStoreProduct, true);
        assert.deepEqual(
            report.related.variants.map(item => item.label),
            ['SKU-11'],
        );
        assert.deepEqual(
            report.related.collections.map(item => item.id),
            ['50'],
        );
        assert.deepEqual(
            report.related.facets.map(item => item.id),
            ['40'],
        );
        assert.deepEqual(
            report.related.options.map(item => item.id),
            ['31'],
        );
        assert.ok(statements.every(sql => /^SELECT\b/u.test(sql.trim())));

        database.run('INSERT INTO product_channels_channel VALUES (1, 1)');
        const legacyDefault = await collectProductOwnershipPreflight(adapter, '1');
        assert.equal(legacyDefault.editableAsExclusiveStoreProduct, false);
        assert.ok(legacyDefault.blockers.some(item => item.code === 'PRODUCT_REQUIRES_CHANNEL_MIGRATION'));

        database.run('INSERT INTO asset_channels_channel VALUES (20, 3)');
        const sharedAsset = await collectProductOwnershipPreflight(adapter, '1');
        assert.equal(sharedAsset.editableAsExclusiveStoreProduct, false);
        assert.ok(sharedAsset.blockers.some(item => item.type === 'assets' && item.entityId === '20'));
    } finally {
        database.close();
    }
});

test('collector refuses invalid IDs and missing relation tables before any ownership claim', async () => {
    await assert.rejects(collectProductOwnershipPreflight({}, '1 OR 1=1'), /positive integer/u);
    await assert.rejects(
        collectProductOwnershipPreflight({ tableExists: async () => false }, '1'),
        /Missing required table/u,
    );
});
