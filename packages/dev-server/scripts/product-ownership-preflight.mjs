#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStoreIsolationAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

const ENTITY_TYPES = {
    variants: ['product_variant', 'product_variant_channels_channel', 'productVariantId', 'sku'],
    assets: ['asset', 'asset_channels_channel', 'assetId', null],
    collections: ['collection', 'collection_channels_channel', 'collectionId', null],
    facets: ['facet', 'facet_channels_channel', 'facetId', 'code'],
    facetValues: ['facet_value', 'facet_value_channels_channel', 'facetValueId', 'code'],
    optionGroups: [
        'product_option_group',
        'product_option_group_channels_channel',
        'productOptionGroupId',
        'code',
    ],
    options: ['product_option', 'product_option_channels_channel', 'productOptionId', 'code'],
};

const RELATION_TABLES = [
    'product',
    'product_channels_channel',
    'product_variant',
    'product_asset',
    'product_variant_asset',
    'product_option_groups_product_option_group',
    'product_variant_options_product_option',
    'product_facet_values_facet_value',
    'product_variant_facet_values_facet_value',
    'collection_product_variants_product_variant',
    'channel',
    'order',
    'order_line',
    'stock_level',
    'stock_location',
    'stock_location_channels_channel',
    ...Object.values(ENTITY_TYPES).flatMap(([entity, relation]) => [entity, relation]),
];

const STOCK_COLUMNS = {
    stock_level: ['id', 'productVariantId', 'stockLocationId', 'stockOnHand', 'stockAllocated'],
    stock_location: ['id'],
    stock_location_channels_channel: ['stockLocationId', 'channelId'],
    channel: ['id', 'code'],
};

function quoted(identifier) {
    if (!/^[a-z][a-zA-Z0-9_]*$/u.test(identifier)) throw new Error('Unsafe database identifier');
    return `\`${identifier}\``;
}

function uniqueIds(values) {
    return [...new Set(values.filter(value => value != null).map(String))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
    );
}

function placeholders(values) {
    return values.map(() => '?').join(', ');
}

function stockCheck(condition) {
    if (!condition) throw new Error('Invalid stock ownership facts');
}

function stockOwnershipId(value) {
    stockCheck(typeof value === 'string' || Number.isSafeInteger(value));
    stockCheck(/^[1-9][0-9]*$/u.test(String(value)));
    return String(value);
}

function stockQuantity(value) {
    stockCheck(Number.isSafeInteger(value));
    return value;
}

async function collectStockOwnership(adapter, variantIds, channelRows) {
    for (const [table, columns] of Object.entries(STOCK_COLUMNS)) {
        for (const column of columns) {
            if (!(await adapter.columnExists(table, column))) {
                throw new Error(`Missing required column: ${table}.${column}`);
            }
        }
    }
    const channels = new Map(
        channelRows.map(({ id, code }) => {
            stockCheck(code === null || typeof code === 'string');
            return [stockOwnershipId(id), code];
        }),
    );
    stockCheck(channels.size === channelRows.length);
    if (variantIds.length === 0) return { variantIds, levels: [] };
    const variantScope = new Set(variantIds);
    const stockRows = await adapter.query(
        `SELECT stock.id, stock.productVariantId, stock.stockLocationId, stock.stockOnHand,
                stock.stockAllocated, location.id AS locationId,
                membership.stockLocationId AS memberLocationId, membership.channelId
         FROM \`stock_level\` stock
         LEFT JOIN \`stock_location\` location ON location.id = stock.stockLocationId
         LEFT JOIN \`stock_location_channels_channel\` membership ON membership.stockLocationId = stock.stockLocationId
         WHERE stock.productVariantId IN (${placeholders(variantIds)}) ORDER BY stock.id, membership.channelId`,
        variantIds,
    );
    const levels = new Map();
    const joinedIds = new Set();
    for (const row of stockRows) {
        const level = {
            id: stockOwnershipId(row.id),
            productVariantId: stockOwnershipId(row.productVariantId),
            stockLocationId: stockOwnershipId(row.stockLocationId),
            stockOnHand: stockQuantity(row.stockOnHand),
            stockAllocated: stockQuantity(row.stockAllocated),
            stockLocationExists: row.locationId !== null,
        };
        const channelId = row.channelId === null ? null : stockOwnershipId(row.channelId);
        stockCheck(variantScope.has(level.productVariantId));
        stockCheck(!level.stockLocationExists || stockOwnershipId(row.locationId) === level.stockLocationId);
        stockCheck(
            channelId === null
                ? row.memberLocationId === null
                : stockOwnershipId(row.memberLocationId) === level.stockLocationId && channels.has(channelId),
        );
        const previous = levels.get(level.id);
        const key = `${level.id}:${channelId}`;
        stockCheck(!previous || Object.entries(level).every(([field, value]) => previous[field] === value));
        stockCheck(!joinedIds.has(key));
        joinedIds.add(key);
        if (!previous) levels.set(level.id, { ...level, channels: [] });
        if (channelId !== null) {
            levels.get(level.id).channels.push({ id: channelId, code: channels.get(channelId) });
        }
    }
    return {
        variantIds,
        levels: uniqueIds([...levels.keys()]).map(id => {
            const level = levels.get(id);
            level.channels.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
            return level;
        }),
    };
}

