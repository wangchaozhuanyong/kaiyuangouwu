import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
    CATALOG_TABLES,
    collectCatalogOwnershipEvidence,
    collectImportResourceReferences,
    collectSupplementaryCatalogReferences,
    encodeCatalogOwnershipEvidence,
} from './catalog-ownership-evidence.mjs';

function fixture(overrides = {}) {
    const rows = Object.fromEntries(Object.keys(CATALOG_TABLES).map(table => [table, []]));
    Object.assign(rows, {
        channel: [
            { id: 1, code: '__default_channel__' },
            { id: 2, code: 'synthetic-a' },
            { id: 5, code: 'synthetic-b' },
        ],
        catalog_resource_ownership: [
            { resourceType: 'Facet', resourceId: 4, ownerChannelId: 1, scope: 'STORE' },
            { resourceType: 'Product', resourceId: 7, ownerChannelId: 2, scope: 'STORE' },
        ],
        facet: [{ id: 4 }],
        facet_value: [{ id: 9, facetId: 4 }],
        facet_channels_channel: [
            { facetId: 4, channelId: 1 },
            { facetId: 4, channelId: 2 },
            { facetId: 4, channelId: 5 },
        ],
        facet_value_channels_channel: [{ facetValueId: 9, channelId: 2 }],
        asset: [{ id: 3 }],
        asset_channels_channel: [{ assetId: 3, channelId: 2 }],
        tag: [{ id: 6, ownerChannelId: 2 }],
        asset_tags_tag: [{ assetId: 3, tagId: 6 }],
        product: [{ id: 7, deleted: 0, featuredAssetId: 3 }],
        product_variant: [{ id: 8, productId: 7, deleted: 0, featuredAssetId: 3 }],
        product_channels_channel: [{ productId: 7, channelId: 2 }],
        product_variant_channels_channel: [{ productVariantId: 8, channelId: 2 }],
        product_facet_values_facet_value: [{ productId: 7, facetValueId: 9 }],
        product_option_group: [
            { id: 10, deleted: 0 },
            { id: 11, deleted: 1 },
        ],
        product_option: [{ id: 12, groupId: 10, deleted: 0 }],
        product_option_group_channels_channel: [{ productOptionGroupId: 10, channelId: 2 }],
        product_option_channels_channel: [{ productOptionId: 12, channelId: 2 }],
        product_option_groups_product_option_group: [{ productId: 7, productOptionGroupId: 10 }],
        product_variant_options_product_option: [{ productVariantId: 8, productOptionId: 12 }],
        product_sales_authorization: [
            {
                productId: 7,
                channelId: 5,
                sourceChannelId: 2,
                state: 'PAUSED',
                variantIds: '[8]',
                pendingVariantIds: null,
            },
        ],
        storefront_content_block: [
            { id: 20, channelId: 2, imageAssetId: 3, mobileImageAssetId: '3', hasLegacyImageUrl: 1 },
        ],
        storefront_content_item: [
            { id: 21, blockId: 20, imageAssetId: 3, mobileImageAssetId: null, hasLegacyImageUrl: 1 },
        ],
        ...overrides,
    });
    const queries = [];
    return {
        kind: 'mysql',
        rows,
        queries,
        async query(sql, parameters) {
            queries.push({ sql, parameters });
            assert.match(sql, /^SELECT \/\*\+ MAX_EXECUTION_TIME\(3000\) \*\//u);
            assert.match(sql, /LIMIT (10001|1501)$/u);
            assert.doesNotMatch(
                sql,
                /\b(?:UPDATE|INSERT|DELETE|payment|customer|order_line|password|token)\b/iu,
            );
            if (sql.includes('information_schema.columns'))
                return Object.entries(CATALOG_TABLES).flatMap(([tableName, columns]) =>
                    columns.map(columnName => ({ tableName, columnName })),
                );
            const table = sql.match(/FROM `([a-z_]+)`/u)?.[1];
            assert.ok(table && Object.hasOwn(rows, table));
            return rows[table];
        },
    };
}

test('fixed snapshot preserves six resource, child, product, decoration and grant identifiers without inferring ownership', async () => {
    const adapter = fixture();
    const plan = await collectCatalogOwnershipEvidence(adapter);
    assert.equal(plan.productionApply, false);
    assert.deepEqual(Object.keys(plan.resourceSummary), [
        'ProductOptionGroup',
        'ProductOption',
        'Facet',
        'FacetValue',
        'Asset',
        'Tag',
    ]);
    assert.equal(plan.resourceSummary.ProductOptionGroup.live, 1);
    assert.equal(plan.resourceSummary.Facet.defaultOwned, 1);
    assert.equal(plan.resourceSummary.Facet.multiStoreAssociated, 1);
    assert.equal(plan.missingRegistrations.length, 5);
    assert.deepEqual(
        plan.missingRegistrations.find(r => r.resourceType === 'Tag'),
        {
            resourceType: 'Tag',
            resourceId: '6',
            channelIds: [],
            explicitTagOwnerChannelId: '2',
            disposition: 'REVIEW_REQUIRED',
        },
    );
    for (const table of [
        'product_sales_authorization',
        'product_option',
        'facet_value',
        'storefront_content_block',
        'storefront_content_item',
        'asset_tags_tag',
    ])
        assert.deepEqual(plan.data[table], adapter.rows[table]);
    assert.ok(plan.coverage.excludes.includes('ORDINARY_STORE_AUTHORIZATION_PROBES'));
    assert.equal(adapter.queries.length, 38);
    const mobileQuery = adapter.queries.find(q => q.sql.includes('FROM `storefront_content_block`')).sql;
    assert.match(mobileQuery, /JSON_VALID\(settings\)/u);
    assert.match(mobileQuery, /\$\.mobileImageAssetId/u);
    assert.doesNotMatch(mobileQuery, /SELECT[^]*,\s*`settings`/u);
    const encoded = encodeCatalogOwnershipEvidence(plan);
    const decoded = gunzipSync(Buffer.from(encoded.compressedPlan, 'base64'));
    assert.equal(createHash('sha256').update(decoded).digest('hex'), encoded.snapshotHash);
    assert.deepEqual(JSON.parse(decoded), plan);
});

function importRow(overrides = {}) {
    return {
        id: 101,
        jobId: 100,
        targetProductId: 7,
        targetVariantId: 8,
        appliedAt: '2020-01-01T00:00:00.000Z',
        normalizedDataValid: 1,
        beforeSnapshotValid: 1,
        appliedSnapshotValid: 1,
        resolvedFeaturedAssetId: '3',
        beforeAssetIds: '["3","999"]',
        beforeFacetValueIds: '[9]',
        afterAssetIds: '[]',
        afterFacetValueIds: '[]',
        ...overrides,
    };
}

test('import snapshots expose only candidate resource matches with task scope, never infer creation or ownership', async () => {
    const row = importRow();
    const adapter = fixture({
        catalog_import_job: [{ id: 100, channelId: 2, state: 'COMPLETED', fileHash: 'a'.repeat(64) }],
        catalog_import_row: [row],
    });
    const before = JSON.stringify(adapter.rows);
    const plan = await collectCatalogOwnershipEvidence(adapter);
    assert.equal(plan.importProvenance.jobsRead, 1);
    assert.equal(plan.importProvenance.rowsRead, 1);
    assert.equal(plan.importProvenance.matchedResourceCount, 2);
    assert.deepEqual(
        plan.importProvenance.references.map(r => [r.resourceType, r.resourceId, r.stage]),
        [
            ['Asset', '3', 'RESOLVED_INPUT'],
            ['Asset', '3', 'BEFORE'],
            ['FacetValue', '9', 'BEFORE'],
        ],
    );
    assert.ok(plan.importProvenance.references.every(r => r.jobChannelId === '2' && r.rowId === '101'));
    assert.equal(plan.importProvenance.ownershipInferred, false);
    assert.equal(plan.importProvenance.creationOriginVerified, false);
    assert.equal(plan.data.catalog_import_row, undefined);
    assert.equal(plan.data.catalog_import_job, undefined);
    assert.doesNotMatch(JSON.stringify(plan), /999|beforeAssetIds.*999/u);
    assert.equal(JSON.stringify(adapter.rows), before);
    const sql = adapter.queries.find(q => q.sql.includes('FROM `catalog_import_row`')).sql;
    for (const column of ['normalizedData', 'beforeSnapshot', 'appliedSnapshot'])
        assert.match(sql, new RegExp('JSON_VALID\\(\x60' + column + '\x60\\)'));
    assert.match(sql, /\$\.afterSnapshot\.productFacetValueIds/u);
    assert.match(sql, /LEFT\(JSON_UNQUOTE\(JSON_EXTRACT/u);
    assert.doesNotMatch(
        sql,
        /productDescription|digital|cost|actor|plannedChanges|SELECT[^]*,\s*`beforeSnapshot`,/u,
    );
    assert.match(
        sql,
        /ORDER BY `id`, `jobId`, `createdAt`, `appliedAt`, `targetProductId`, `targetVariantId` LIMIT/u,
    );
});

test('import references reject malformed JSON, truncated fields, unsafe IDs and orphan rows without exporting their values', () => {
    const data = fixture({
        catalog_import_job: [{ id: 100, channelId: 2 }],
        catalog_import_row: [importRow()],
    }).rows;
    const candidates = [{ resourceType: 'Asset', resourceId: '3' }];
    for (const change of [
        { beforeSnapshotValid: 0 },
        { beforeAssetIds: 'NEVER_EXPORT_PRIVATE_TEXT' },
        { beforeAssetIds: 'x'.repeat(65537) },
        { beforeAssetIds: '[9007199254740992]' },
        { beforeAssetIds: '["not-an-id"]' },
        { beforeAssetIds: Array(1001).fill('3') },
        { jobId: 404 },
    ]) {
        assert.throws(
            () =>
                collectImportResourceReferences(
                    { ...data, catalog_import_row: [importRow(change)] },
                    candidates,
                ),
            error => {
                assert.doesNotMatch(error.message, /NEVER_EXPORT_PRIVATE_TEXT|not-an-id/u);
                return /Catalog import|catalog import/u.test(error.message);
            },
        );
    }
    const large = JSON.stringify(Array(1000).fill('12345678901234567890'));
    assert.throws(
        () =>
            collectImportResourceReferences(
                {
                    ...data,
                    catalog_import_row: Array.from({ length: 400 }, (_, index) =>
                        importRow({ id: index + 1, beforeAssetIds: large }),
                    ),
                },
                candidates,
            ),
        /byte budget/u,
    );
});

test('resolves known URL and nested filter references while excluding all raw content and URL values from the result', async () => {
    const adapter = fixture({
        asset: [
            {
                id: 3,
                source: 'source/ab/sample.png',
                preview: 'preview/ab/sample.png',
                createdAt: '2020-01-01T00:00:00.000Z',
            },
        ],
        storefront_content_block: [
            {
                id: 20,
                channelId: 2,
                imageAssetId: null,
                legacyImageUrl:
                    'https://console.moyaoai.com/assets/source/ab/sample.png?private=NEVER_EXPORT_URL_QUERY',
            },
        ],
        storefront_content_item: [
            { id: 21, blockId: 20, imageAssetId: null, mobileImageUrl: '/assets/preview/ab/sample.png' },
        ],
        product_translation: [
            {
                id: 30,
                baseId: 7,
                description: 'NEVER_EXPORT_DESCRIPTION <img src="/assets/source/ab/sample.png">',
            },
        ],
        collection: [
            {
                id: 40,
                featuredAssetId: null,
                filters: JSON.stringify([
                    { code: 'facet-value-filter', args: [{ name: 'facetValueIds', value: '[9,10]' }] },
                ]),
            },
        ],
        governance_audit_entry: [
            {
                id: 50,
                channelId: 2,
                resourceType: 'Asset',
                resourceId: '3',
                eventType: 'resource-created',
                createdAt: '2020-01-01T00:00:00.000Z',
            },
        ],
    });
    const plan = await collectCatalogOwnershipEvidence(adapter);
    assert.equal(plan.supplementaryReferences.mediaReferences.length, 3);
    assert.ok(plan.supplementaryReferences.mediaReferences.every(r => r.assetId === '3'));
    assert.deepEqual(plan.supplementaryReferences.dynamicFacetReferences, [
        { collectionId: '40', resourceType: 'FacetValue', resourceId: '9' },
        { collectionId: '40', resourceType: 'FacetValue', resourceId: '10' },
    ]);
    assert.equal(plan.supplementaryReferences.governanceLineageRows, 1);
    assert.equal(plan.supplementaryReferences.ownershipInferred, false);
    const encoded = JSON.stringify(plan);
    assert.doesNotMatch(encoded, /NEVER_EXPORT|source\/ab|preview\/ab|https:\/\//u);
    assert.equal(
        plan.data.asset[0].sourcePathSha256,
        createHash('sha256').update('source/ab/sample.png').digest('hex'),
    );
    assert.equal(adapter.rows.product_translation[0].description.includes('NEVER_EXPORT_DESCRIPTION'), true);
    const lineage = adapter.queries.find(q => q.sql.includes('FROM `governance_audit_entry`'));
    assert.ok(lineage.sql.includes('WHERE (resourceType, resourceId) IN'));
    assert.ok(lineage.parameters.includes('Asset'));
    assert.ok(lineage.parameters.includes('3'));
});

test('keeps ambiguous URLs, foreign origins and unsupported filter values unresolved without guessing', () => {
    const rows = fixture().rows;
    rows.asset = [
        { id: 1, source: 'source/same.png' },
        { id: 2, source: 'source/same.png' },
    ];
    rows.storefront_content_block = [
        { id: 1, legacyImageUrl: '/assets/source/same.png' },
        { id: 2, mobileImageUrl: 'https://foreign.invalid/assets/source/same.png' },
    ];
    rows.collection = [
        {
            id: 1,
            filters: JSON.stringify([
                { code: 'facet-value-filter', args: [{ name: 'facetValueIds', value: 'not-json' }] },
            ]),
        },
    ];
    const result = collectSupplementaryCatalogReferences(rows, ['console.moyaoai.com']);
    assert.equal(result.evidence.mediaReferences.length, 0);
    assert.deepEqual(
        result.evidence.unresolvedReferences.map(r => r.reason),
        ['AMBIGUOUS_ASSET_PATH', 'UNRESOLVED_OR_EXTERNAL_URL', 'INVALID_FACET_FILTER_IDS'],
    );
    assert.doesNotMatch(JSON.stringify(result), /foreign\.invalid|source\/same\.png|not-json/u);
});

test('missing schema, row overflow and candidate overflow stop the audit instead of reporting partial success', async () => {
    const missing = fixture();
    missing.query = async () => [];
    await assert.rejects(collectCatalogOwnershipEvidence(missing), /Missing required catalog column/u);
    await assert.rejects(
        collectCatalogOwnershipEvidence(
            fixture({ asset: Array.from({ length: 10001 }, (_, id) => ({ id })) }),
        ),
        /row budget/u,
    );
    await assert.rejects(
        collectCatalogOwnershipEvidence(fixture({ tag: Array.from({ length: 501 }, (_, id) => ({ id })) })),
        /candidate budget/u,
    );
    await assert.rejects(collectCatalogOwnershipEvidence({ kind: 'sqlite' }), /MySQL snapshot/u);
});
