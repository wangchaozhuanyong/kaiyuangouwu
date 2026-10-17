import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { createStoreIsolationAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

// Fixed catalog identifiers only. No arbitrary table, filter, write mode or business text input.
export const CATALOG_TABLES = {
    channel: ['id', 'code'],
    catalog_resource_ownership: ['resourceType', 'resourceId', 'ownerChannelId', 'scope', 'createdAt'],
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
    product_option_group: ['id', 'deletedAt', 'createdAt'],
    product_option_group_channels_channel: ['productOptionGroupId', 'channelId'],
    product_option: ['id', 'groupId', 'deletedAt', 'createdAt'],
    product_option_channels_channel: ['productOptionId', 'channelId'],
    facet: ['id', 'createdAt'],
    facet_channels_channel: ['facetId', 'channelId'],
    facet_value: ['id', 'facetId', 'createdAt'],
    facet_value_channels_channel: ['facetValueId', 'channelId'],
    asset: ['id', 'source', 'preview', 'createdAt'],
    asset_channels_channel: ['assetId', 'channelId'],
    tag: ['id', 'ownerChannelId', 'createdAt'],
    product_option_groups_product_option_group: ['productId', 'productOptionGroupId'],
    product_variant_options_product_option: ['productVariantId', 'productOptionId'],
    product_facet_values_facet_value: ['productId', 'facetValueId'],
    product_variant_facet_values_facet_value: ['productVariantId', 'facetValueId'],
    product_asset: ['productId', 'assetId'],
    product_variant_asset: ['productVariantId', 'assetId'],
    asset_tags_tag: ['assetId', 'tagId'],
    collection: ['id', 'featuredAssetId', 'filters'],
    collection_channels_channel: ['collectionId', 'channelId'],
    store_profile: ['id', 'channelId', 'logoAssetId', 'logoOnLightAssetId', 'logoOnDarkAssetId'],
    storefront_content_block: ['id', 'channelId', 'imageAssetId', 'imageUrl', 'settings'],
    storefront_content_item: ['id', 'blockId', 'imageAssetId', 'imageUrl', 'settings'],
    product_translation: ['id', 'baseId', 'description'],
    collection_translation: ['id', 'baseId', 'description'],
    storefront_content_block_translation: ['id', 'baseId', 'body'],
    storefront_content_item_translation: ['id', 'baseId', 'description'],
    governance_audit_entry: ['id', 'channelId', 'resourceType', 'resourceId', 'eventType', 'createdAt'],
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
const storefronts = JSON.parse(
    readFileSync(new URL('../../../deploy/production-storefronts.json', import.meta.url)),
);
const mediaHosts = [storefronts.dashboardUrl, ...storefronts.storefronts.map(s => s.origin)].map(
    u => new URL(u).hostname,
);
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
        assert.ok(++queryCount <= 40, 'Catalog audit query budget exceeded');
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
            // Select only known mobile media fields, never the full settings payload.
            if (column === 'settings')
                return `JSON_UNQUOTE(JSON_EXTRACT(
                CASE WHEN JSON_VALID(settings) THEN settings ELSE '{}' END,
                '$.mobileImageAssetId')) AS mobileImageAssetId,
                JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(settings) THEN settings ELSE '{}' END,
                '$.mobileImageUrl')) AS mobileImageUrl`;
            if (column === 'imageUrl')
                return "(imageUrl IS NOT NULL AND TRIM(imageUrl) <> '') AS hasLegacyImageUrl, imageUrl AS legacyImageUrl";
            if (column === 'description' || column === 'body')
                return `LEFT(${quote(column)}, 65537) AS ${quote(column)}`;
            return quote(column);
        });
        let where = '';
        let parameters = [];
        if (table.endsWith('_translation')) {
            const column = columns.includes('body') ? 'body' : 'description';
            where = ` WHERE ${quote(column)} LIKE '%/assets/%' OR ${quote(column)} LIKE '%<img%' OR ${quote(column)} LIKE '%url(%'`;
        }
        if (table === 'governance_audit_entry') {
            const missing = Object.entries(RESOURCE_TYPES).flatMap(([type, [resourceTable]]) =>
                data[resourceTable]
                    .filter(
                        r =>
                            !r.deleted &&
                            !data.catalog_resource_ownership.some(
                                o => o.resourceType === type && String(o.resourceId) === String(r.id),
                            ),
                    )
                    .map(r => [type, String(r.id)]),
            );
            assert.ok(missing.length <= 500, 'Catalog lineage candidate budget exceeded');
            where = missing.length
                ? ` WHERE (resourceType, resourceId) IN (${missing.map(() => '(?, ?)').join(', ')})`
                : ' WHERE 1 = 0';
            parameters = missing.flat();
        }
        data[table] = await read(
            `${selected.join(', ')} FROM ${quote(table)}${where} ORDER BY ${columns
                .map(quote)
                .filter(
                    c =>
                        ![
                            '`settings`',
                            '`imageUrl`',
                            '`filters`',
                            '`description`',
                            '`body`',
                            '`source`',
                            '`preview`',
                        ].includes(c),
                )
                .join(', ')}`,
            parameters,
        );
    }
    const supplementary = collectSupplementaryCatalogReferences(data, mediaHosts);
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
            references:
                'FIXED_IDS_MOBILE_BINDINGS_KNOWN_ASSET_URLS_COLLECTION_FILTERS_AND_GOVERNANCE_LINEAGE',
            limits: {
                queryCount,
                readRows,
                perQueryRows: ROW_LIMIT,
                totalRows: TOTAL_ROW_LIMIT,
                queryMilliseconds: 3000,
            },
            // Unknown references remain explicit; a reference snapshot is not an access verdict.
            excludes: [
                'UNKNOWN_EXTERNAL_URL_OR_UNSUPPORTED_MARKUP_RESOLUTION',
                'UNRECOGNIZED_DYNAMIC_FILTER_ARGUMENTS',
                'ORDINARY_STORE_AUTHORIZATION_PROBES',
            ],
        },
        channelIds,
        defaultChannelId: String(defaultChannel.id),
        resourceSummary,
        missingRegistrations,
        // Identifier-only evidence permits an independent offline reference/grant review without another DB read.
        data: supplementary.data,
        supplementaryReferences: supplementary.evidence,
    };
}

