import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectOwnershipEvidence, redactOwnershipEvidence } from './store-isolation-ownership-evidence.mjs';

const ASSOCIATIONS = [
    {
        key: 'customers',
        entityTable: 'customer',
        relationTable: 'customer_channels_channel',
        entityIdColumn: 'customerId',
    },
    {
        key: 'stockLocations',
        entityTable: 'stock_location',
        relationTable: 'stock_location_channels_channel',
        entityIdColumn: 'stockLocationId',
        labelColumn: 'name',
    },
    {
        key: 'paymentMethods',
        entityTable: 'payment_method',
        relationTable: 'payment_method_channels_channel',
        entityIdColumn: 'paymentMethodId',
        labelColumn: 'code',
    },
    {
        key: 'shippingMethods',
        entityTable: 'shipping_method',
        relationTable: 'shipping_method_channels_channel',
        entityIdColumn: 'shippingMethodId',
        labelColumn: 'code',
    },
    {
        key: 'products',
        entityTable: 'product',
        relationTable: 'product_channels_channel',
        entityIdColumn: 'productId',
    },
    {
        key: 'productVariants',
        entityTable: 'product_variant',
        relationTable: 'product_variant_channels_channel',
        entityIdColumn: 'productVariantId',
        labelColumn: 'sku',
    },
    {
        key: 'collections',
        entityTable: 'collection',
        relationTable: 'collection_channels_channel',
        entityIdColumn: 'collectionId',
    },
    {
        key: 'assets',
        entityTable: 'asset',
        relationTable: 'asset_channels_channel',
        entityIdColumn: 'assetId',
        labelColumn: 'name',
    },
    {
        key: 'facets',
        entityTable: 'facet',
        relationTable: 'facet_channels_channel',
        entityIdColumn: 'facetId',
        labelColumn: 'code',
    },
    {
        key: 'facetValues',
        entityTable: 'facet_value',
        relationTable: 'facet_value_channels_channel',
        entityIdColumn: 'facetValueId',
        labelColumn: 'code',
    },
    {
        key: 'productOptionGroups',
        entityTable: 'product_option_group',
        relationTable: 'product_option_group_channels_channel',
        entityIdColumn: 'productOptionGroupId',
        labelColumn: 'code',
    },
    {
        key: 'productOptions',
        entityTable: 'product_option',
        relationTable: 'product_option_channels_channel',
        entityIdColumn: 'productOptionId',
        labelColumn: 'code',
    },
    {
        key: 'promotions',
        entityTable: 'promotion',
        relationTable: 'promotion_channels_channel',
        entityIdColumn: 'promotionId',
        labelColumn: 'couponCode',
    },
];

export const FORBIDDEN_SHARED_ASSOCIATION_KEYS = [
    'stockLocations',
    'paymentMethods',
    'shippingMethods',
    'products',
    'productVariants',
    'collections',
    'assets',
    'assetTags',
    'facets',
    'facetValues',
    'productOptionGroups',
    'productOptions',
    'promotions',
    'sellers',
];

const ICLOUD_TABLES = [
    'icloud_primary_account',
    'icloud_virtual_email',
    'icloud_received_mail',
    'icloud_query_audit_log',
];

const SAFE_DELIVERY_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.(?:zip|pdf|txt|md)$/u;

async function fileDigest(filePath) {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) digest.update(chunk);
    return digest.digest('hex');
}

export function summarizeStockOwnership(rows) {
    const variants = new Map();
    for (const row of rows) {
        const id = String(row.productVariantId);
        const quantities = [Number(row.stockOnHand), Number(row.stockAllocated)];
        if (!quantities.every(Number.isSafeInteger)) throw new Error('Unsafe stock quantity');
        const item = variants.get(id) ?? { quantities, channels: new Set() };
        if (item.quantities.some((value, index) => value !== quantities[index])) {
            throw new Error('Conflicting stock quantities for one variant');
        }
        if (row.channelId != null) item.channels.add(String(row.channelId));
        variants.set(id, item);
    }
    const buckets = new Map();
    for (const item of variants.values()) {
        const channelIds = [...item.channels].sort();
        const key = JSON.stringify(channelIds);
        const bucket = buckets.get(key) ?? { channelIds, variantCount: 0, stockOnHand: 0, stockAllocated: 0 };
        bucket.variantCount += 1;
        bucket.stockOnHand += item.quantities[0];
        bucket.stockAllocated += item.quantities[1];
        if (![bucket.stockOnHand, bucket.stockAllocated].every(Number.isSafeInteger)) {
            throw new Error('Unsafe stock total');
        }
        buckets.set(key, bucket);
    }
    return [...buckets.values()];
}

