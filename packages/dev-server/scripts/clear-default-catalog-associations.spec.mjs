import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';

import { applyPlan, collectPlan } from './clear-default-catalog-associations.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const productNames = Array.from({ length: 6 }, (_, index) => `p${index + 1}`);
const archivedProductIds = [9, 10, 11];
const archivedVariantIds = [17, 18, 19, 20];
const archivedAt = '2026-10-10T01:00:00.000Z';
const runtimeSha = 'a'.repeat(40);
const request = {
    runtimeSha,
    expectedRuntimeSha: runtimeSha,
    preserveChannelCode: 'retained-store',
    expectedProductNames: productNames,
};
const stateTables = [
    'channel',
    'product',
    'product_translation',
    'product_channels_channel',
    'product_variant',
    'product_variant_channels_channel',
    'product_variant_price',
    'stock_level',
    'catalog_resource_ownership',
    'product_sales_authorization',
    'auto_card_config',
    'auto_card_pool_item',
];
const relationTables = new Set(['product_channels_channel', 'product_variant_channels_channel']);

async function fixture(t) {
    await mkdir(path.join(projectRoot, 'backups'), { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(path.join(projectRoot, 'backups', '.clear-default-catalog-test-'));
    const backupDirectory = path.join(directory, 'backups');
    await mkdir(backupDirectory, { mode: 0o700 });
    const database = new DataSource({ type: 'sqljs', entities: [], synchronize: false, logging: false });
    const cleanupState = { runner: undefined };
    let transactionActive = false;
    t.after(async () => {
        try {
            if (cleanupState.runner) {
                if (transactionActive) await cleanupState.runner.query('ROLLBACK');
                await cleanupState.runner.release();
            }
            if (database.isInitialized) await database.destroy();
        } finally {
            // This directory is created by this test and contains only its own artifacts.
            await rm(directory, { recursive: true, force: true });
        }
    });
    await database.initialize();
    const runner = database.createQueryRunner();
    cleanupState.runner = runner;
    const rawQuery = (sql, values = []) => runner.query(sql, values);
    for (const sql of [
        'PRAGMA foreign_keys = ON',
        'CREATE TABLE channel(id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE)',
        'CREATE TABLE product(id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL, deletedAt TEXT, updatedAt TEXT NOT NULL)',
        'CREATE TABLE product_translation(id INTEGER PRIMARY KEY, baseId INTEGER REFERENCES product(id), languageCode TEXT, name TEXT)',
        'CREATE TABLE product_channels_channel(productId INTEGER REFERENCES product(id), channelId INTEGER REFERENCES channel(id), PRIMARY KEY(productId, channelId))',
        `CREATE TABLE product_variant(id INTEGER PRIMARY KEY, productId INTEGER REFERENCES product(id),
            sku TEXT, enabled INTEGER NOT NULL, deletedAt TEXT, updatedAt TEXT NOT NULL)`,
        `CREATE TABLE product_variant_channels_channel(productVariantId INTEGER REFERENCES product_variant(id),
            channelId INTEGER REFERENCES channel(id), PRIMARY KEY(productVariantId, channelId))`,
        `CREATE TABLE product_variant_price(id INTEGER PRIMARY KEY, variantId INTEGER REFERENCES product_variant(id),
            channelId INTEGER REFERENCES channel(id), currencyCode TEXT, price INTEGER)`,
        `CREATE TABLE stock_level(id INTEGER PRIMARY KEY, productVariantId INTEGER REFERENCES product_variant(id),
            stockLocationId INTEGER, stockOnHand INTEGER, stockAllocated INTEGER)`,
        `CREATE TABLE catalog_resource_ownership(id INTEGER PRIMARY KEY, resourceType TEXT, resourceId INTEGER,
            ownerChannelId INTEGER REFERENCES channel(id), scope TEXT)`,
        `CREATE TABLE product_sales_authorization(id INTEGER PRIMARY KEY, productId INTEGER REFERENCES product(id),
            channelId INTEGER REFERENCES channel(id), sourceChannelId INTEGER REFERENCES channel(id),
            state TEXT, variantIds TEXT, pendingVariantIds TEXT, version INTEGER)`,
        `CREATE TABLE auto_card_config(id INTEGER PRIMARY KEY, channelId INTEGER REFERENCES channel(id),
            productVariantId INTEGER REFERENCES product_variant(id), enabled INTEGER, instructions TEXT, fieldsJson TEXT)`,
        'CREATE TABLE auto_card_pool_item(id INTEGER PRIMARY KEY, configId INTEGER REFERENCES auto_card_config(id), encryptedPayload TEXT)',
        "INSERT INTO channel VALUES (1, '__default_channel__'), (2, 'retained-store'), (3, 'other-store')",
    ]) {
        await rawQuery(sql);
    }
    async function addVariant(variantId, productId, channelIds, deletedAt = null, allocated = 1) {
        await rawQuery('INSERT INTO product_variant VALUES (?, ?, ?, 1, ?, ?)', [
            variantId,
            productId,
            `SKU-${variantId}`,
            deletedAt,
            '2026-10-11T01:00:00.000Z',
        ]);
        await rawQuery('INSERT INTO stock_level VALUES (?, ?, 1, ?, ?)', [
            variantId,
            variantId,
            30 + variantId,
            allocated,
        ]);
        for (const channelId of channelIds) {
            await rawQuery('INSERT INTO product_variant_channels_channel VALUES (?, ?)', [
                variantId,
                channelId,
            ]);
            await rawQuery('INSERT INTO product_variant_price VALUES (?, ?, ?, ?, ?)', [
                variantId * 10 + channelId,
                variantId,
                channelId,
                channelId === 1 ? 'USD' : 'MYR',
                500 + variantId * 10 + channelId,
            ]);
        }
    }
    async function addProduct(
        id,
        name,
        channelIds,
        ownerChannelId,
        { deletedAt = null, variantIds = [(id - 1) * 2 + 1, (id - 1) * 2 + 2] } = {},
    ) {
        await rawQuery('INSERT INTO product VALUES (?, 1, ?, ?)', [
            id,
            deletedAt,
            '2026-10-11T01:00:00.000Z',
        ]);
        await rawQuery('INSERT INTO product_translation VALUES (?, ?, ?, ?)', [id, id, 'zh_Hans', name]);
        await rawQuery('INSERT INTO product_translation VALUES (?, ?, ?, ?)', [
            id + 100,
            id,
            'en',
            `${name}-en`,
        ]);
        await rawQuery('INSERT INTO catalog_resource_ownership VALUES (?, ?, ?, ?, ?)', [
            id,
            'Product',
            id,
            ownerChannelId,
            'STORE',
        ]);
        for (const channelId of channelIds) {
            await rawQuery('INSERT INTO product_channels_channel VALUES (?, ?)', [id, channelId]);
        }
        for (const [index, variantId] of variantIds.entries()) {
            await addVariant(variantId, id, channelIds, deletedAt, index + 1);
        }
    }
    for (let id = 1; id <= 6; id++) {
        await addProduct(id, `p${id}`, id === 6 ? [1, 2, 3] : [1, 2], 2);
    }
    await addProduct(7, 'retained-only', [2], 2);
    await addProduct(8, 'other-only', [3], 3);
    await addVariant(17, 1, [1, 2], archivedAt);
    await addVariant(18, 1, [1, 2], archivedAt, 2);
    await addProduct(9, 'archived-p9', [1, 2], 2, { deletedAt: archivedAt, variantIds: [19] });
    await addProduct(10, 'archived-p10', [1, 2], 2, { deletedAt: archivedAt, variantIds: [20] });
    await addProduct(11, 'archived-p11', [1, 2], 2, { deletedAt: archivedAt, variantIds: [] });
    await rawQuery('INSERT INTO catalog_resource_ownership VALUES (90, ?, 90, 3, ?)', [
        'Collection',
        'STORE',
    ]);
    await rawQuery('INSERT INTO product_sales_authorization VALUES (1, 6, 3, 2, ?, ?, NULL, 4)', [
        'ACTIVE',
        '[11,12]',
    ]);
    await rawQuery('INSERT INTO auto_card_config VALUES (1, 2, 1, 1, ?, ?)', [
        'synthetic-private-config-note',
        '{"fixture":"synthetic-private-config-fields"}',
    ]);
    await rawQuery('INSERT INTO auto_card_pool_item VALUES (1, 1, ?)', ['synthetic-private-card-payload']);

    const calls = [];
    const transactions = { begin: 0, commit: 0, rollback: 0 };
    const context = { directory, rawQuery, calls, transactions, afterTargetDelete: undefined };
    const adapter = {
        async query(sql, values = []) {
            calls.push({ sql, values });
            // SQLite cannot execute FOR UPDATE; all data queries and writes still execute in SQLjs.
            const sqliteSql = sql.replace(/\s+FOR\s+UPDATE\s*;?\s*$/iu, '');
            const result = await rawQuery(sqliteSql, values);
            if (/^\s*(?:DELETE|UPDATE|INSERT)\b/iu.test(sqliteSql)) {
                const [{ affectedRows }] = await rawQuery('SELECT changes() AS affectedRows');
                if (/^\s*DELETE\b/iu.test(sqliteSql) && context.afterTargetDelete) {
                    const hook = context.afterTargetDelete;
                    context.afterTargetDelete = undefined;
                    await hook();
                }
                return { affectedRows };
            }
            return result;
        },
        async tableExists(table) {
            return (
                (await rawQuery("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]))
                    .length > 0
            );
        },
        async columns(table) {
            assert.match(table, /^[a-z_]+$/u);
            return (await rawQuery(`PRAGMA table_info(\`${table}\`)`)).map(column => column.name);
        },
        async begin() {
            assert.equal(transactionActive, false);
            await rawQuery('BEGIN TRANSACTION');
            transactionActive = true;
            transactions.begin++;
        },
        async commit() {
            await rawQuery('COMMIT');
            transactionActive = false;
            transactions.commit++;
        },
        async rollback() {
            await rawQuery('ROLLBACK');
            transactionActive = false;
            transactions.rollback++;
        },
    };
    async function snapshot() {
        const result = {};
        for (const table of stateTables) {
            if (await adapter.tableExists(table))
                result[table] = await rawQuery(`SELECT * FROM \`${table}\` ORDER BY 1, 2`);
        }
        return result;
    }
    return Object.assign(context, {
        adapter,
        snapshot,
        backupFile: path.join(backupDirectory, 'backup.json'),
    });
}

function applyOptions(context, plan, extra = {}) {
    return {
        projectRoot: context.directory,
        backupFile: context.backupFile,
        expectedDigest: plan.digest,
        ...extra,
    };
}

function defaultAssociationCounts(state) {
    const activeProducts = new Set(state.product.filter(row => row.deletedAt == null).map(row => row.id));
    const activeVariants = new Set(
        state.product_variant.filter(row => row.deletedAt == null).map(row => row.id),
    );
    const products = state.product_channels_channel.filter(row => row.channelId === 1);
    const variants = state.product_variant_channels_channel.filter(row => row.channelId === 1);
    return {
        products: {
            active: products.filter(row => activeProducts.has(row.productId)).length,
            raw: products.length,
        },
        variants: {
            active: variants.filter(row => activeVariants.has(row.productVariantId)).length,
            raw: variants.length,
        },
    };
}

async function assertRejectedPlan(context, input = request, expectedError) {
    const before = await context.snapshot();
    await assert.rejects(collectPlan(context.adapter, input), expectedError);
    assert.deepEqual(await context.snapshot(), before);
    assert.equal(
        context.calls.some(call => /^\s*(?:DELETE|UPDATE|INSERT)\b/iu.test(call.sql)),
        false,
    );
}

test('plan matches all six default products and performs only real read queries', async t => {
    const context = await fixture(t);
    const before = await context.snapshot();
    const plan = await collectPlan(context.adapter, request);
    assert.match(plan.digest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(plan.items.map(item => item.name).sort(), productNames);
    assert.equal(plan.items.length, 6);
    assert.ok(plan.items.every(item => item.variantIds.length === 2));
    assert.equal(plan.rawDefaultProductCount, 9);
    assert.equal(plan.rawDefaultVariantCount, 16);
    assert.equal(plan.productRelations.length, 6);
    assert.equal(plan.variantRelations.length, 12);
    assert.deepEqual(await context.snapshot(), before);
    assert.deepEqual(context.transactions, { begin: 0, commit: 0, rollback: 0 });
    assert.ok(context.calls.length > 0);
    assert.ok(context.calls.every(call => /^\s*SELECT\b/iu.test(call.sql)));
    assert.equal(
        context.calls.some(call => /encryptedPayload|instructions|fieldsJson/iu.test(call.sql)),
        false,
    );
});

test('rejects a request without exactly the full six-name scope', async t => {
    const context = await fixture(t);
    await assertRejectedPlan(context, { ...request, expectedProductNames: productNames.slice(0, 5) });
    await assertRejectedPlan(context, {
        ...request,
        expectedProductNames: [...productNames.slice(0, 5), 'unexpected'],
    });
    await assertRejectedPlan(context, {
        ...request,
        expectedProductNames: [...productNames, 'retained-only'],
    });
});

test('rejects duplicate expected names and duplicate matching database names', async t => {
    const context = await fixture(t);
    await assertRejectedPlan(context, {
        ...request,
        expectedProductNames: [...productNames.slice(0, 5), 'p1'],
    });
    await context.rawQuery('UPDATE product_translation SET name = ? WHERE baseId = ? AND languageCode = ?', [
        'p1',
        6,
        'zh_Hans',
    ]);
    await assertRejectedPlan(context);
});

test('rejects a missing product association with the retained store', async t => {
    const context = await fixture(t);
    await context.rawQuery('DELETE FROM product_channels_channel WHERE productId = 6 AND channelId = 2');
    await assertRejectedPlan(context);
});

test('rejects a variant missing from the retained store before any mutation', async t => {
    const context = await fixture(t);
    await context.rawQuery(
        'DELETE FROM product_variant_channels_channel WHERE productVariantId = 12 AND channelId = 2',
    );
    await assertRejectedPlan(context);
});

test('rejects a retained variant without a retained-channel price', async t => {
    const context = await fixture(t);
    await context.rawQuery('DELETE FROM product_variant_price WHERE variantId = 12 AND channelId = 2');
    await assertRejectedPlan(context);
});

test('rejects an owner belonging to a different store', async t => {
    const context = await fixture(t);
    await context.rawQuery(
        "UPDATE catalog_resource_ownership SET ownerChannelId = 3 WHERE resourceType = 'Product' AND resourceId = 6",
    );
    await assertRejectedPlan(context);
});

test('rejects missing ownership evidence and a non-STORE ownership scope', async t => {
    const context = await fixture(t);
    await context.rawQuery(
        "UPDATE catalog_resource_ownership SET scope = 'PLATFORM_TEMPLATE' WHERE resourceType = 'Product' AND resourceId = 6",
    );
    await assertRejectedPlan(context);
    await context.rawQuery(
        "DELETE FROM catalog_resource_ownership WHERE resourceType = 'Product' AND resourceId = 6",
    );
    await assertRejectedPlan(context);
});

test('rejects runtime SHA mismatch in a read-only plan', async t => {
    const context = await fixture(t);
    await assertRejectedPlan(context, { ...request, runtimeSha: 'b'.repeat(40) });
});

test('rejects an unreviewed digest without modifying database rows', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    const before = await context.snapshot();
    await assert.rejects(
        applyPlan(context.adapter, request, applyOptions(context, plan, { expectedDigest: '0'.repeat(64) })),
    );
    assert.deepEqual(await context.snapshot(), before);
    assert.equal(context.transactions.commit, 0);
    assert.equal(
        context.calls.some(call => /^\s*DELETE\b/iu.test(call.sql)),
        false,
    );
});

test('rejects runtime drift at the second check, after backup but before any DELETE', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    const before = await context.snapshot();
    let runtimeChecks = 0;
    let backupReady = false;
    await assert.rejects(
        applyPlan(
            context.adapter,
            request,
            applyOptions(context, plan, {
                beforeWrite: async () => {
                    backupReady = (await stat(context.backupFile)).isFile();
                },
                verifyRuntime: async () => {
                    runtimeChecks++;
                    if (runtimeChecks === 2) throw new Error('runtime changed before writing');
                    return runtimeSha;
                },
            }),
        ),
        /runtime changed before writing/u,
    );
    assert.equal(runtimeChecks, 2);
    assert.equal(backupReady, true);
    assert.deepEqual(await context.snapshot(), before);
    assert.deepEqual(context.transactions, { begin: 1, commit: 0, rollback: 1 });
    assert.equal(
        context.calls.some(call => /^\s*DELETE\b/iu.test(call.sql)),
        false,
    );
});

test('rejects runtime drift at the third check and rolls back both executed relation DELETEs', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    const before = await context.snapshot();
    let runtimeChecks = 0;
    let observedBothDeletes = false;
    await assert.rejects(
        applyPlan(
            context.adapter,
            request,
            applyOptions(context, plan, {
                verifyRuntime: async () => {
                    runtimeChecks++;
                    if (runtimeChecks === 3) {
                        const pending = await context.snapshot();
                        assert.deepEqual(defaultAssociationCounts(pending), {
                            products: { active: 0, raw: 3 },
                            variants: { active: 0, raw: 4 },
                        });
                        assert.equal(context.calls.filter(call => /^\s*DELETE\b/iu.test(call.sql)).length, 2);
                        observedBothDeletes = true;
                        throw new Error('runtime changed before commit');
                    }
                    return runtimeSha;
                },
            }),
        ),
        /runtime changed before commit/u,
    );
    assert.equal(runtimeChecks, 3);
    assert.equal(observedBothDeletes, true);
    assert.deepEqual(await context.snapshot(), before);
    assert.deepEqual(context.transactions, { begin: 1, commit: 0, rollback: 1 });
});

test('rejects real stock changes between preview and apply without deleting relations or reverting the new stock', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    await context.rawQuery(
        'UPDATE stock_level SET stockAllocated = stockAllocated + 2 WHERE productVariantId = 1',
    );
    const changed = await context.snapshot();
    await assert.rejects(
        applyPlan(context.adapter, request, applyOptions(context, plan)),
        /Data drift after preview/u,
    );
    assert.deepEqual(await context.snapshot(), changed);
    assert.equal(
        context.calls.some(call => /^\s*DELETE\b/iu.test(call.sql)),
        false,
    );
    assert.deepEqual(context.transactions, { begin: 1, commit: 0, rollback: 1 });
    await assert.rejects(stat(context.backupFile), { code: 'ENOENT' });
});

test('requires the core stock table for both preview and apply', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    await context.rawQuery('DROP TABLE stock_level');
    await assertRejectedPlan(context, request, /Core stock-level table is required/u);
    const before = await context.snapshot();
    await assert.rejects(
        applyPlan(context.adapter, request, applyOptions(context, plan)),
        /Core stock-level table is required/u,
    );
    assert.deepEqual(await context.snapshot(), before);
    assert.equal(
        context.calls.some(call => /^\s*DELETE\b/iu.test(call.sql)),
        false,
    );
    assert.deepEqual(context.transactions, { begin: 1, commit: 0, rollback: 1 });
});

