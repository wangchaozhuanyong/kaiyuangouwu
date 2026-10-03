import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { collectPlatformCatalogDataPlan } from './platform-catalog-data-plan.mjs';
import { buildGovernanceReconciliationPlan } from './platform-governance-reconciliation-plan.mjs';
import { collectPlatformPaymentDataPlan } from './platform-payment-data-plan.mjs';

const definitions = {
    Product: ['product', 'product_channels_channel', 'productId'],
    Collection: ['collection', 'collection_channels_channel', 'collectionId'],
    ProductOptionGroup: [
        'product_option_group',
        'product_option_group_channels_channel',
        'productOptionGroupId',
    ],
    ProductOption: ['product_option', 'product_option_channels_channel', 'productOptionId'],
    Facet: ['facet', 'facet_channels_channel', 'facetId'],
    FacetValue: ['facet_value', 'facet_value_channels_channel', 'facetValueId'],
    Asset: ['asset', 'asset_channels_channel', 'assetId'],
    Tag: ['tag', null, null],
};
const canonical = value =>
    value instanceof Date
        ? value.toJSON()
        : Array.isArray(value)
          ? value.map(canonical)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                  Object.keys(value)
                      .sort()
                      .map(key => [key, canonical(value[key])]),
              )
            : value;
const stable = value => JSON.stringify(canonical(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const quote = value => {
    assert.match(value, /^[a-zA-Z][a-zA-Z0-9_]*$/u);
    return `\`${value}\``;
};
const identity = (type, id, channel) => `${type}:${id}:${channel}`;

export function governanceMysqlAdapter(connection) {
    return {
        kind: 'mysql',
        query: async (sql, args = []) => (await connection.query(sql, args))[0],
        tableExists: async table =>
            (
                await connection.query(
                    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
                    [table],
                )
            )[0].length > 0,
        columnExists: async (table, column) =>
            (
                await connection.query(
                    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
                    [table, column],
                )
            )[0].length > 0,
    };
}
export async function collectReconciliationPlan(connection) {
    const adapter = governanceMysqlAdapter(connection);
    return buildGovernanceReconciliationPlan({
        catalog: await collectPlatformCatalogDataPlan(adapter),
        payment: await collectPlatformPaymentDataPlan(adapter),
    });
}

async function cloneRow(connection, table, sourceId, changes = {}) {
    const [rows] = await connection.query(`SELECT * FROM ${quote(table)} WHERE id = ?`, [sourceId]);
    assert.equal(rows.length, 1, 'SOURCE_ROW_MISSING');
    const source = rows[0];
    const columns = Object.keys(source).filter(column => !['id', 'createdAt', 'updatedAt'].includes(column));
    assert.ok(
        Object.keys(changes).every(column => columns.includes(column)),
        'CLONE_COLUMN_MISSING',
    );
    const [insert] = await connection.query(
        `INSERT INTO ${quote(table)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        columns.map(column => changes[column] ?? source[column]),
    );
    const targetId = String(insert.insertId);
    const translation = `${table}_translation`;
    if (await governanceMysqlAdapter(connection).tableExists(translation)) {
        const [translations] = await connection.query(
            `SELECT * FROM ${quote(translation)} WHERE baseId = ? ORDER BY id`,
            [sourceId],
        );
        for (const row of translations) {
            const fields = Object.keys(row).filter(
                column => !['id', 'createdAt', 'updatedAt'].includes(column),
            );
            await connection.query(
                `INSERT INTO ${quote(translation)} (${fields.map(quote).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
                fields.map(column => (column === 'baseId' ? targetId : row[column])),
            );
        }
    }
    return targetId;
}

async function registerOwner(connection, type, id, owner) {
    const [existing] = await connection.query(
        'SELECT ownerChannelId, scope FROM catalog_resource_ownership WHERE resourceType = ? AND resourceId = ?',
        [type, id],
    );
    if (existing.length)
        assert.ok(
            String(existing[0].ownerChannelId) === owner && existing[0].scope === 'STORE',
            'OWNERSHIP_DRIFT',
        );
    else
        await connection.query(
            "INSERT INTO catalog_resource_ownership (resourceType,resourceId,ownerChannelId,scope) VALUES (?,?,?,'STORE')",
            [type, id, owner],
        );
    if (type === 'Tag') await connection.query('UPDATE tag SET ownerChannelId = ? WHERE id = ?', [owner, id]);
}

async function readReceipt(connection, key, platformId) {
    const [rows] = await connection.query(
        'SELECT payloadJson, payloadHash FROM governance_audit_entry WHERE channelId = ? AND idempotencyKey = ?',
        [platformId, key],
    );
    if (!rows.length) return null;
    assert.equal(sha(rows[0].payloadJson), rows[0].payloadHash, 'RECEIPT_CORRUPTED');
    const payload = JSON.parse(rows[0].payloadJson);
    assert.equal(payload.schema, 'vendure-platform-data-receipt-v1');
    const bytes = gunzipSync(Buffer.from(payload.reportGzipBase64, 'base64'), {
        maxOutputLength: 1024 * 1024,
    });
    assert.equal(sha(bytes), payload.reportSha256, 'RECEIPT_CORRUPTED');
    return JSON.parse(bytes.toString());
}
async function appendReceipt(connection, plan, report, key) {
    const payloadJson = stable({
        schema: 'vendure-platform-data-receipt-v1',
        reportSha256: sha(JSON.stringify(report)),
        reportGzipBase64: gzipSync(Buffer.from(JSON.stringify(report))).toString('base64'),
    });
    assert.ok(Buffer.byteLength(payloadJson) <= 60000, 'RECEIPT_TOO_LARGE');
    const [previous] = await connection.query(
        'SELECT sequence, entryHash FROM governance_audit_entry WHERE channelId = ? ORDER BY sequence DESC LIMIT 1 FOR UPDATE',
        [plan.platformChannelId],
    );
    const normalized = {
        channelId: plan.platformChannelId,
        sequence: Number(previous[0]?.sequence ?? 0) + 1,
        eventType: 'PLATFORM_DATA_RECONCILIATION',
        resourceType: 'PlatformGovernance',
        resourceId: plan.planSha256,
        actorType: 'SYSTEM',
        actorUserId: null,
        actorLabel: 'Reviewed production deployment',
        reason: `Separately approved manifest ${plan.planSha256}; backup verified and writers stopped`,
        payloadHash: sha(payloadJson),
        previousHash: previous[0]?.entryHash ?? null,
    };
    const values = { ...normalized, payloadJson, entryHash: sha(stable(normalized)), idempotencyKey: key };
    await connection.query(
        `INSERT INTO governance_audit_entry (${Object.keys(values).map(quote).join(',')}) VALUES (${Object.keys(
            values,
        )
            .map(() => '?')
            .join(',')})`,
        Object.values(values),
    );
}

/** One transaction; only ID-based, fixed catalog relationships may change. Payment and order history are never written. */
export async function applyReconciliation(connection, expectedSha, { phase = () => Promise.resolve() } = {}) {
    assert.match(expectedSha, /^[a-f0-9]{64}$/u, 'EXACT_REVIEWED_PLAN_REQUIRED');
    const key = `platform-data:${expectedSha}`;
    await connection.beginTransaction();
    try {
        const [channels] = await connection.query('SELECT id,code FROM channel ORDER BY id FOR UPDATE');
        const platform = channels.find(channel => channel.code === '__default_channel__');
        assert.ok(platform, 'DEFAULT_CHANNEL_MISSING');
        const prior = await readReceipt(connection, key, platform.id);
        if (prior) {
            await connection.rollback();
            return { ...prior, status: 'ALREADY_APPLIED' };
        }
        for (const [table] of Object.values(definitions))
            await connection.query(`SELECT id FROM ${quote(table)} ORDER BY id FOR UPDATE`);
        await connection.query('SELECT id FROM payment_method ORDER BY id FOR UPDATE');
        const plan = await collectReconciliationPlan(connection);
        assert.equal(plan.planSha256, expectedSha, 'PLAN_CHANGED_REPREVIEW_REQUIRED');
        assert.equal(plan.blockers.length, 0, 'MANIFEST_HAS_BLOCKERS');
        const adapter = governanceMysqlAdapter(connection);
        for (const table of ['catalog_resource_ownership', 'store_payment_method_state'])
            assert.ok(await adapter.tableExists(table), 'SCHEMA_MIGRATION_REQUIRED');
        const protectedTables = ['payment', 'storefront_usdt_payment_intent'];
        const protectedState = {};
        for (const table of protectedTables)
            if (await adapter.tableExists(table)) {
                const [rows] = await connection.query(`SELECT * FROM ${quote(table)} ORDER BY id`);
                protectedState[table] = sha(stable(rows));
            }
        const mapping = new Map();
        const resources = [];
        const mapped = (type, id, channel) => mapping.get(identity(type, id, channel)) ?? String(id);
        const [groups] = await connection.query('SELECT id, groupId FROM product_option');
        const [facets] = await connection.query('SELECT id, facetId FROM facet_value');
        for (const operation of plan.resources) {
            const [table, relation, column] = definitions[operation.resourceType];
            assert.ok(table, 'UNKNOWN_RESOURCE_TYPE');
            for (const owner of operation.targets) {
                const changes = {};
                if (operation.codePolicy === 'APPEND_STORE_SUFFIX') {
                    const [source] = await connection.query('SELECT code FROM facet WHERE id = ?', [
                        operation.resourceId,
                    ]);
                    changes.code = `${source[0].code}-store-${owner}`;
                }
                if (operation.resourceType === 'ProductOption')
                    changes.groupId = mapped(
                        'ProductOptionGroup',
                        groups.find(row => String(row.id) === operation.resourceId)?.groupId,
                        owner,
                    );
                if (operation.resourceType === 'FacetValue')
                    changes.facetId = mapped(
                        'Facet',
                        facets.find(row => String(row.id) === operation.resourceId)?.facetId,
                        owner,
                    );
                const targetId =
                    operation.kind === 'REGISTER_OWNER'
                        ? operation.resourceId
                        : await cloneRow(connection, table, operation.resourceId, changes);
                mapping.set(identity(operation.resourceType, operation.resourceId, owner), targetId);
                if (operation.kind === 'REGISTER_OWNER')
                    for (const [field, value] of Object.entries(changes))
                        await connection.query(
                            `UPDATE ${quote(table)} SET ${quote(field)} = ? WHERE id = ?`,
                            [value, targetId],
                        );
                await registerOwner(connection, operation.resourceType, targetId, owner);
                if (operation.kind !== 'REGISTER_OWNER' && relation)
                    for (const channel of [plan.platformChannelId, owner])
                        await connection.query(
                            `INSERT INTO ${quote(relation)} (${quote(column)}, channelId) VALUES (?,?)`,
                            [targetId, channel],
                        );
                resources.push({
                    resourceType: operation.resourceType,
                    sourceId: operation.resourceId,
                    targetId,
                    ownerChannelId: owner,
                });
            }
            if (operation.kind !== 'REGISTER_OWNER')
                await registerOwner(
                    connection,
                    operation.resourceType,
                    operation.resourceId,
                    plan.platformChannelId,
                );
        }
        await phase('resources');
        const [productOwners] = await connection.query(
            "SELECT resourceId, ownerChannelId FROM catalog_resource_ownership WHERE resourceType = 'Product' AND scope = 'STORE'",
        );
        const [collectionOwners] = await connection.query(
            "SELECT resourceId, ownerChannelId FROM catalog_resource_ownership WHERE resourceType = 'Collection' AND scope = 'STORE'",
        );
        const ownProduct = id =>
            String(productOwners.find(row => String(row.resourceId) === String(id))?.ownerChannelId ?? '');
        const ownCollection = id =>
            String(collectionOwners.find(row => String(row.resourceId) === String(id))?.ownerChannelId ?? '');
        const [variants] = await connection.query('SELECT id, productId FROM product_variant');
        const ownVariant = id => ownProduct(variants.find(row => String(row.id) === String(id))?.productId);
        const remapJunction = async (table, left, right, type, ownerFor) => {
            const [rows] = await connection.query(
                `SELECT ${quote(left)}, ${quote(right)} FROM ${quote(table)}`,
            );
            for (const row of rows) {
                const target = mapped(type, row[right], ownerFor(row[left]));
                if (target !== String(row[right])) {
                    await connection.query(
                        `UPDATE ${quote(table)} SET ${quote(right)} = ? WHERE ${quote(left)} = ? AND ${quote(right)} = ?`,
                        [target, row[left], row[right]],
                    );
                    const [saved] = await connection.query(
                        `SELECT ${quote(right)} FROM ${quote(table)} WHERE ${quote(left)} = ? AND ${quote(right)} = ?`,
                        [row[left], target],
                    );
                    assert.equal(saved.length, 1, 'REFERENCE_READBACK_FAILED');
                }
            }
        };
        await remapJunction(
            'product_option_groups_product_option_group',
            'productId',
            'productOptionGroupId',
            'ProductOptionGroup',
            ownProduct,
        );
        await remapJunction(
            'product_variant_options_product_option',
            'productVariantId',
            'productOptionId',
            'ProductOption',
            ownVariant,
        );
        await remapJunction(
            'product_facet_values_facet_value',
            'productId',
            'facetValueId',
            'FacetValue',
            ownProduct,
        );
        await remapJunction(
            'product_variant_facet_values_facet_value',
            'productVariantId',
            'facetValueId',
            'FacetValue',
            ownVariant,
        );
        const remapColumn = async (table, field, type, ownerFor) => {
            if (!(await adapter.columnExists(table, field))) return;
            const [rows] = await connection.query(
                `SELECT * FROM ${quote(table)} WHERE ${quote(field)} IS NOT NULL`,
            );
            for (const row of rows) {
                const target = mapped(type, row[field], ownerFor(row));
                if (target !== String(row[field])) {
                    await connection.query(
                        `UPDATE ${quote(table)} SET ${quote(field)} = ? WHERE id = ? AND ${quote(field)} = ?`,
                        [target, row.id, row[field]],
                    );
                    const [saved] = await connection.query(
                        `SELECT ${quote(field)} FROM ${quote(table)} WHERE id = ?`,
                        [row.id],
                    );
                    assert.equal(String(saved[0]?.[field]), target, 'REFERENCE_READBACK_FAILED');
                }
            }
        };
        await remapColumn('product_asset', 'assetId', 'Asset', row => ownProduct(row.productId));
        await remapColumn('product_variant_asset', 'assetId', 'Asset', row =>
            ownVariant(row.productVariantId),
        );
        await remapColumn('product', 'featuredAssetId', 'Asset', row => ownProduct(row.id));
        await remapColumn('product_variant', 'featuredAssetId', 'Asset', row => ownVariant(row.id));
        await remapColumn('collection', 'featuredAssetId', 'Asset', row => ownCollection(row.id));
        for (const field of ['logoAssetId', 'logoOnLightAssetId', 'logoOnDarkAssetId'])
            await remapColumn('store_profile', field, 'Asset', row => String(row.channelId));
        await remapColumn('storefront_content_block', 'imageAssetId', 'Asset', row => String(row.channelId));
        const [blocks] = await connection.query('SELECT id, channelId FROM storefront_content_block');
        await remapColumn('storefront_content_item', 'imageAssetId', 'Asset', row =>
            String(blocks.find(block => String(block.id) === String(row.blockId))?.channelId ?? ''),
        );
        const [collections] = await connection.query('SELECT id, filters FROM collection');
        for (const row of collections) {
            const filters = typeof row.filters === 'string' ? JSON.parse(row.filters) : row.filters;
            let changed = false;
            for (const filter of filters ?? [])
                if (filter.code === 'facet-value-filter')
                    for (const arg of filter.args ?? [])
                        if (arg.name === 'facetValueIds') {
                            const values = JSON.parse(arg.value);
                            const targets = values.map(id => mapped('FacetValue', id, ownCollection(row.id)));
                            if (targets.some((id, i) => id !== String(values[i]))) {
                                arg.value = JSON.stringify(targets);
                                changed = true;
                            }
                        }
            if (changed)
                await connection.query('UPDATE collection SET filters = ? WHERE id = ?', [
                    JSON.stringify(filters),
                    row.id,
                ]);
        }
        const [assetTags] = await connection.query('SELECT assetId, tagId FROM asset_tags_tag');
        for (const row of assetTags) {
            const assets = resources.filter(
                item => item.resourceType === 'Asset' && item.sourceId === String(row.assetId),
            );
            for (const asset of assets) {
                const tag = mapped('Tag', row.tagId, asset.ownerChannelId);
                if (asset.targetId !== String(row.assetId))
                    await connection.query('INSERT INTO asset_tags_tag (assetId,tagId) VALUES (?,?)', [
                        asset.targetId,
                        tag,
                    ]);
                else if (tag !== String(row.tagId))
                    await connection.query(
                        'UPDATE asset_tags_tag SET tagId = ? WHERE assetId = ? AND tagId = ?',
                        [tag, row.assetId, row.tagId],
                    );
            }
        }
        await phase('references');
        let globalTestId;
        for (const operation of plan.paymentOperations) {
            if (operation.kind === 'COPY_GLOBAL_TEST_POLICY') {
                const [source] = await connection.query('SELECT handler FROM payment_method WHERE id = ?', [
                    operation.sourceMethodId,
                ]);
                const handler =
                    typeof source[0].handler === 'string' ? JSON.parse(source[0].handler) : source[0].handler;
                const args = handler.args ?? [];
                const channel = args.find(arg => arg.name === 'channelId');
                assert.ok(channel, 'TEST_POLICY_CHANNEL_MISSING');
                channel.value = JSON.stringify(plan.platformChannelId);
                globalTestId = await cloneRow(connection, 'payment_method', operation.sourceMethodId, {
                    code: operation.code,
                    handler: JSON.stringify(handler),
                });
                await connection.query(
                    'INSERT INTO payment_method_channels_channel (paymentMethodId,channelId) VALUES (?,?)',
                    [globalTestId, plan.platformChannelId],
                );
            } else if (operation.kind === 'ADD_PLATFORM_LINK')
                await connection.query(
                    'INSERT INTO payment_method_channels_channel (paymentMethodId,channelId) VALUES (?,?)',
                    [operation.methodId, plan.platformChannelId],
                );
            else if (operation.kind === 'REMOVE_LEGACY_PLATFORM_LINK')
                await connection.query(
                    'DELETE FROM payment_method_channels_channel WHERE paymentMethodId = ? AND channelId = ?',
                    [operation.methodId, plan.platformChannelId],
                );
            else throw new Error('UNKNOWN_PAYMENT_OPERATION');
        }
        const switches = [];
        for (const state of plan.paymentSwitches) {
            const method =
                state.paymentMethodId === 'NEW_PLATFORM_TEST_METHOD' ? globalTestId : state.paymentMethodId;
            assert.ok(method, 'PLATFORM_PAYMENT_TARGET_MISSING');
            const [current] = await connection.query(
                'SELECT enabled FROM store_payment_method_state WHERE channelId = ? AND paymentMethodId = ?',
                [state.channelId, method],
            );
            if (!current.length)
                await connection.query(
                    'INSERT INTO store_payment_method_state (channelId,paymentMethodId,enabled) VALUES (?,?,?)',
                    [state.channelId, method, state.enabled],
                );
            const [saved] = await connection.query(
                'SELECT enabled FROM store_payment_method_state WHERE channelId = ? AND paymentMethodId = ?',
                [state.channelId, method],
            );
            const expected = current.length ? Boolean(current[0].enabled) : state.enabled;
            assert.equal(saved.length, 1, 'PAYMENT_SWITCH_READBACK_FAILED');
            assert.equal(Boolean(saved[0].enabled), expected, 'PAYMENT_SWITCH_READBACK_FAILED');
            switches.push({
                channelId: state.channelId,
                paymentMethodId: method,
                enabled: Boolean(saved[0].enabled),
            });
        }
        await phase('payments');
        for (const [table, expected] of Object.entries(protectedState)) {
            const [rows] = await connection.query(`SELECT * FROM ${quote(table)} ORDER BY id`);
            assert.equal(sha(stable(rows)), expected, 'PROTECTED_PAYMENT_HISTORY_CHANGED');
        }
        for (const item of resources) {
            const [rows] = await connection.query(
                "SELECT ownerChannelId FROM catalog_resource_ownership WHERE resourceType = ? AND resourceId = ? AND scope = 'STORE'",
                [item.resourceType, item.targetId],
            );
            assert.equal(String(rows[0]?.ownerChannelId), item.ownerChannelId, 'OWNER_READBACK_FAILED');
        }
        const report = {
            schema: 'vendure-platform-governance-apply-v1',
            planSha256: expectedSha,
            status: 'APPLIED',
            resources,
            held: plan.held,
            paymentSwitches: switches,
            globalTestMethodId: globalTestId ?? null,
            protectedHistoryVerified: true,
        };
        await appendReceipt(connection, plan, report, key);
        await phase('receipt');
        await connection.commit();
        return report;
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

async function main() {
    const [mode, expectedSha = ''] = process.argv.slice(2);
    assert.ok(
        ['plan', 'apply'].includes(mode) && process.argv.length <= 4,
        'FIXED_PLAN_OR_REVIEWED_APPLY_ONLY',
    );
    if (mode === 'apply') {
        assert.equal(process.env.VENDURE_GOVERNANCE_BACKUP_VERIFIED, 'true', 'VERIFIED_BACKUP_REQUIRED');
        const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
        for (const name of ['vendure-api', 'vendure-worker']) {
            const matches = processes.filter(item => item.name === name);
            assert.equal(matches.length, 1);
            assert.equal(matches[0].pm2_env.status, 'stopped');
            assert.ok(!matches[0].pid, 'WRITERS_STILL_RUNNING');
        }
    }
    const require = createRequire(
        path.join(
            process.env.STORE_ISOLATION_MODULE_ROOT || path.resolve(import.meta.dirname, '../../..'),
            'package.json',
        ),
    );
    const connection = await require('mysql2/promise').createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: false,
    });
    try {
        const result =
            mode === 'apply'
                ? await applyReconciliation(connection, expectedSha)
                : await collectReconciliationPlan(connection);
        const summary =
            mode === 'plan'
                ? result
                : {
                      ...result,
                      resources: result.resources.length,
                      held: result.held.length,
                      paymentSwitches: result.paymentSwitches.length,
                  };
        process.stdout.write(`${JSON.stringify(summary)}\n`);
    } finally {
        await connection.end();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        process.stderr.write(
            `GOVERNANCE_RECONCILIATION_FAILED digest=${sha(String(error.message)).slice(0, 12)}\n`,
        );
        process.exitCode = 1;
    });
