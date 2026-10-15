import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Maintenance only: these are disposable records, never catalog/content/configuration or credentials.
export const RESET_TABLES = [
    'customer_coupon',
    'coupon_ledger_entry',
    'coupon_order_allocation',
    'referral_relationship',
    'referral_reward',
    'referral_balance_use',
    'referral_ledger_entry',
    'referral_wallet_usage',
    'referral_withdrawal',
    'storefront_cart',
    'storefront_cart_line',
    'storefront_cart_checkout',
    'storefront_cart_checkout_line',
    'storefront_cart_command_receipt',
    'storefront_payment_attempt',
    'storefront_page_view',
    'storefront_daily_visitor',
    'storefront_presence',
    'storefront_presence_status',
    'storefront_order_attribution',
    'storefront_review',
    'customer_service_review',
    'customer_service_feedback',
    'admin_incident_evidence',
    'admin_incident_action',
    'admin_notification_outbox',
    'store_notification_read',
    'history_entry',
    'governance_report_snapshot',
    'icloud_received_mail',
    'icloud_query_audit_log',
    'icloud_mail_outbox',
    'image_generation_dispatch',
    'image_generation_output',
    'image_generation_cost_event',
    'image_generation_job',
    'image_prompt_optimization_attempt',
    'image_prompt_optimization',
    'image_usage_quota_event',
    'image_usage_quota_bucket',
    'job_record',
];
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED', 'SUCCEEDED', 'SETTLED']);
const q = (runner, value) => runner.connection.driver.escape(value);
const canonical = value => {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value))
        return { binary: Buffer.from(value).toString('base64') };
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(k => [k, canonical(value[k])]),
        );
    return typeof value === 'bigint' ? String(value) : value;
};
export const resetHash = value =>
    createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex');
const normalizeIdentity = row =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? null : String(v)]));
const identity = (schema, row) =>
    normalizeIdentity(Object.fromEntries(schema.primaryKeys.map(k => [k, row[k]])));
const key = (schema, row) => resetHash(identity(schema, row));
const same = (a, b) => String(a) === String(b);
const matches = (row, ref, parent) =>
    ref.columns.every((c, i) => row[c] != null && same(row[c], parent[ref.targetColumns[i]]));