test('rejects missing required projection columns instead of silently omitting protected data', async t => {
    for (const [table, column] of [
        ['product', 'updatedAt'],
        ['product_variant', 'updatedAt'],
        ['product_variant_price', 'currencyCode'],
        ['stock_level', 'stockAllocated'],
        ['catalog_resource_ownership', 'ownerChannelId'],
    ]) {
        const context = await fixture(t);
        const plan = await collectPlan(context.adapter, request);
        await context.rawQuery(`ALTER TABLE \`${table}\` RENAME COLUMN \`${column}\` TO unavailableColumn`);
        const projectionError = new RegExp(`Required ${table} projection columns are missing`, 'u');
        await assertRejectedPlan(context, request, projectionError);
        const before = await context.snapshot();
        await assert.rejects(
            applyPlan(context.adapter, request, applyOptions(context, plan)),
            projectionError,
        );
        assert.deepEqual(await context.snapshot(), before);
        assert.equal(
            context.calls.some(call => /^\s*DELETE\b/iu.test(call.sql)),
            false,
        );
        assert.deepEqual(context.transactions, { begin: 1, commit: 0, rollback: 1 });
    }
});

test('apply removes only active default Product and Variant relations, preserving entities and all operating data', async t => {
    const context = await fixture(t);
    const before = await context.snapshot();
    const plan = await collectPlan(context.adapter, request);
    const receipt = await applyPlan(context.adapter, request, applyOptions(context, plan));
    const after = await context.snapshot();
    for (const table of stateTables.filter(candidate => !relationTables.has(candidate))) {
        assert.deepEqual(after[table], before[table], `${table} must remain unchanged`);
    }
    assert.deepEqual(
        after.product_channels_channel,
        before.product_channels_channel.filter(
            row => row.channelId !== 1 || archivedProductIds.includes(row.productId),
        ),
    );
    assert.deepEqual(
        after.product_variant_channels_channel,
        before.product_variant_channels_channel.filter(
            row => row.channelId !== 1 || archivedVariantIds.includes(row.productVariantId),
        ),
    );
    assert.equal(after.product_channels_channel.filter(row => row.channelId === 2).length, 10);
    assert.equal(after.product_variant_price.filter(row => row.channelId === 1).length, 16);
    assert.equal(after.product_variant_channels_channel.filter(row => row.channelId === 3).length, 4);
    assert.deepEqual(defaultAssociationCounts(after), {
        products: { active: 0, raw: 3 },
        variants: { active: 0, raw: 4 },
    });
    assert.equal(receipt.removedProducts, 6);
    assert.equal(receipt.removedVariants, 12);
    assert.equal(receipt.activeDefaultProductCount, 0);
    assert.equal(receipt.activeDefaultVariantCount, 0);
    assert.equal(receipt.rawDefaultProductCount, 3);
    assert.equal(receipt.rawDefaultVariantCount, 4);
    assert.deepEqual(context.transactions, { begin: 1, commit: 1, rollback: 0 });
    const deletes = context.calls.filter(call => /^\s*DELETE\b/iu.test(call.sql));
    assert.ok(deletes.length > 0);
    assert.ok(
        deletes.every(call =>
            /^\s*DELETE\s+FROM\s+[`"]?(?:product_channels_channel|product_variant_channels_channel)[`"]?\b/iu.test(
                call.sql,
            ),
        ),
    );
});