async function linkedIds(adapter, table, sourceColumn, targetColumn, sourceIds) {
    if (sourceIds.length === 0) return [];
    const rows = await adapter.query(
        `SELECT ${quoted(targetColumn)} AS id FROM ${quoted(table)}
         WHERE ${quoted(sourceColumn)} IN (${placeholders(sourceIds)})`,
        sourceIds,
    );
    return uniqueIds(rows.map(row => row.id));
}

async function entityRecords(adapter, type, ids, channelCodes) {
    if (ids.length === 0) return [];
    const [table, relation, relationId, label] = ENTITY_TYPES[type];
    const selection = label ? `, ${quoted(label)} AS label` : '';
    const rows = await adapter.query(
        `SELECT ${quoted('id')} AS id${selection} FROM ${quoted(table)}
         WHERE ${quoted('id')} IN (${placeholders(ids)})`,
        ids,
    );
    const memberships = await adapter.query(
        `SELECT ${quoted(relationId)} AS id, ${quoted('channelId')} AS channelId
         FROM ${quoted(relation)} WHERE ${quoted(relationId)} IN (${placeholders(ids)})`,
        ids,
    );
    const byId = new Map(rows.map(row => [String(row.id), row]));
    const channelsById = new Map(ids.map(id => [id, []]));
    for (const membership of memberships) {
        const channels = channelsById.get(String(membership.id));
        if (channels) channels.push(String(membership.channelId));
    }
    return ids.map(id => ({
        id,
        ...(label ? { label: byId.get(id)?.label ?? null } : {}),
        missingEntity: !byId.has(id),
        channels: uniqueIds(channelsById.get(id) ?? []).map(channelId => ({
            id: channelId,
            code: channelCodes.get(channelId) ?? null,
        })),
    }));
}

async function historicalSales(adapter, productId, channelCodes) {
    if (!(await adapter.columnExists('order', 'salesChannelId'))) {
        throw new Error('Missing required column: order.salesChannelId');
    }
    const rows = await adapter.query(
        `SELECT sale.salesChannelId AS channelId,
                COUNT(DISTINCT line.orderId) AS orderCount,
                COUNT(*) AS orderLineCount
         FROM \`order_line\` line
         JOIN \`product_variant\` variant ON variant.id = line.productVariantId
         JOIN \`order\` sale ON sale.id = line.orderId
         WHERE variant.productId = ?
         GROUP BY sale.salesChannelId`,
        [productId],
    );
    const bySalesChannel = rows
        .map(row => {
            const channelId = row.channelId == null ? null : String(row.channelId);
            if (channelId != null && !channelCodes.has(channelId)) {
                throw new Error('Historical sale has an unknown sales Channel');
            }
            return {
                channelId,
                channelCode: channelId == null ? null : channelCodes.get(channelId),
                orderCount: Number(row.orderCount),
                orderLineCount: Number(row.orderLineCount),
            };
        })
        .sort((a, b) => (a.channelCode ?? '').localeCompare(b.channelCode ?? ''));
    return {
        orderCount: bySalesChannel.reduce((total, item) => total + item.orderCount, 0),
        orderLineCount: bySalesChannel.reduce((total, item) => total + item.orderLineCount, 0),
        bySalesChannel,
    };
}

export function summarizeProductOwnership(productId, records) {
    const operatingChannels = channels =>
        channels
            .filter(channel => channel.code && channel.code !== '__default_channel__')
            .map(channel => channel.id);
    const productStores = operatingChannels(records.product.channels);
    const blockers = [];
    if (records.product.channels.some(channel => !channel.code)) {
        blockers.push({ code: 'UNKNOWN_PRODUCT_CHANNEL', entityId: productId });
    }
    if (productStores.length !== 1) {
        blockers.push({
            code: productStores.length === 0 ? 'PRODUCT_WITHOUT_STORE' : 'PRODUCT_SHARED_ACROSS_STORES',
            entityId: productId,
        });
    } else if (records.product.channels.length !== 1) {
        blockers.push({ code: 'PRODUCT_REQUIRES_CHANNEL_MIGRATION', entityId: productId });
    }
    for (const [type, items] of Object.entries(records.related)) {
        for (const item of items) {
            const stores = operatingChannels(item.channels);
            if (
                item.missingEntity ||
                item.channels.some(channel => !channel.code) ||
                (type === 'variants' && item.channels.length !== 1) ||
                stores.length !== 1 ||
                stores[0] !== productStores[0]
            ) {
                blockers.push({ code: 'RELATED_OWNERSHIP_CONFLICT', type, entityId: item.id });
            }
        }
    }
    return {
        mode: 'read-only',
        productId: String(productId),
        editableAsExclusiveStoreProduct: blockers.length === 0,
        product: records.product,
        related: records.related,
        blockers,
    };
}