function quoted(identifier) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/u.test(identifier)) {
        throw new Error(`Unsafe SQL identifier: ${identifier}`);
    }
    return `\`${identifier}\``;
}

function entityReference(key, id, auditKey) {
    return createHash('sha256')
        .update(`${auditKey}\u0000${key}\u0000${String(id)}`)
        .digest('hex')
        .slice(0, 16);
}

function groupAssociations(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = String(row.entityId);
        const current = groups.get(key) ?? {
            entityId: row.entityId,
            label: row.label == null ? null : String(row.label),
            channelIds: new Set(),
        };
        current.channelIds.add(String(row.channelId));
        groups.set(key, current);
    }
    return Array.from(groups.values())
        .map(group => ({ ...group, channelIds: Array.from(group.channelIds).sort() }))
        .filter(group => group.channelIds.length > 1);
}

async function collectAssociation(adapter, definition) {
    if (
        !(await adapter.tableExists(definition.entityTable)) ||
        !(await adapter.tableExists(definition.relationTable))
    ) {
        return { available: false, shared: [] };
    }
    const label = definition.labelColumn
        ? `entity.${quoted(definition.labelColumn)} AS label`
        : 'NULL AS label';
    const rows = await adapter.query(
        `SELECT entity.${quoted('id')} AS entityId, ${label}, relation.${quoted('channelId')} AS channelId
         FROM ${quoted(definition.entityTable)} entity
         INNER JOIN ${quoted(definition.relationTable)} relation
             ON relation.${quoted(definition.entityIdColumn)} = entity.${quoted('id')}
         ORDER BY entity.${quoted('id')} ASC, relation.${quoted('channelId')} ASC`,
    );
    return { available: true, shared: groupAssociations(rows) };
}

async function collectSharedSellers(adapter) {
    if (
        !(await adapter.tableExists('seller')) ||
        !(await adapter.tableExists('channel')) ||
        !(await adapter.columnExists('channel', 'sellerId'))
    ) {
        return { available: false, shared: [] };
    }
    const rows = await adapter.query(
        `SELECT seller.${quoted('id')} AS entityId, seller.${quoted('name')} AS label,
                channel.${quoted('id')} AS channelId
         FROM ${quoted('seller')} seller
         INNER JOIN ${quoted('channel')} channel
             ON channel.${quoted('sellerId')} = seller.${quoted('id')}
         ORDER BY seller.${quoted('id')} ASC, channel.${quoted('id')} ASC`,
    );
    return { available: true, shared: groupAssociations(rows) };
}

async function collectSharedAssetTags(adapter) {
    if (
        !(await adapter.tableExists('tag')) ||
        !(await adapter.tableExists('asset_tags_tag')) ||
        !(await adapter.tableExists('asset_channels_channel'))
    ) {
        return { available: false, shared: [] };
    }
    const rows = await adapter.query(
        `SELECT tag.${quoted('id')} AS entityId, tag.${quoted('value')} AS label,
                assetChannel.${quoted('channelId')} AS channelId
         FROM ${quoted('tag')} tag
         INNER JOIN ${quoted('asset_tags_tag')} assetTag
             ON assetTag.${quoted('tagId')} = tag.${quoted('id')}
         INNER JOIN ${quoted('asset_channels_channel')} assetChannel
             ON assetChannel.${quoted('assetId')} = assetTag.${quoted('assetId')}
         ORDER BY tag.${quoted('id')} ASC, assetChannel.${quoted('channelId')} ASC`,
    );
    return { available: true, shared: groupAssociations(rows) };
}

function placeholders(values) {
    return values.map(() => '?').join(', ');
}