test('preserves historical default associations for archived products and archived variants of an active product', async t => {
    const context = await fixture(t);
    const before = await context.snapshot();
    const plan = await collectPlan(context.adapter, request);
    assert.deepEqual(
        plan.items.map(item => Number(item.id)),
        [1, 2, 3, 4, 5, 6],
    );
    assert.deepEqual(plan.items.find(item => item.id === '1').variantIds, ['1', '2']);
    assert.match(plan.protectedDigests.archivedDefaultProductMemberships, /^[a-f0-9]{64}$/u);
    assert.match(plan.protectedDigests.archivedDefaultVariantMemberships, /^[a-f0-9]{64}$/u);
    await applyPlan(context.adapter, request, applyOptions(context, plan));
    const after = await context.snapshot();
    assert.equal(after.product.find(row => row.id === 1).deletedAt, null);
    assert.deepEqual(
        after.product_channels_channel.filter(row => archivedProductIds.includes(row.productId)),
        before.product_channels_channel.filter(row => archivedProductIds.includes(row.productId)),
    );
    for (const [table, key] of [
        ['product_variant', 'id'],
        ['product_variant_channels_channel', 'productVariantId'],
        ['product_variant_price', 'variantId'],
        ['stock_level', 'productVariantId'],
    ]) {
        assert.deepEqual(
            after[table].filter(row => archivedVariantIds.includes(row[key])),
            before[table].filter(row => archivedVariantIds.includes(row[key])),
            `${table} historical rows must remain unchanged`,
        );
    }
    assert.deepEqual(
        after.product.filter(row => archivedProductIds.includes(row.id)),
        before.product.filter(row => archivedProductIds.includes(row.id)),
    );
});