export async function collectGeneratedResetPlan(runner, schemas, options = {}) {
    const tables = new Map(schemas.map(t => [t.name, t]));
    const raw = {};
    const deletes = {};
    const patches = [];
    const blockers = [];
    const kept = {};
    const external = options.orderPlan?.deletes ?? [];
    const orderPatches = options.orderPlan?.patches ?? [];
    const read = async name => {
        const schema = tables.get(name);
        if (!schema) return [];
        assert.ok(schema.primaryKeys.length, 'Reset table requires a stable primary key: ' + name);
        const rows = await runner.query(
            'SELECT * FROM ' +
                q(runner, name) +
                ' ORDER BY ' +
                schema.primaryKeys.map(k => q(runner, k)).join(',') +
                ' LIMIT 20001',
        );
        assert.ok(rows.length <= 20000, 'Reset table bound exceeded: ' + name);
        return rows
            .filter(
                row =>
                    !external.some(
                        e =>
                            e.table === name && resetHash(normalizeIdentity(e.identity)) === key(schema, row),
                    ),
            )
            .map(
                row =>
                    orderPatches.find(
                        p =>
                            p.table === name && resetHash(normalizeIdentity(p.identity)) === key(schema, row),
                    )?.after ?? row,
            );
    };
    for (const name of RESET_TABLES) {
        if (!tables.has(name)) continue;
        const rows = (raw[name] = await read(name));
        deletes[name] = rows.filter(row => {
            if (name === 'job_record')
                return (
                    TERMINAL.has(String(row.state)) ||
                    /mail|notif|order|coupon|referral|checkout|cart|after.sales|image|visitor|analytics/i.test(
                        String(row.queueName),
                    )
                );
            if (name === 'image_generation_job' && !TERMINAL.has(String(row.state))) {
                blockers.push({ code: 'ACTIVE_IMAGE_GENERATION', table: name });
                return false;
            }
            return true;
        });
        kept[name] = rows.length - deletes[name].length;
    }
    for (const name of ['referral_wallet', 'customer_operations_profile']) {
        if (!tables.has(name)) continue;
        const schema = tables.get(name);
        const rows = (raw[name] = await read(name));
        const numbers =
            name === 'referral_wallet'
                ? ['availableBalance', 'pendingBalance', 'reservedBalance']
                : [
                      'orderCount',
                      'grossRevenue',
                      'refundTotal',
                      'netLifetimeValue',
                      'averageOrderValue',
                      'frequencyScore',
                      'monetaryScore',
                      'recencyScore',
                      'afterSalesCount',
                      'openAfterSalesCount',
                  ];
        for (const row of rows) {
            const changes = Object.fromEntries(
                numbers.filter(k => schema.columns.includes(k)).map(k => [k, 0]),
            );
            if (name === 'referral_wallet' && schema.columns.includes('version'))
                changes.version = Number(row.version) + 1;
            if (name === 'customer_operations_profile') {
                if (schema.columns.includes('lastOrderAt')) changes.lastOrderAt = null;
                if (schema.columns.includes('currencyMetricsJson')) changes.currencyMetricsJson = '{}';
                if (schema.columns.includes('evaluationVersion'))
                    changes.evaluationVersion = 'STALE_PRELAUNCH_RESET';
            }
            if (Object.entries(changes).some(([k, v]) => !same(row[k], v)))
                patches.push({ table: name, identity: identity(schema, row), before: row, changes });
        }
    }
    // Prove that neither a database cascade nor an unplanned incoming reference can touch retained data.
    for (const child of schemas)
        for (const ref of child.foreignKeys) {
            const parents = deletes[ref.target] ?? [];
            if (!parents.length) continue;
            const parentSchema = tables.get(ref.target);
            const selected = new Set((deletes[child.name] ?? []).map(r => key(child, r)));
            const externallyDeleted = new Set(
                external
                    .filter(e => e.table === child.name)
                    .map(e => resetHash(normalizeIdentity(e.identity))),
            );
            for (let offset = 0; offset < parents.length; offset += 200) {
                const batch = parents.slice(offset, offset + 200);
                const terms = batch.map(
                    () => '(' + ref.columns.map(c => q(runner, c) + ' = ?').join(' AND ') + ')',
                );
                const fields = [...new Set([...child.primaryKeys, ...ref.columns])];
                const hits = await runner.query(
                    'SELECT ' +
                        fields.map(k => q(runner, k)).join(',') +
                        ' FROM ' +
                        q(runner, child.name) +
                        ' WHERE ' +
                        terms.join(' OR '),
                    batch.flatMap(p => ref.targetColumns.map(c => p[c])),
                );
                for (const row of hits)
                    if (
                        !child.primaryKeys.length ||
                        (!selected.has(key(child, row)) && !externallyDeleted.has(key(child, row)))
                    )
                        blockers.push({
                            code: 'RETAINED_INCOMING_REFERENCE',
                            table: child.name,
                            target: parentSchema.name,
                        });
            }
        }
    const deleteOrder = [];
    const pending = Object.keys(deletes).filter(n => deletes[n].length);
    while (pending.length) {
        const leaves = pending.filter(
            name =>
                !pending.some(
                    child => child !== name && tables.get(child).foreignKeys.some(f => f.target === name),
                ),
        );
        if (!leaves.length) {
            blockers.push({ code: 'DEPENDENCY_CYCLE', tables: pending.slice() });
            break;
        }
        for (const leaf of leaves) {
            deleteOrder.push(leaf);
            pending.splice(pending.indexOf(leaf), 1);
        }
    }
    for (const name of deleteOrder) {
        const schema = tables.get(name);
        const self = schema.foreignKeys.filter(f => f.target === name);
        if (!self.length) continue;
        const pendingRows = deletes[name].slice();
        const ordered = [];
        while (pendingRows.length) {
            const leaves = pendingRows.filter(
                parent =>
                    !pendingRows.some(child => child !== parent && self.some(f => matches(child, f, parent))),
            );
            if (!leaves.length) {
                blockers.push({ code: 'SELF_REFERENCE_CYCLE', table: name });
                break;
            }
            for (const leaf of leaves) {
                ordered.push(leaf);
                pendingRows.splice(pendingRows.indexOf(leaf), 1);
            }
        }
        deletes[name] = ordered;
    }
    const snapshotHash = resetHash({ schemas, raw });
    const plan = {
        version: 1,
        snapshotHash,
        orderPlanHash: options.orderPlanHash ?? options.orderPlan?.planHash ?? null,
        schemas,
        raw,
        deletes,
        deleteOrder,
        patches,
        kept,
        blockers,
    };
    plan.planHash = resetHash(plan);
    return plan;
}