async function collectCustomerDetails(adapter, customerIds) {
    if (customerIds.length === 0) return [];
    const details = new Map(
        customerIds.map(id => [String(id), { customerId: id, addressCount: 0, orders: [] }]),
    );
    if (await adapter.tableExists('address')) {
        const rows = await adapter.query(
            `SELECT ${quoted('customerId')} AS customerId, COUNT(*) AS count
             FROM ${quoted('address')}
             WHERE ${quoted('customerId')} IN (${placeholders(customerIds)})
             GROUP BY ${quoted('customerId')}`,
            customerIds,
        );
        for (const row of rows) {
            const detail = details.get(String(row.customerId));
            if (detail) detail.addressCount = Number(row.count);
        }
    }
    if ((await adapter.tableExists('order')) && (await adapter.tableExists('order_channels_channel'))) {
        const rows = await adapter.query(
            `SELECT item.${quoted('customerId')} AS customerId, relation.${quoted('channelId')} AS channelId,
                    COUNT(*) AS count
             FROM ${quoted('order')} item
             INNER JOIN ${quoted('order_channels_channel')} relation
                 ON relation.${quoted('orderId')} = item.${quoted('id')}
             WHERE item.${quoted('customerId')} IN (${placeholders(customerIds)})
             GROUP BY item.${quoted('customerId')}, relation.${quoted('channelId')}
             ORDER BY item.${quoted('customerId')} ASC, relation.${quoted('channelId')} ASC`,
            customerIds,
        );
        for (const row of rows) {
            const detail = details.get(String(row.customerId));
            if (detail) detail.orders.push({ channelId: String(row.channelId), count: Number(row.count) });
        }
    }
    return Array.from(details.values());
}

async function collectStockLocationDetails(adapter, stockLocationIds) {
    if (stockLocationIds.length === 0) return [];
    const details = new Map(
        stockLocationIds.map(id => [
            String(id),
            { stockLocationId: id, stockLevelCount: 0, stockMovementCount: 0, variantCount: 0 },
        ]),
    );
    if (await adapter.tableExists('stock_level')) {
        const rows = await adapter.query(
            `SELECT ${quoted('stockLocationId')} AS stockLocationId, COUNT(*) AS stockLevelCount,
                    COUNT(DISTINCT ${quoted('productVariantId')}) AS variantCount
             FROM ${quoted('stock_level')}
             WHERE ${quoted('stockLocationId')} IN (${placeholders(stockLocationIds)})
             GROUP BY ${quoted('stockLocationId')}`,
            stockLocationIds,
        );
        for (const row of rows) {
            const detail = details.get(String(row.stockLocationId));
            if (detail) {
                detail.stockLevelCount = Number(row.stockLevelCount);
                detail.variantCount = Number(row.variantCount);
            }
        }
    }
    if (await adapter.tableExists('stock_movement')) {
        const rows = await adapter.query(
            `SELECT ${quoted('stockLocationId')} AS stockLocationId, COUNT(*) AS stockMovementCount
             FROM ${quoted('stock_movement')}
             WHERE ${quoted('stockLocationId')} IN (${placeholders(stockLocationIds)})
             GROUP BY ${quoted('stockLocationId')}`,
            stockLocationIds,
        );
        for (const row of rows) {
            const detail = details.get(String(row.stockLocationId));
            if (detail) detail.stockMovementCount = Number(row.stockMovementCount);
        }
    }
    if (
        (await adapter.tableExists('stock_level')) &&
        (await adapter.tableExists('product_variant_channels_channel'))
    ) {
        const rows = await adapter.query(
            `SELECT stock.stockLocationId, stock.productVariantId, stock.stockOnHand, stock.stockAllocated,
                    relation.channelId
             FROM stock_level stock LEFT JOIN product_variant_channels_channel relation
                 ON relation.productVariantId = stock.productVariantId
             WHERE stock.stockLocationId IN (${placeholders(stockLocationIds)})
             ORDER BY stock.stockLocationId, stock.productVariantId, relation.channelId`,
            stockLocationIds,
        );
        for (const [id, detail] of details) {
            detail.variantBuckets = summarizeStockOwnership(
                rows.filter(row => String(row.stockLocationId) === id),
            );
        }
    }
    return Array.from(details.values());
}

async function collectIcloudState(adapter) {
    const state = [];
    for (const tableName of ICLOUD_TABLES) {
        if (!(await adapter.tableExists(tableName))) {
            state.push({ tableName, exists: false, hasChannelId: false, totalRows: 0, unscopedRows: 0 });
            continue;
        }
        const hasChannelId = await adapter.columnExists(tableName, 'channelId');
        const [{ count = 0 } = {}] = await adapter.query(
            `SELECT COUNT(*) AS count FROM ${quoted(tableName)}`,
        );
        const totalRows = Number(count);
        let unscopedRows = totalRows;
        let channelCounts = [];
        if (hasChannelId) {
            const [{ count: nullCount = 0 } = {}] = await adapter.query(
                `SELECT COUNT(*) AS count FROM ${quoted(tableName)} WHERE ${quoted('channelId')} IS NULL`,
            );
            unscopedRows = Number(nullCount);
            channelCounts = (
                await adapter.query(
                    `SELECT ${quoted('channelId')} AS channelId, COUNT(*) AS count
                     FROM ${quoted(tableName)}
                     WHERE ${quoted('channelId')} IS NOT NULL
                     GROUP BY ${quoted('channelId')} ORDER BY ${quoted('channelId')} ASC`,
                )
            ).map(row => ({ channelId: String(row.channelId), count: Number(row.count) }));
        }
        state.push({ tableName, exists: true, hasChannelId, totalRows, unscopedRows, channelCounts });
    }
    return state;
}