test('writes a private project backup before the first DELETE and excludes sensitive payloads and operating values', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    const before = await context.snapshot();
    let checked = false;
    await applyPlan(
        context.adapter,
        request,
        applyOptions(context, plan, {
            beforeWrite: async () => {
                const metadata = await stat(context.backupFile);
                assert.equal(metadata.mode.toString(8).slice(-3), '600');
                assert.equal(metadata.isFile(), true);
                assert.ok(context.backupFile.startsWith(path.join(projectRoot, 'backups') + path.sep));
                const content = await readFile(context.backupFile, 'utf8');
                const backup = JSON.parse(content);
                assert.equal(backup.productRelations.length, 6);
                assert.equal(backup.variantRelations.length, 12);
                assert.ok(
                    backup.productRelations.every(row => !archivedProductIds.includes(Number(row.productId))),
                );
                assert.ok(
                    backup.variantRelations.every(
                        row => !archivedVariantIds.includes(Number(row.productVariantId)),
                    ),
                );
                assert.ok(content.includes(plan.digest));
                assert.doesNotMatch(content, /synthetic-private-/u);
                assert.doesNotMatch(
                    content,
                    /"(?:encryptedPayload|instructions|fieldsJson|price|stockOnHand|stockAllocated|password|token)"\s*:/iu,
                );
                assert.deepEqual(await context.snapshot(), before);
                assert.equal(
                    context.calls.some(call => /^\s*DELETE\b/iu.test(call.sql)),
                    false,
                );
                checked = true;
            },
        }),
    );
    assert.equal(checked, true);
});