export function publicGeneratedResetPlan(plan) {
    return {
        version: plan.version,
        planHash: plan.planHash,
        snapshotHash: plan.snapshotHash,
        orderPlanHash: plan.orderPlanHash,
        deletionCounts: Object.fromEntries(Object.entries(plan.deletes).map(([n, r]) => [n, r.length])),
        kept: plan.kept,
        patchCounts: plan.patches.reduce((out, p) => ({ ...out, [p.table]: (out[p.table] ?? 0) + 1 }), {}),
        blockers: plan.blockers,
        canApply: plan.blockers.length === 0,
        externalActions: [],
    };
}

export async function applyGeneratedReset(runner, plan, expectedHash) {
    assert.equal(runner.isTransactionActive, false, 'Generated reset owns its transaction');
    assert.equal(plan.planHash, expectedHash, 'Reviewed generated reset plan changed');
    assert.equal(plan.blockers.length, 0, 'Generated reset dependencies are unresolved');
    await runner.startTransaction('SERIALIZABLE');
    try {
        const current = await collectGeneratedResetPlan(runner, plan.schemas, {
            orderPlanHash: plan.orderPlanHash,
        });
        assert.equal(
            current.snapshotHash,
            plan.snapshotHash,
            'Generated records changed since the frozen plan',
        );
        const schemas = new Map(plan.schemas.map(s => [s.name, s]));
        for (const patch of plan.patches) {
            const columns = Object.keys(patch.changes);
            const keys = Object.keys(patch.identity);
            await runner.query(
                'UPDATE ' +
                    q(runner, patch.table) +
                    ' SET ' +
                    columns.map(c => q(runner, c) + ' = ?').join(',') +
                    ' WHERE ' +
                    keys.map(k => q(runner, k) + ' = ?').join(' AND '),
                [...Object.values(patch.changes), ...Object.values(patch.identity)],
            );
        }
        for (const table of plan.deleteOrder) {
            const schema = schemas.get(table);
            const self = schema.foreignKeys.some(f => f.target === table);
            const batchSize = schema.primaryKeys.length === 1 && !self ? 250 : 1;
            for (let n = 0; n < plan.deletes[table].length; n += batchSize) {
                const batch = plan.deletes[table].slice(n, n + batchSize);
                const where = batch
                    .map(() => '(' + schema.primaryKeys.map(k => q(runner, k) + ' = ?').join(' AND ') + ')')
                    .join(' OR ');
                await runner.query(
                    'DELETE FROM ' + q(runner, table) + ' WHERE ' + where,
                    batch.flatMap(r => schema.primaryKeys.map(k => r[k])),
                );
            }
            const remaining = await runner.query(
                'SELECT ' + schema.primaryKeys.map(k => q(runner, k)).join(',') + ' FROM ' + q(runner, table),
            );
            const remainingKeys = new Set(remaining.map(r => key(schema, r)));
            assert.ok(
                plan.deletes[table].every(r => !remainingKeys.has(key(schema, r))),
                'A frozen generated record survived: ' + table,
            );
        }
        for (const patch of plan.patches) {
            const schema = schemas.get(patch.table);
            const keys = Object.keys(patch.identity);
            const [row] = await runner.query(
                'SELECT * FROM ' +
                    q(runner, patch.table) +
                    ' WHERE ' +
                    keys.map(k => q(runner, k) + ' = ?').join(' AND '),
                Object.values(patch.identity),
            );
            assert.ok(row, 'A preserved baseline identity was lost');
            for (const [k, v] of Object.entries(patch.changes))
                assert.ok(same(row[k], v), 'Reset baseline mismatch: ' + patch.table + '.' + k);
            for (const k of schema.columns.filter(
                column => !Object.hasOwn(patch.changes, column) && column !== 'updatedAt',
            ))
                assert.equal(
                    resetHash(row[k]),
                    resetHash(patch.before[k]),
                    'Retained baseline field changed: ' + patch.table + '.' + k,
                );
        }
        await runner.commitTransaction();
        return {
            status: 'APPLIED',
            planHash: plan.planHash,
            deletionCounts: publicGeneratedResetPlan(plan).deletionCounts,
            patchedRows: plan.patches.length,
            externalActions: [],
        };
    } catch (error) {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        throw error;
    }
}