export async function scanDigitalDeliveryRoot(rootPath) {
    if (!rootPath) return { configured: false, exists: false, legacyFiles: [], channelDirectories: [] };
    const absoluteRoot = path.resolve(rootPath);
    let entries;
    try {
        const rootMetadata = await lstat(absoluteRoot);
        if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory())
            throw new Error('Unsafe digital delivery root');
        entries = await readdir(absoluteRoot, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return {
                configured: true,
                exists: false,
                root: absoluteRoot,
                legacyFiles: [],
                channelDirectories: [],
            };
        }
        throw error;
    }
    const legacyFiles = [];
    const unsafeLegacyFileNames = [];
    const channelDirectories = [];
    for (const entry of entries) {
        const entryPath = path.join(absoluteRoot, entry.name);
        const metadata = await lstat(entryPath);
        if (metadata.isSymbolicLink()) {
            unsafeLegacyFileNames.push(entry.name);
            continue;
        }
        if (metadata.isFile()) {
            if (!SAFE_DELIVERY_FILE.test(entry.name)) continue;
            const sha256 = await fileDigest(entryPath);
            const after = await lstat(entryPath);
            if (
                after.isSymbolicLink() ||
                after.ino !== metadata.ino ||
                after.size !== metadata.size ||
                after.mtimeMs !== metadata.mtimeMs
            ) {
                throw new Error('Digital delivery file changed during preflight');
            }
            legacyFiles.push({ name: entry.name, bytes: metadata.size, sha256 });
        } else if (metadata.isDirectory()) {
            const children = await readdir(entryPath, { withFileTypes: true });
            channelDirectories.push({
                channelId: entry.name,
                fileCount: children.filter(child => child.isFile() && !child.isSymbolicLink()).length,
            });
        }
    }
    return {
        configured: true,
        exists: true,
        root: absoluteRoot,
        legacyFiles: legacyFiles.sort((left, right) => left.name.localeCompare(right.name)),
        unsafeLegacyFileNames,
        channelDirectories: channelDirectories.sort((left, right) =>
            left.channelId.localeCompare(right.channelId),
        ),
    };
}

export async function collectStoreIsolationSnapshot(adapter, digitalDeliveryRoot) {
    const channels = (await adapter.tableExists('channel'))
        ? await adapter.query(
              `SELECT ${quoted('id')} AS id, ${quoted('code')} AS code FROM ${quoted('channel')} ORDER BY ${quoted('id')} ASC`,
          )
        : [];
    const associations = {};
    for (const definition of ASSOCIATIONS) {
        associations[definition.key] = await collectAssociation(adapter, definition);
    }
    associations.sellers = await collectSharedSellers(adapter);
    associations.assetTags = await collectSharedAssetTags(adapter);
    const customerDetails = await collectCustomerDetails(
        adapter,
        associations.customers.shared.map(item => item.entityId),
    );
    const stockLocationDetails = await collectStockLocationDetails(
        adapter,
        associations.stockLocations.shared.map(item => item.entityId),
    );
    const digitalDelivery = await scanDigitalDeliveryRoot(digitalDeliveryRoot);
    if (
        digitalDelivery.legacyFiles.length &&
        (await adapter.tableExists('product_variant')) &&
        (await adapter.tableExists('product_variant_channels_channel'))
    ) {
        for (const file of digitalDelivery.legacyFiles) {
            const sku = path.basename(file.name, path.extname(file.name));
            const rows = await adapter.query(
                `SELECT DISTINCT relation.channelId FROM product_variant variant
                 INNER JOIN product_variant_channels_channel relation ON relation.productVariantId = variant.id
                 WHERE variant.sku = ? ORDER BY relation.channelId`,
                [sku],
            );
            file.candidateChannelIds = rows.map(row => String(row.channelId));
        }
    }
    return {
        channels: channels.map(channel => ({ id: String(channel.id), code: String(channel.code) })),
        associations,
        customerDetails,
        stockLocationDetails,
        ownershipEvidence: await collectOwnershipEvidence(adapter, associations, digitalDelivery.legacyFiles),
        icloud: await collectIcloudState(adapter),
        digitalDelivery,
    };
}

