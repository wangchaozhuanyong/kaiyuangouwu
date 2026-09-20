import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CHANNEL_CODE = '__default_channel__';

function runtimeRequire(environment) {
    const moduleRoot = environment.STORE_ISOLATION_MODULE_ROOT?.trim();
    return moduleRoot
        ? createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
        : createRequire(import.meta.url);
}

function canonicalOperations(operations) {
    return operations.map(operation => [
        String(operation.orderId),
        String(operation.channelId),
        operation.channelCode,
    ]);
}

export function operationDigest(operations) {
    return createHash('sha256')
        .update(JSON.stringify(canonicalOperations(operations)))
        .digest('hex');
}

export function buildOrderSalesOwnershipPlan(rows) {
    const orders = new Map();
    for (const row of rows) {
        const orderId = String(row.orderId);
        const item = orders.get(orderId) ?? { orderId, memberships: new Map() };
        if (row.channelId != null && row.channelCode != null) {
            item.memberships.set(String(row.channelId), String(row.channelCode));
        }
        orders.set(orderId, item);
    }

    const operations = [];
    for (const item of orders.values()) {
        const memberships = [...item.memberships].map(([channelId, channelCode]) => ({
            channelId,
            channelCode,
        }));
        assert.ok(memberships.length > 0, 'A historical order has no Channel membership');
        const nonDefault = memberships.filter(entry => entry.channelCode !== DEFAULT_CHANNEL_CODE);
        assert.ok(nonDefault.length <= 1, 'A historical order has multiple non-default Channel memberships');
        const owner = nonDefault[0] ?? memberships.find(entry => entry.channelCode === DEFAULT_CHANNEL_CODE);
        assert.ok(owner, 'A historical order has no deterministic sales owner');
        operations.push({ orderId: item.orderId, ...owner });
    }
    operations.sort((left, right) => left.orderId.localeCompare(right.orderId, 'en', { numeric: true }));

    const countsByChannel = {};
    for (const operation of operations) {
        countsByChannel[operation.channelCode] = (countsByChannel[operation.channelCode] ?? 0) + 1;
    }
    return {
        format: 1,
        schema: 'vendure-order-sales-ownership-backfill',
        mode: 'deterministic-channel-membership',
        candidateCount: operations.length,
        countsByChannel: Object.fromEntries(
            Object.entries(countsByChannel).sort(([a], [b]) => a.localeCompare(b)),
        ),
        operationDigest: operationDigest(operations),
        operations,
    };
}

async function collectRows(connection, lock = false) {
    const [rows] = await connection.query(
        `SELECT item.id AS orderId, relation.channelId AS channelId, channelItem.code AS channelCode
         FROM \`order\` item
         LEFT JOIN order_channels_channel relation ON relation.orderId = item.id
         LEFT JOIN channel channelItem ON channelItem.id = relation.channelId
         WHERE item.salesChannelId IS NULL
         ORDER BY item.id ASC, relation.channelId ASC${lock ? ' FOR UPDATE' : ''}`,
    );
    return rows;
}

function publicPlan(plan) {
    const { operations: _operations, ...safe } = plan;
    return safe;
}

async function connect(environment) {
    const databaseType = String(environment.DB ?? 'mysql').toLowerCase();
    assert.ok(['mysql', 'mariadb'].includes(databaseType), 'Production backfill requires MySQL');
    const mysql = runtimeRequire(environment)('mysql2/promise');
    return mysql.createConnection({
        host: environment.DB_HOST || '127.0.0.1',
        port: Number(environment.DB_PORT || 3306),
        user: environment.DB_USERNAME || 'vendure',
        password: environment.DB_PASSWORD || '',
        database: environment.DB_NAME || 'vendure-dev',
        multipleStatements: false,
    });
}

async function readPlan(environment) {
    const connection = await connect(environment);
    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('SET SESSION TRANSACTION READ ONLY');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        return buildOrderSalesOwnershipPlan(await collectRows(connection));
    } finally {
        try {
            await connection.query('ROLLBACK');
        } finally {
            await connection.end();
        }
    }
}

async function apply(environment, expectedDigest) {
    assert.match(expectedDigest, /^[a-f0-9]{64}$/u, 'An exact reviewed operation digest is required');
    const connection = await connect(environment);
    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        await connection.beginTransaction();
        const current = buildOrderSalesOwnershipPlan(await collectRows(connection, true));
        assert.equal(
            current.operationDigest,
            expectedDigest,
            'Historical order ownership changed after review; rerun the read-only plan',
        );
        assert.ok(current.candidateCount > 0, 'No historical orders require sales ownership backfill');
        for (const operation of current.operations) {
            const [result] = await connection.execute(
                'UPDATE `order` SET salesChannelId = ? WHERE id = ? AND salesChannelId IS NULL',
                [operation.channelId, operation.orderId],
            );
            assert.equal(result.affectedRows, 1, 'A reviewed historical order changed during backfill');
        }
        const [remainingRows] = await connection.query(
            'SELECT COUNT(*) AS value FROM `order` WHERE salesChannelId IS NULL',
        );
        assert.equal(Number(remainingRows[0]?.value ?? -1), 0, 'Historical orders remain without an owner');
        const [mismatchRows] = await connection.query(`SELECT COUNT(*) AS value FROM \`order\` item
            WHERE item.salesChannelId IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM order_channels_channel relation
                WHERE relation.orderId = item.id AND relation.channelId = item.salesChannelId
            )`);
        assert.equal(
            Number(mismatchRows[0]?.value ?? -1),
            0,
            'Order ownership is outside Channel membership',
        );
        await connection.commit();
        return current;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        await connection.end();
    }
}

async function main() {
    const [operation, expectedDigest = ''] = process.argv.slice(2);
    assert.ok(
        ['plan', 'apply'].includes(operation),
        'Usage: order-sales-ownership-backfill.mjs plan|apply [digest]',
    );
    const result =
        operation === 'plan' ? await readPlan(process.env) : await apply(process.env, expectedDigest);
    process.stdout.write(
        `ORDER_SALES_OWNERSHIP_${operation.toUpperCase()} ${JSON.stringify(publicPlan(result))}\n`,
    );
    process.stdout.write(`ORDER_SALES_OWNERSHIP_BACKFILL_OK operation=${operation}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch(error => {
        process.stderr.write(
            `${error instanceof Error ? error.message : 'Order ownership backfill failed'}\n`,
        );
        process.exitCode = 1;
    });
}