test('rejects missing backup path, paths outside the selected project backups, and existing backup files', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    const before = await context.snapshot();
    await assert.rejects(
        applyPlan(context.adapter, request, applyOptions(context, plan, { backupFile: undefined })),
    );
    // Even an incorrectly accepted path stays in this test's owned project directory.
    await assert.rejects(
        applyPlan(
            context.adapter,
            request,
            applyOptions(context, plan, { backupFile: path.join(context.directory, 'outside-backups.json') }),
        ),
    );
    await writeFile(context.backupFile, 'keep existing review', { mode: 0o600 });
    await assert.rejects(applyPlan(context.adapter, request, applyOptions(context, plan)));
    assert.equal(await readFile(context.backupFile, 'utf8'), 'keep existing review');
    assert.deepEqual(await context.snapshot(), before);
    assert.equal(context.transactions.commit, 0);
    assert.equal(
        context.calls.some(call => /^\s*DELETE\b/iu.test(call.sql)),
        false,
    );
});

test('detects real protected-row drift after a DELETE and rolls the entire transaction back', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    const before = await context.snapshot();
    let injected = false;
    context.afterTargetDelete = async () => {
        await context.rawQuery(
            'UPDATE stock_level SET stockOnHand = stockOnHand + 7 WHERE productVariantId = 1',
        );
        injected = true;
    };
    await assert.rejects(applyPlan(context.adapter, request, applyOptions(context, plan)));
    assert.equal(injected, true);
    assert.deepEqual(await context.snapshot(), before);
    assert.deepEqual(context.transactions, { begin: 1, commit: 0, rollback: 1 });
});

