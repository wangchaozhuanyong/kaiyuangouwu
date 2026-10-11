import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_CODE = '__default_channel__';
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCHEMA = 'vendure-default-catalog-associations-v1';
const productColumns = [
    'id',
    'enabled',
    'deletedAt',
    'updatedAt',
    'featuredAssetId',
    'customFieldsFulfillmenttype',
];
const variantColumns = [
    'id',
    'productId',
    'sku',
    'enabled',
    'deletedAt',
    'updatedAt',
    'featuredAssetId',
    'customFieldsFulfillmenttype',
    'customFieldsDigitaldeliverymode',
    'customFieldsDigitalstockpolicy',
];
const requiredColumns = {
    product: ['id', 'enabled', 'deletedAt', 'updatedAt'],
    product_variant: ['id', 'productId', 'deletedAt', 'updatedAt'],
    product_variant_price: ['variantId', 'channelId', 'currencyCode', 'price'],
    stock_level: ['productVariantId', 'stockOnHand', 'stockAllocated'],
    catalog_resource_ownership: ['resourceType', 'resourceId', 'ownerChannelId'],
};
// Only these non-sensitive columns may be read. Never load card payloads,
// credentials, customer records or whole configuration/entity rows.
const protectedTables = [
    ['product_variant_price', 'variantId', ['id', 'variantId', 'channelId', 'currencyCode', 'price']],
    [
        'stock_level',
        'productVariantId',
        ['id', 'productVariantId', 'stockLocationId', 'stockOnHand', 'stockAllocated'],
    ],
    [
        'catalog_resource_ownership',
        'resourceId',
        ['id', 'resourceType', 'resourceId', 'ownerChannelId', 'scope'],
    ],
    [
        'product_sales_authorization',
        'productId',
        [
            'id',
            'productId',
            'channelId',
            'sourceChannelId',
            'state',
            'variantIds',
            'pendingVariantIds',
            'version',
        ],
    ],
    ['auto_card_config', 'productVariantId', ['id', 'channelId', 'productVariantId', 'enabled']],
    [
        'auto_card_supply_grant',
        'productVariantId',
        ['id', 'channelId', 'productVariantId', 'sourceChannelId', 'configId', 'enabled'],
    ],
];
const canonical = value =>
    value instanceof Date
        ? value.toISOString()
        : Array.isArray(value)
          ? value.map(canonical)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                  Object.keys(value)
                      .sort()
                      .map(key => [key, canonical(value[key])]),
              )
            : value;
const hash = value =>
    createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
const sorted = rows => rows.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const placeholders = ids => ids.map(() => '?').join(',');
const quote = column => `\`${column}\``;

function validateRequest(request) {
    assert.match(request.runtimeSha ?? '', /^[a-f0-9]{40}$/, 'A verified runtime SHA is required');
    assert.equal(request.runtimeSha, request.expectedRuntimeSha, 'Runtime SHA changed');
    assert.ok(
        typeof request.preserveChannelCode === 'string' && request.preserveChannelCode.trim(),
        'Preserved store code is required',
    );
    assert.notEqual(request.preserveChannelCode, DEFAULT_CODE, 'Default Channel is not an operating store');
    const names = request.expectedProductNames;
    assert.ok(
        Array.isArray(names) && names.length > 0 && names.length <= 100,
        'An exact bounded product-name manifest is required',
    );
    assert.ok(
        names.every(name => typeof name === 'string' && name.trim() && name === name.trim()),
        'Product names must be complete and trimmed',
    );
    assert.equal(new Set(names).size, names.length, 'Duplicate expected product names');
}

async function projectRows(adapter, table, whitelist, key, ids, lock, extra = '') {
    if (!(await adapter.tableExists(table))) return null;
    const available = await adapter.columns(table);
    assert.ok(
        (requiredColumns[table] ?? []).every(column => available.includes(column)),
        `Required ${table} projection columns are missing`,
    );
    const columns = whitelist.filter(column => available.includes(column));
    assert.ok(columns.includes(key), `Required ${table}.${key} column is missing`);
    return adapter.query(
        `SELECT ${columns.map(quote).join(',')} FROM ${quote(table)} WHERE ${quote(key)} IN (${placeholders(ids)})${extra}${lock ? ' FOR UPDATE' : ''}`,
        ids,
    );
}