export function buildStoreIsolationPreflight(snapshot, auditKey) {
    const channelCodes = new Map(snapshot.channels.map(channel => [channel.id, channel.code]));
    const detailByCustomer = new Map(snapshot.customerDetails.map(item => [String(item.customerId), item]));
    const detailByStockLocation = new Map(
        snapshot.stockLocationDetails.map(item => [String(item.stockLocationId), item]),
    );
    const associations = {};
    for (const key of [...ASSOCIATIONS.map(definition => definition.key), 'sellers', 'assetTags']) {
        associations[key] = {
            available: snapshot.associations[key].available,
            sharedCount: snapshot.associations[key].shared.length,
            shared: snapshot.associations[key].shared.map(item => {
                const base = {
                    entityRef: entityReference(key, item.entityId, auditKey),
                    label: item.label,
                    channels: item.channelIds.map(channelId => ({
                        id: channelId,
                        code: channelCodes.get(channelId) ?? null,
                    })),
                };
                if (key === 'customers') {
                    const detail = detailByCustomer.get(String(item.entityId));
                    return {
                        ...base,
                        addressCount: detail?.addressCount ?? 0,
                        orders: (detail?.orders ?? []).map(order => ({
                            ...order,
                            channelCode: channelCodes.get(order.channelId) ?? null,
                        })),
                    };
                }
                if (key === 'stockLocations') {
                    const detail = detailByStockLocation.get(String(item.entityId));
                    return {
                        ...base,
                        stockLevelCount: detail?.stockLevelCount ?? 0,
                        stockMovementCount: detail?.stockMovementCount ?? 0,
                        variantCount: detail?.variantCount ?? 0,
                        variantBuckets: detail?.variantBuckets ?? null,
                    };
                }
                return base;
            }),
        };
    }
    const unscopedIcloudRows = snapshot.icloud.reduce((sum, table) => sum + table.unscopedRows, 0);
    return {
        format: 1,
        generatedAt: new Date().toISOString(),
        mode: 'read-only',
        channels: snapshot.channels,
        associations,
        ownershipEvidence: redactOwnershipEvidence(
            snapshot.ownershipEvidence,
            (key, id) => entityReference(key, id, auditKey),
            auditKey,
        ),
        icloud: snapshot.icloud,
        sharedResources: { icloud: { policy: 'platform-shared', legacyRows: unscopedIcloudRows } },
        digitalDelivery: {
            configured: snapshot.digitalDelivery.configured,
            exists: snapshot.digitalDelivery.exists,
            legacyFiles: snapshot.digitalDelivery.legacyFiles.map(file => ({
                fileRef: entityReference('digitalDeliveryFile', file.name, auditKey),
                fileName: file.name,
                extension: path.extname(file.name),
                bytes: file.bytes,
                sha256: file.sha256 ?? null,
                candidateChannelIds: file.candidateChannelIds ?? [],
            })),
            unsafeLegacyFileRefs: (snapshot.digitalDelivery.unsafeLegacyFileNames ?? []).map(name =>
                entityReference('digitalDeliveryFile', name, auditKey),
            ),
            channelDirectories: snapshot.digitalDelivery.channelDirectories,
            oldTokenCount: null,
            oldTokenCountReason: 'Digital delivery tokens are stateless and are not stored in the database.',
        },
        blockers: {
            sharedCustomers: associations.customers.sharedCount,
            sharedStockLocations: associations.stockLocations.sharedCount,
            sharedPaymentMethods: associations.paymentMethods.sharedCount,
            sharedShippingMethods: associations.shippingMethods.sharedCount,
            sharedProducts: associations.products.sharedCount,
            sharedProductVariants: associations.productVariants.sharedCount,
            sharedCollections: associations.collections.sharedCount,
            sharedAssets: associations.assets.sharedCount,
            sharedAssetTags: associations.assetTags.sharedCount,
            sharedFacets: associations.facets.sharedCount,
            sharedFacetValues: associations.facetValues.sharedCount,
            sharedProductOptionGroups: associations.productOptionGroups.sharedCount,
            sharedProductOptions: associations.productOptions.sharedCount,
            sharedPromotions: associations.promotions.sharedCount,
            sharedSellers: associations.sellers.sharedCount,
            unscopedIcloudRows: 0,
            unsafeLegacyDigitalFiles: snapshot.digitalDelivery.unsafeLegacyFileNames?.length ?? 0,
            legacyDigitalFiles: snapshot.digitalDelivery.legacyFiles.length,
        },
    };
}