export async function collectProductOwnershipPreflight(adapter, productId) {
    if (!/^[1-9][0-9]*$/u.test(String(productId))) throw new Error('Product ID must be a positive integer');
    for (const table of new Set(RELATION_TABLES)) {
        if (!(await adapter.tableExists(table))) throw new Error(`Missing required table: ${table}`);
    }
    const products = await adapter.query(
        'SELECT id, featuredAssetId FROM `product` WHERE id = ? AND deletedAt IS NULL',
        [productId],
    );
    if (products.length !== 1) throw new Error(`Active product ${productId} not found`);
    const channelRows = await adapter.query('SELECT id, code FROM `channel`');
    const channelCodes = new Map(channelRows.map(row => [String(row.id), String(row.code)]));
    const productChannels = await adapter.query(
        'SELECT channelId FROM `product_channels_channel` WHERE productId = ?',
        [productId],
    );
    const variantRows = await adapter.query(
        'SELECT id, sku, featuredAssetId FROM `product_variant` WHERE productId = ? AND deletedAt IS NULL',
        [productId],
    );
    const activeVariantIds = variantRows.map(row => stockOwnershipId(row.id));
    stockCheck(new Set(activeVariantIds).size === activeVariantIds.length);
    const variantIds = uniqueIds(activeVariantIds);
    const stockOwnership = await collectStockOwnership(adapter, variantIds, channelRows);
    const assetIds = uniqueIds([
        products[0].featuredAssetId,
        ...variantRows.map(row => row.featuredAssetId),
        ...(await linkedIds(adapter, 'product_asset', 'productId', 'assetId', [productId])),
        ...(await linkedIds(adapter, 'product_variant_asset', 'productVariantId', 'assetId', variantIds)),
    ]);
    const optionIds = await linkedIds(
        adapter,
        'product_variant_options_product_option',
        'productVariantId',
        'productOptionId',
        variantIds,
    );
    const optionRows = optionIds.length
        ? await adapter.query(
              `SELECT id, groupId FROM \`product_option\` WHERE id IN (${placeholders(optionIds)})`,
              optionIds,
          )
        : [];
    const optionGroupIds = uniqueIds([
        ...(await linkedIds(
            adapter,
            'product_option_groups_product_option_group',
            'productId',
            'productOptionGroupId',
            [productId],
        )),
        ...optionRows.map(row => row.groupId),
    ]);
    const facetValueIds = uniqueIds([
        ...(await linkedIds(adapter, 'product_facet_values_facet_value', 'productId', 'facetValueId', [
            productId,
        ])),
        ...(await linkedIds(
            adapter,
            'product_variant_facet_values_facet_value',
            'productVariantId',
            'facetValueId',
            variantIds,
        )),
    ]);
    const facetRows = facetValueIds.length
        ? await adapter.query(
              `SELECT id, facetId FROM \`facet_value\` WHERE id IN (${placeholders(facetValueIds)})`,
              facetValueIds,
          )
        : [];
    const relatedIds = {
        variants: variantIds,
        assets: assetIds,
        collections: await linkedIds(
            adapter,
            'collection_product_variants_product_variant',
            'productVariantId',
            'collectionId',
            variantIds,
        ),
        facets: uniqueIds(facetRows.map(row => row.facetId)),
        facetValues: facetValueIds,
        optionGroups: optionGroupIds,
        options: optionIds,
    };
    const related = Object.fromEntries(
        await Promise.all(
            Object.entries(relatedIds).map(async ([type, ids]) => [
                type,
                await entityRecords(adapter, type, ids, channelCodes),
            ]),
        ),
    );
    const report = summarizeProductOwnership(productId, {
        product: {
            id: String(productId),
            channels: uniqueIds(productChannels.map(row => row.channelId)).map(id => ({
                id,
                code: channelCodes.get(id) ?? null,
            })),
        },
        related,
    });
    return {
        ...report,
        historicalSales: await historicalSales(adapter, productId, channelCodes),
        stockOwnership,
    };
}

async function main() {
    const argument = process.argv.slice(2).find(value => value.startsWith('--product-id='));
    if (!argument || process.argv.length !== 3) {
        throw new Error('Usage: node product-ownership-preflight.mjs --product-id=1');
    }
    const productId = argument.slice('--product-id='.length);
    if (!/^[1-9][0-9]*$/u.test(productId)) throw new Error('Product ID must be a positive integer');
    // Production operations invoke this transported script with Node's --env-file.
    // Avoid resolving dotenv relative to the temporary transport directory.
    const adapter = await createStoreIsolationAdapter(process.env);
    try {
        const report = await collectProductOwnershipPreflight(adapter, productId);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        await adapter.close();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        process.stderr.write(`${safeReadOnlyAuditFailure(error)}\n`);
        process.exitCode = 1;
    });
}