test('rolls back native relation removal if a protected digital-delivery field changes during the transaction', async t => {
    const context = await fixture(t);
    await context.rawQuery('ALTER TABLE product_variant ADD COLUMN customFieldsDigitaldeliverymode TEXT');
    await context.rawQuery("UPDATE product_variant SET customFieldsDigitaldeliverymode = 'AUTO_CARD'");
    const plan = await collectPlan(context.adapter, request);
    const before = await context.snapshot();
    let injected = false;
    context.afterTargetDelete = async () => {
        await context.rawQuery(
            "UPDATE product_variant SET customFieldsDigitaldeliverymode = 'MANUAL' WHERE id = 1",
        );
        injected = true;
    };
    await assert.rejects(
        applyPlan(context.adapter, request, applyOptions(context, plan)),
        /Protected store data changed; cleanup rolled back/u,
    );
    assert.equal(injected, true);
    assert.deepEqual(await context.snapshot(), before);
    assert.deepEqual(context.transactions, { begin: 1, commit: 0, rollback: 1 });
});

test('rejects applying the same reviewed digest again after default relations have changed', async t => {
    const context = await fixture(t);
    const plan = await collectPlan(context.adapter, request);
    await applyPlan(context.adapter, request, applyOptions(context, plan));
    const after = await context.snapshot();
    await assert.rejects(
        applyPlan(
            context.adapter,
            request,
            applyOptions(context, plan, {
                backupFile: path.join(context.directory, 'backups', 'second-backup.json'),
            }),
        ),
    );
    assert.deepEqual(await context.snapshot(), after);
    assert.equal(context.transactions.commit, 1);
});

test('supports missing optional protected tables while preserving the required ownership evidence', async t => {
    const context = await fixture(t);
    await context.rawQuery('DROP TABLE auto_card_pool_item');
    await context.rawQuery('DROP TABLE auto_card_config');
    await context.rawQuery('DROP TABLE product_sales_authorization');
    const before = await context.snapshot();
    const plan = await collectPlan(context.adapter, request);
    await applyPlan(context.adapter, request, applyOptions(context, plan));
    const after = await context.snapshot();
    for (const table of Object.keys(before).filter(candidate => !relationTables.has(candidate))) {
        assert.deepEqual(after[table], before[table]);
    }
    assert.deepEqual(defaultAssociationCounts(after), {
        products: { active: 0, raw: 3 },
        variants: { active: 0, raw: 4 },
    });
});