function runtimeRequire(environment) {
    const moduleRoot = environment.STORE_ISOLATION_MODULE_ROOT?.trim();
    return moduleRoot
        ? createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
        : createRequire(import.meta.url);
}

export async function createStoreIsolationAdapter(environment) {
    const databaseType = String(environment.DB ?? 'mysql').toLowerCase();
    if (databaseType === 'sqlite' || databaseType === 'better-sqlite3') {
        const Database = runtimeRequire(environment)('better-sqlite3');
        const databasePath = path.resolve(environment.DB_NAME || 'vendure.sqlite');
        const database = new Database(databasePath, { fileMustExist: true, readonly: true });
        database.exec('BEGIN');
        return {
            kind: 'sqlite',
            query: async (sql, parameters = []) => database.prepare(sql).all(...parameters),
            tableExists: async tableName =>
                Boolean(
                    database
                        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
                        .get(tableName),
                ),
            columnExists: async (tableName, columnName) =>
                database
                    .prepare(`PRAGMA table_info(${quoted(tableName)})`)
                    .all()
                    .some(column => column.name === columnName),
            columnMetadata: async (tableName, columnName) => {
                const column = database
                    .prepare(`PRAGMA table_info(${quoted(tableName)})`)
                    .all()
                    .find(item => item.name === columnName);
                return column
                    ? { dataType: String(column.type).toLowerCase(), datetimePrecision: null }
                    : null;
            },
            close: async () => {
                database.exec('ROLLBACK');
                database.close();
            },
        };
    }
    if (databaseType !== 'mysql' && databaseType !== 'mariadb') {
        throw new Error(`Unsupported preflight database type: ${databaseType}`);
    }
    const mysql = runtimeRequire(environment)('mysql2/promise');
    const connection = await mysql.createConnection({
        host: environment.DB_HOST || '127.0.0.1',
        port: Number(environment.DB_PORT || 3306),
        user: environment.DB_USERNAME || 'vendure',
        password: environment.DB_PASSWORD || '',
        database: environment.DB_NAME || 'vendure-dev',
        multipleStatements: false,
    });
    return createReadOnlyMysqlAdapter(connection);
}

export async function createReadOnlyMysqlAdapter(connection, { closeConnection = true } = {}) {
    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('SET SESSION TRANSACTION READ ONLY');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    } catch (error) {
        try {
            await connection.query('ROLLBACK');
        } finally {
            if (closeConnection) await connection.end();
        }
        throw error;
    }
    return {
        kind: 'mysql',
        query: async (sql, parameters = []) => {
            const [rows] = await connection.query(sql, parameters);
            return rows;
        },
        tableExists: async tableName => {
            const [rows] = await connection.query(
                `SELECT 1 FROM information_schema.tables
                 WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
                [tableName],
            );
            return rows.length > 0;
        },
        columnExists: async (tableName, columnName) => {
            const [rows] = await connection.query(
                `SELECT 1 FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
                [tableName, columnName],
            );
            return rows.length > 0;
        },
        columnMetadata: async (tableName, columnName) => {
            const [rows] = await connection.query(
                `SELECT DATA_TYPE AS dataType, DATETIME_PRECISION AS datetimePrecision
                 FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
                [tableName, columnName],
            );
            return rows[0]
                ? {
                      dataType: String(rows[0].dataType).toLowerCase(),
                      datetimePrecision:
                          rows[0].datetimePrecision == null ? null : Number(rows[0].datetimePrecision),
                  }
                : null;
        },
        close: async () => {
            try {
                await connection.query('ROLLBACK');
            } finally {
                if (closeConnection) await connection.end();
            }
        },
    };
}

async function main() {
    await import('dotenv/config');
    const adapter = await createStoreIsolationAdapter(process.env);
    try {
        const snapshot = await collectStoreIsolationSnapshot(adapter, process.env.DIGITAL_DELIVERY_ROOT);
        const auditKey = process.env.STORE_ISOLATION_AUDIT_KEY?.trim() || randomBytes(32).toString('hex');
        process.stdout.write(
            `${JSON.stringify(buildStoreIsolationPreflight(snapshot, auditKey), null, 2)}\n`,
        );
    } finally {
        await adapter.close();
    }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
