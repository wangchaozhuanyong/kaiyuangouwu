import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { createStoreIsolationAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

// Fixed catalog identifiers only. No arbitrary table, filter, write mode or business text input.
export const CATALOG_TABLES = {
    channel: ['id', 'code'],
    catalog_resource_ownership: ['resourceType', 'resourceId', 'ownerChannelId', 'scope'],
    product_sales_authorization: [
        'productId',
        'channelId',
        'sourceChannelId',
        'state',
        'variantIds',
        'pendingVariantIds',
    ],
    product: ['id', 'deletedAt', 'featuredAssetId'],
    product_channels_channel: ['productId', 'channelId'],
    product_variant: ['id', 'productId', 'deletedAt', 'featuredAssetId'],
    product_variant_channels_channel: ['productVariantId', 'channelId'],
    product_option_group: ['id', 'deletedAt'],
    product_option_group_channels_channel: ['productOptionGroupId', 'channelId'],
    product_option: ['id', 'groupId', 'deletedAt'],
    product_option_channels_channel: ['productOptionId', 'channelId'],
    facet: ['id'],
    facet_channels_channel: ['facetId', 'channelId'],
    facet_value: ['id', 'facetId'],
    facet_value_channels_channel: ['facetValueId', 'channelId'],
    asset: ['id'],
    asset_channels_channel: ['assetId', 'channelId'],
    tag: ['id', 'ownerChannelId'],
    product_option_groups_product_option_group: ['productId', 'productOptionGroupId'],
    product_variant_options_product_option: ['productVariantId', 'productOptionId'],
    product_facet_values_facet_value: ['productId', 'facetValueId'],
    product_variant_facet_values_facet_value: ['productVariantId', 'facetValueId'],
    product_asset: ['productId', 'assetId'],
    product_variant_asset: ['productVariantId', 'assetId'],
    asset_tags_tag: ['assetId', 'tagId'],
    collection: ['id', 'featuredAssetId'],
    collection_channels_channel: ['collectionId', 'channelId'],
    store_profile: ['id', 'channelId', 'logoAssetId', 'logoOnLightAssetId', 'logoOnDarkAssetId'],
    storefront_content_block: ['id', 'channelId', 'imageAssetId', 'imageUrl', 'settings'],
    storefront_content_item: ['id', 'blockId', 'imageAssetId', 'imageUrl', 'settings'],
};
const RESOURCE_TYPES = {
    ProductOptionGroup: ['product_option_group', 'productOptionGroupId'],
    ProductOption: ['product_option', 'productOptionId'],
    Facet: ['facet', 'facetId'],
    FacetValue: ['facet_value', 'facetValueId'],
    Asset: ['asset', 'assetId'],
    Tag: ['tag', null],
};
const ROW_LIMIT = 10000;
const TOTAL_ROW_LIMIT = 50000;
const MAX_BYTES = 2 * 1024 * 1024;
const quote = name => {
    assert.match(name, /^[a-zA-Z][a-zA-Z0-9_]*$/u);
    return `\`${name}\``;
};
const ids = values =>
    [...new Set(values.filter(v => v != null).map(String))].sort((a, b) =>
        a.localeCompare(b, 'en', { numeric: true }),
    );

export async function collectCatalogOwnershipEvidence(adapter) {
    assert.equal(adapter.kind, 'mysql', 'This fixed production audit requires the MySQL snapshot adapter');
    let readRows = 0;
    let queryCount = 0;
    const read = async (sql, parameters = [], limit = ROW_LIMIT) => {
        assert.ok(++queryCount <= 32, 'Catalog audit query budget exceeded');
        const rows = await adapter.query(
            `SELECT /*+ MAX_EXECUTION_TIME(3000) */ ${sql} LIMIT ${limit + 1}`,
            parameters,
        );
        assert.ok(rows.length <= limit, 'Catalog audit row budget exceeded');
        readRows += rows.length;
        assert.ok(readRows <= TOTAL_ROW_LIMIT, 'Catalog audit total row budget exceeded');
        return rows;
    };
    // One metadata read validates every selected column before reading data.
    const tables = Object.keys(CATALOG_TABLES);
    const metadata = await read(
        `TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.columns
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => '?').join(',')})
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        tables,
        1500,
    );
    for (const [table, columns] of Object.entries(CATALOG_TABLES))
        for (const column of columns)
            assert.ok(
                metadata.some(m => m.tableName === table && m.columnName === column),
                `Missing required catalog column: ${table}.${column}`,
            );
    const data = {};
    for (const [table, columns] of Object.entries(CATALOG_TABLES)) {
        const selected = columns.map(column => {
            if (column === 'deletedAt') return `(${quote(column)} IS NOT NULL) AS deleted`;
            // Read only the known mobile media binding, never decoration settings/body/URLs.
            if (column === 'settings')
                return `JSON_UNQUOTE(JSON_EXTRACT(
                CASE WHEN JSON_VALID(settings) THEN settings ELSE '{}' END,
                '$.mobileImageAssetId')) AS mobileImageAssetId`;
            if (column === 'imageUrl')
                return "(imageUrl IS NOT NULL AND TRIM(imageUrl) <> '') AS hasLegacyImageUrl";
            return quote(column);
        });
        data[table] = await read(
            `${selected.join(', ')} FROM ${quote(table)} ORDER BY ${columns
                .map(quote)
                .filter(c => c !== '`settings`' && c !== '`imageUrl`')
                .join(', ')}`,
        );
    }
    const channelIds = ids(data.channel.map(c => c.id));
    const defaultChannel = data.channel.find(c => c.code === '__default_channel__');
    assert.ok(defaultChannel, 'Default channel metadata is missing');
    const resourceSummary = {};
    const missingRegistrations = [];
    for (const [type, [table, idColumn]] of Object.entries(RESOURCE_TYPES)) {
        const records = data[table];
        const summary = {
            total: records.length,
            live: 0,
            registered: 0,
            missing: 0,
            defaultOwned: 0,
            multiStoreAssociated: 0,
            scopeCounts: {},
        };
        for (const resource of records) {
            if (resource.deleted) continue;
            summary.live++;
            const registered = data.catalog_resource_ownership.find(
                o => o.resourceType === type && String(o.resourceId) === String(resource.id),
            );
            const associated = idColumn
                ? ids(
                      data[`${table}_channels_channel`]
                          .filter(r => String(r[idColumn]) === String(resource.id))
                          .map(r => r.channelId),
                  )
                : [];
            if (associated.filter(id => id !== String(defaultChannel.id)).length > 1)
                summary.multiStoreAssociated++;
            if (registered) {
                summary.registered++;
                summary.scopeCounts[registered.scope] = (summary.scopeCounts[registered.scope] ?? 0) + 1;
                if (String(registered.ownerChannelId) === String(defaultChannel.id)) summary.defaultOwned++;
            } else {
                summary.missing++;
                missingRegistrations.push({
                    resourceType: type,
                    resourceId: String(resource.id),
                    channelIds: associated,
                    explicitTagOwnerChannelId:
                        type === 'Tag' && resource.ownerChannelId != null
                            ? String(resource.ownerChannelId)
                            : null,
                    disposition: 'REVIEW_REQUIRED',
                });
            }
        }
        resourceSummary[type] = summary;
    }
    assert.ok(missingRegistrations.length <= 500, 'Catalog candidate budget exceeded');
    return {
        schema: 'vendure-catalog-ownership-evidence-v1',
        mode: 'READ_ONLY',
        productionApply: false,
        coverage: {
            resourceTypes: Object.keys(RESOURCE_TYPES),
            references: 'FIXED_ID_COLUMNS_AND_MOBILE_IMAGE_BINDINGS',
            limits: {
                queryCount,
                readRows,
                perQueryRows: ROW_LIMIT,
                totalRows: TOTAL_ROW_LIMIT,
                queryMilliseconds: 3000,
            },
            // URLs and dynamic category filters require separate evidence; never imply a complete access verdict.
            excludes: [
                'URL_ONLY_MEDIA_RESOLUTION',
                'DYNAMIC_COLLECTION_FILTERS',
                'ORDINARY_STORE_AUTHORIZATION_PROBES',
            ],
        },
        channelIds,
        defaultChannelId: String(defaultChannel.id),
        resourceSummary,
        missingRegistrations,
        // Identifier-only evidence permits an independent offline reference/grant review without another DB read.
        data,
    };
}

export function encodeCatalogOwnershipEvidence(plan) {
    const bytes = Buffer.from(JSON.stringify(plan));
    assert.ok(bytes.length <= MAX_BYTES, 'Catalog audit output budget exceeded');
    const compressedPlan = gzipSync(bytes).toString('base64');
    assert.ok(compressedPlan.length <= 512000, 'Catalog audit transport budget exceeded');
    return {
        schema: 'vendure-catalog-ownership-production-preflight-v1',
        mode: 'READ_ONLY',
        productionApply: false,
        snapshotHash: createHash('sha256').update(bytes).digest('hex'),
        resourceCount: Object.values(plan.resourceSummary).reduce((sum, s) => sum + s.live, 0),
        unresolvedResourceCount: plan.missingRegistrations.length,
        compressedPlan,
    };
}

async function main() {
    assert.equal(process.argv.length, 2, 'The fixed catalog audit accepts no arguments');
    const adapter = await createStoreIsolationAdapter(process.env);
    try {
        process.stdout.write(
            JSON.stringify(encodeCatalogOwnershipEvidence(await collectCatalogOwnershipEvidence(adapter))) +
                '\n',
        );
    } finally {
        await adapter.close();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        process.stderr.write(safeReadOnlyAuditFailure(error) + '\n');
        process.exitCode = 1;
    });