async function protectedSnapshot(adapter, state, lock = false) {
    const { productIds, variantIds, defaultChannelId } = state;
    const rows = {
        products: await projectRows(adapter, 'product', productColumns, 'id', productIds, lock),
        variants: await projectRows(adapter, 'product_variant', variantColumns, 'id', variantIds, lock),
        translations: await projectRows(
            adapter,
            'product_translation',
            ['id', 'baseId', 'languageCode', 'name', 'slug', 'description'],
            'baseId',
            productIds,
            lock,
        ),
        productMemberships: await adapter.query(
            `SELECT productId,channelId FROM product_channels_channel WHERE productId IN (${placeholders(productIds)}) AND channelId != ?${lock ? ' FOR UPDATE' : ''}`,
            [...productIds, defaultChannelId],
        ),
        variantMemberships: await adapter.query(
            'SELECT productVariantId,channelId FROM product_variant_channels_channel ' +
                `WHERE productVariantId IN (${placeholders(variantIds)}) AND channelId != ?${lock ? ' FOR UPDATE' : ''}`,
            [...variantIds, defaultChannelId],
        ),
        archivedDefaultProductMemberships: await adapter.query(
            'SELECT pc.productId,pc.channelId FROM product_channels_channel pc ' +
                'JOIN product p ON p.id = pc.productId ' +
                `WHERE pc.channelId = ? AND p.deletedAt IS NOT NULL${lock ? ' FOR UPDATE' : ''}`,
            [defaultChannelId],
        ),
        archivedDefaultVariantMemberships: await adapter.query(
            'SELECT vc.productVariantId,vc.channelId FROM product_variant_channels_channel vc ' +
                'JOIN product_variant v ON v.id = vc.productVariantId ' +
                `WHERE vc.channelId = ? AND v.deletedAt IS NOT NULL${lock ? ' FOR UPDATE' : ''}`,
            [defaultChannelId],
        ),
    };
    for (const [table, key, columns] of protectedTables) {
        const productScope = ['catalog_resource_ownership', 'product_sales_authorization'].includes(table);
        rows[table] = await projectRows(
            adapter,
            table,
            columns,
            key,
            productScope ? productIds : variantIds,
            lock,
            table === 'catalog_resource_ownership' ? " AND resourceType = 'Product'" : '',
        );
        if (table === 'stock_level') assert.ok(rows[table], 'Core stock-level table is required');
    }
    return Object.fromEntries(
        Object.entries(rows).map(([key, value]) => [key, value == null ? 'ABSENT' : hash(sorted(value))]),
    );
}