// Business text and URLs exist only during this fixed read. Persist identifiers,
// counts and path hashes, never descriptions, URLs, settings, audit payloads or credentials.
export function collectSupplementaryCatalogReferences(input, allowedHosts) {
    const data = Object.fromEntries(
        Object.entries(input).map(([table, rows]) => [table, rows.map(r => ({ ...r }))]),
    );
    const paths = new Map();
    const references = [];
    const unresolved = [];
    const dynamicFilters = [];
    let rawBytes = 0;
    const pathFor = value => {
        if (typeof value !== 'string' || !value.trim() || /^data:/iu.test(value)) return null;
        try {
            const absolute = /^(?:https?:)?\/\//iu.test(value);
            const url = new URL(value, 'https://catalog-audit.invalid/');
            if (
                !['http:', 'https:'].includes(url.protocol) ||
                (absolute && !allowedHosts.includes(url.hostname))
            )
                return null;
            const pathname = decodeURIComponent(url.pathname)
                .replace(/^\/assets\//u, '')
                .replace(/^\//u, '');
            return pathname && !pathname.split('/').includes('..') ? pathname : null;
        } catch {
            return null;
        }
    };
    for (const asset of data.asset) {
        for (const field of ['source', 'preview']) {
            const raw = asset[field];
            const key = pathFor(raw);
            if (key) paths.set(key, ids([...(paths.get(key) ?? []), asset.id]));
            if (typeof raw === 'string')
                asset[field + 'PathSha256'] = createHash('sha256').update(raw).digest('hex');
            delete asset[field];
        }
    }
    const inspectUrl = (value, source) => {
        if (typeof value !== 'string' || !value.trim()) return;
        const found = paths.get(pathFor(value));
        if (found?.length === 1)
            references.push({ ...source, assetId: found[0], match: 'EXACT_KNOWN_ASSET_PATH' });
        else
            unresolved.push({
                ...source,
                reason: found?.length ? 'AMBIGUOUS_ASSET_PATH' : 'UNRESOLVED_OR_EXTERNAL_URL',
            });
    };
    for (const table of ['storefront_content_block', 'storefront_content_item'])
        for (const row of data[table]) {
            for (const field of ['legacyImageUrl', 'mobileImageUrl']) {
                inspectUrl(row[field], { table, sourceId: String(row.id), field });
                delete row[field];
            }
        }
    for (const table of [
        'product_translation',
        'collection_translation',
        'storefront_content_block_translation',
        'storefront_content_item_translation',
    ])
        for (const row of data[table]) {
            const field = table === 'storefront_content_block_translation' ? 'body' : 'description';
            const text = row[field];
            delete row[field];
            if (typeof text !== 'string') continue;
            rawBytes += Buffer.byteLength(text);
            assert.ok(rawBytes <= 8 * 1024 * 1024, 'Catalog reference scan byte budget exceeded');
            const source = { table, sourceId: String(row.id), parentId: String(row.baseId), field };
            if (text.length > 65536) {
                unresolved.push({ ...source, reason: 'TEXT_TOO_LARGE_FOR_COMPLETE_SCAN' });
                continue;
            }
            for (const match of text.matchAll(/\b(src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu)) {
                const value = match[2] ?? match[3] ?? match[4];
                for (const url of match[1].toLowerCase() === 'srcset'
                    ? value.split(',').map(v => v.trim().split(/\s+/u)[0])
                    : [value])
                    inspectUrl(url, source);
            }
            for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/giu))
                inspectUrl(match[1], source);
        }
    for (const row of data.collection) {
        const raw = row.filters;
        delete row.filters;
        if (raw == null) continue;
        let filters;
        try {
            filters = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            unresolved.push({ table: 'collection', sourceId: String(row.id), reason: 'INVALID_FILTER_JSON' });
            continue;
        }
        if (!Array.isArray(filters)) {
            unresolved.push({ table: 'collection', sourceId: String(row.id), reason: 'INVALID_FILTER_LIST' });
            continue;
        }
        for (const filter of filters)
            for (const arg of filter.args ?? []) {
                if (filter.code === 'facet-value-filter' && arg.name === 'facetValueIds') {
                    let values;
                    try {
                        values = JSON.parse(arg.value);
                    } catch {
                        values = null;
                    }
                    if (
                        !Array.isArray(values) ||
                        values.length > 1000 ||
                        values.some(v => !/^\d+$/u.test(String(v)))
                    ) {
                        unresolved.push({
                            table: 'collection',
                            sourceId: String(row.id),
                            reason: 'INVALID_FACET_FILTER_IDS',
                        });
                        continue;
                    }
                    for (const id of ids(values))
                        dynamicFilters.push({
                            collectionId: String(row.id),
                            resourceType: 'FacetValue',
                            resourceId: id,
                        });
                } else if (
                    /Ids?$/u.test(arg.name) &&
                    !['product-id-filter', 'variant-id-filter'].includes(filter.code)
                )
                    unresolved.push({
                        table: 'collection',
                        sourceId: String(row.id),
                        reason: 'UNRECOGNIZED_RESOURCE_FILTER',
                    });
            }
    }
    assert.ok(
        references.length + dynamicFilters.length + unresolved.length <= 10000,
        'Catalog reference result budget exceeded',
    );
    return {
        data,
        evidence: {
            mediaReferences: references,
            dynamicFacetReferences: dynamicFilters,
            unresolvedReferences: unresolved,
            textRowsRead: [
                'product_translation',
                'collection_translation',
                'storefront_content_block_translation',
                'storefront_content_item_translation',
            ].reduce((n, t) => n + data[t].length, 0),
            rawTextBytesScanned: rawBytes,
            governanceLineageRows: data.governance_audit_entry.length,
            ownershipInferred: false,
        },
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