export async function collectPlan(adapter, request, { lock = false } = {}) {
    validateRequest(request);
    const suffix = lock ? ' FOR UPDATE' : '';
    const channels = await adapter.query(
        `SELECT id,code FROM channel WHERE code IN (?,?) ORDER BY id${suffix}`,
        [DEFAULT_CODE, request.preserveChannelCode],
    );
    const defaultChannel = channels.find(channel => channel.code === DEFAULT_CODE);
    const preserved = channels.find(channel => channel.code === request.preserveChannelCode);
    assert.ok(
        defaultChannel && preserved && channels.length === 2,
        'Default or preserved store is missing or ambiguous',
    );
    const defaultChannelId = String(defaultChannel.id);
    const preserveChannelId = String(preserved.id);
    const productRelations = (
        await adapter.query(
            'SELECT pc.productId,pc.channelId FROM product_channels_channel pc ' +
                'JOIN product p ON p.id = pc.productId ' +
                `WHERE pc.channelId = ? AND p.deletedAt IS NULL ORDER BY pc.productId${suffix}`,
            [defaultChannelId],
        )
    ).map(row => ({ productId: String(row.productId), channelId: String(row.channelId) }));
    assert.equal(
        productRelations.length,
        request.expectedProductNames.length,
        'Active default product count differs from the complete name manifest',
    );
    const productIds = productRelations.map(row => row.productId);
    assert.equal(new Set(productIds).size, productIds.length, 'Duplicate default product relationships');
    const products = await projectRows(adapter, 'product', productColumns, 'id', productIds, lock);
    assert.equal(products?.length, productIds.length, 'Default product entity is missing');
    assert.ok(
        products.every(product => product.deletedAt == null),
        'Deleted default products require separate review',
    );
    const translations = await projectRows(
        adapter,
        'product_translation',
        ['baseId', 'languageCode', 'name'],
        'baseId',
        productIds,
        lock,
    );
    assert.ok(translations, 'Product names are unavailable');
    const items = productIds.map(id => {
        const matches = [
            ...new Set(
                translations
                    .filter(
                        row => String(row.baseId) === id && request.expectedProductNames.includes(row.name),
                    )
                    .map(row => row.name),
            ),
        ];
        assert.equal(matches.length, 1, 'Product names do not exactly match the reviewed manifest');
        return { id, name: matches[0], variantIds: [] };
    });
    assert.equal(
        new Set(items.map(item => item.name)).size,
        items.length,
        'Duplicate actual product names are ambiguous',
    );
    const memberships = await adapter.query(
        `SELECT productId,channelId FROM product_channels_channel WHERE productId IN (${placeholders(productIds)})${suffix}`,
        productIds,
    );
    assert.ok(
        productIds.every(id =>
            memberships.some(
                row => String(row.productId) === id && String(row.channelId) === preserveChannelId,
            ),
        ),
        'Every product must retain the preserved store association',
    );
    const variants = await projectRows(
        adapter,
        'product_variant',
        variantColumns,
        'productId',
        productIds,
        lock,
        ' AND deletedAt IS NULL',
    );
    assert.ok(variants?.length, 'Products without variants require separate review');
    const variantIds = variants.map(variant => String(variant.id));
    for (const item of items) {
        item.variantIds = variants
            .filter(variant => String(variant.productId) === item.id)
            .map(variant => String(variant.id))
            .sort();
        assert.ok(item.variantIds.length, 'Every selected product needs verified variants');
    }
    const variantMemberships = await adapter.query(
        `SELECT productVariantId,channelId FROM product_variant_channels_channel WHERE productVariantId IN (${placeholders(variantIds)})${suffix}`,
        variantIds,
    );
    assert.ok(
        variantIds.every(id =>
            variantMemberships.some(
                row => String(row.productVariantId) === id && String(row.channelId) === preserveChannelId,
            ),
        ),
        'Every variant must retain the preserved store association',
    );
    const variantRelations = (
        await adapter.query(
            'SELECT vc.productVariantId,vc.channelId FROM product_variant_channels_channel vc ' +
                'JOIN product_variant v ON v.id = vc.productVariantId ' +
                `WHERE vc.channelId = ? AND v.deletedAt IS NULL ORDER BY vc.productVariantId${suffix}`,
            [defaultChannelId],
        )
    ).map(row => ({ productVariantId: String(row.productVariantId), channelId: String(row.channelId) }));
    assert.ok(
        variantRelations.every(row => variantIds.includes(row.productVariantId)),
        'Unreviewed active default variant relationships exist',
    );
    const prices = await projectRows(
        adapter,
        'product_variant_price',
        ['id', 'variantId', 'channelId', 'currencyCode', 'price'],
        'variantId',
        variantIds,
        lock,
    );
    assert.ok(
        prices &&
            variantIds.every(id =>
                prices.some(
                    row => String(row.variantId) === id && String(row.channelId) === preserveChannelId,
                ),
            ),
        'Every variant needs a preserved-store price',
    );
    const owners = await projectRows(
        adapter,
        'catalog_resource_ownership',
        ['resourceType', 'resourceId', 'ownerChannelId', 'scope'],
        'resourceId',
        productIds,
        lock,
        " AND resourceType = 'Product'",
    );
    assert.ok(
        owners &&
            productIds.every(id => {
                const matches = owners.filter(owner => String(owner.resourceId) === id);
                return (
                    matches.length === 1 &&
                    String(matches[0].ownerChannelId) === preserveChannelId &&
                    (matches[0].scope == null || matches[0].scope === 'STORE')
                );
            }),
        'Every product must be maintained by the preserved operating store',
    );
    const state = { productIds, variantIds, defaultChannelId };
    const rawDefaultCounts = {};
    for (const [key, table] of [
        ['rawDefaultProductCount', 'product_channels_channel'],
        ['rawDefaultVariantCount', 'product_variant_channels_channel'],
    ]) {
        const counts = await adapter.query(`SELECT COUNT(*) AS count FROM ${table} WHERE channelId = ?`, [
            defaultChannelId,
        ]);
        rawDefaultCounts[key] = Number(counts[0].count);
    }
    const plan = {
        schema: SCHEMA,
        runtimeSha: request.runtimeSha,
        preserveChannelCode: request.preserveChannelCode,
        defaultChannelId,
        preserveChannelId,
        items,
        productRelations,
        variantRelations,
        ...rawDefaultCounts,
        protectedDigests: await protectedSnapshot(adapter, state, lock),
    };
    return { ...plan, digest: hash(plan) };
}

async function saveRelationshipBackup(backupFile, projectRoot, plan) {
    assert.ok(
        backupFile && path.isAbsolute(backupFile),
        'An absolute new relationship-backup file is required',
    );
    const root = await realpath(projectRoot);
    const directory = path.join(root, 'backups');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    assert.equal(await realpath(directory), directory, 'Backup directory cannot be a symlink');
    const target = path.resolve(backupFile);
    assert.equal(
        path.dirname(target),
        directory,
        'Relationship backup must be directly inside this project backups directory',
    );
    const handle = await open(target, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify({ ...plan, schema: `${SCHEMA}-backup` }, null, 2)}\n`);
        await handle.sync();
    } finally {
        await handle.close();
    }
}

export async function applyPlan(
    adapter,
    request,
    {
        expectedDigest,
        backupFile,
        projectRoot = PROJECT_ROOT,
        verifyRuntime = async () => undefined,
        beforeWrite = async () => undefined,
    } = {},
) {
    assert.match(expectedDigest ?? '', /^[a-f0-9]{64}$/, 'An exact reviewed plan digest is required');
    await verifyRuntime();
    await adapter.begin();
    try {
        const plan = await collectPlan(adapter, request, { lock: true });
        assert.equal(plan.digest, expectedDigest, 'Data drift after preview; review a new plan');
        await saveRelationshipBackup(backupFile, projectRoot, plan);
        await beforeWrite();
        await verifyRuntime();
        const productIds = plan.items.map(item => item.id);
        const variantIds = plan.items.flatMap(item => item.variantIds);
        if (plan.variantRelations.length) {
            const removedVariants = await adapter.query(
                `DELETE FROM product_variant_channels_channel WHERE channelId = ? AND productVariantId IN (${placeholders(variantIds)})`,
                [plan.defaultChannelId, ...variantIds],
            );
            assert.equal(
                removedVariants.affectedRows,
                plan.variantRelations.length,
                'Variant relationship delete count drift',
            );
        }
        const result = await adapter.query(
            `DELETE FROM product_channels_channel WHERE channelId = ? AND productId IN (${placeholders(productIds)})`,
            [plan.defaultChannelId, ...productIds],
        );
        assert.equal(
            result.affectedRows,
            plan.productRelations.length,
            'Product relationship delete count drift',
        );
        const rawRemainingCounts = {};
        for (const [key, table, entity, foreignKey, removedCount] of [
            [
                'rawDefaultProductCount',
                'product_channels_channel',
                'product',
                'productId',
                plan.productRelations.length,
            ],
            [
                'rawDefaultVariantCount',
                'product_variant_channels_channel',
                'product_variant',
                'productVariantId',
                plan.variantRelations.length,
            ],
        ]) {
            const remaining = await adapter.query(
                `SELECT COUNT(*) AS count FROM ${table} WHERE channelId = ?`,
                [plan.defaultChannelId],
            );
            rawRemainingCounts[key] = Number(remaining[0].count);
            assert.equal(
                rawRemainingCounts[key],
                plan[key] - removedCount,
                'Historical default relation count changed',
            );
            const activeRemaining = await adapter.query(
                `SELECT COUNT(*) AS count FROM ${table} r JOIN ${entity} e ON e.id = r.${foreignKey} ` +
                    'WHERE r.channelId = ? AND e.deletedAt IS NULL',
                [plan.defaultChannelId],
            );
            assert.equal(
                Number(activeRemaining[0].count),
                0,
                'Active default associations are not empty after cleanup',
            );
        }
        const after = await protectedSnapshot(
            adapter,
            { productIds, variantIds, defaultChannelId: plan.defaultChannelId },
            true,
        );
        assert.deepEqual(after, plan.protectedDigests, 'Protected store data changed; cleanup rolled back');
        await verifyRuntime();
        await adapter.commit();
        return {
            schema: SCHEMA,
            status: 'APPLIED',
            runtimeSha: plan.runtimeSha,
            planDigest: plan.digest,
            removedProducts: plan.productRelations.length,
            removedVariants: plan.variantRelations.length,
            activeDefaultProductCount: 0,
            activeDefaultVariantCount: 0,
            ...rawRemainingCounts,
            protectedVerified: true,
            backupFile: path.resolve(backupFile),
        };
    } catch (error) {
        await adapter.rollback();
        throw error;
    }
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
    const { values } = parseArgs({
        args: argv,
        options: {
            mode: { type: 'string', default: 'plan' },
            'request-file': { type: 'string' },
            'store-code': { type: 'string' },
            'runtime-sha-file': { type: 'string' },
            'expected-runtime-sha': { type: 'string' },
            'expected-digest': { type: 'string' },
            'backup-file': { type: 'string' },
            'module-root': { type: 'string' },
            'project-root': { type: 'string' },
        },
    });
    assert.ok(['plan', 'apply'].includes(values.mode), 'Only plan or explicitly reviewed apply is supported');
    assert.ok(
        values['request-file'] && values['runtime-sha-file'] && values['module-root'],
        'Request file, runtime marker and runtime module root are required',
    );
    const verifyRuntime = async () => {
        const actual = (await readFile(values['runtime-sha-file'], 'utf8')).trim();
        assert.equal(actual, values['expected-runtime-sha'], 'Runtime SHA changed');
        return actual;
    };
    const input = JSON.parse(await readFile(values['request-file'], 'utf8'));
    const request = {
        runtimeSha: await verifyRuntime(),
        expectedRuntimeSha: values['expected-runtime-sha'],
        preserveChannelCode: values['store-code'],
        expectedProductNames: input.expectedProductNames,
    };
    validateRequest(request);
    const require = createRequire(
        path.join(await realpath(values['module-root']), 'packages/dev-server/package.json'),
    );
    const connection = await require('mysql2/promise').createConnection({
        host: environment.DB_HOST || '127.0.0.1',
        port: Number(environment.DB_PORT || 3306),
        user: environment.DB_USERNAME,
        password: environment.DB_PASSWORD,
        database: environment.DB_NAME,
        multipleStatements: false,
    });
    const adapter = {
        query: async (sql, args = []) => (await connection.query(sql, args))[0],
        tableExists: async table =>
            (
                await connection.query(
                    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
                    [table],
                )
            )[0].length > 0,
        columns: async table =>
            (
                await connection.query(
                    'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
                    [table],
                )
            )[0].map(row => row.name),
        begin: async () => {
            await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
            await connection.beginTransaction();
        },
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
    };
    try {
        let result;
        if (values.mode === 'apply') {
            result = await applyPlan(adapter, request, {
                expectedDigest: values['expected-digest'],
                backupFile: values['backup-file'],
                projectRoot: values['project-root'] || PROJECT_ROOT,
                verifyRuntime,
            });
        } else {
            await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
            await connection.query('SET TRANSACTION READ ONLY');
            await connection.beginTransaction();
            try {
                result = await collectPlan(adapter, request);
                await verifyRuntime();
            } finally {
                await connection.rollback();
            }
        }
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result;
    } finally {
        await connection.end();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => {
        process.stderr.write(
            'DEFAULT_CATALOG_CLEAR_FAILED: no secrets are included; inspect the reviewed plan and local test evidence.\n',
        );
        process.exitCode = 1;
    });
}
