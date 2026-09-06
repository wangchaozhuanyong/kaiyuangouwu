const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const MIGRATIONS = ['AddUsdtActiveAmountKey1788703200000', 'ReleaseUsdtHistoricalAmountKeys1788706800000'];
const TABLE = 'storefront_usdt_payment_intent';

function assertStopped(processes) {
    for (const name of ['vendure-api', 'vendure-worker']) {
        const matches = processes.filter(process => process.name === name);
        assert.equal(matches.length, 1, 'USDT migration requires both known production processes');
        assert.equal(matches[0].pm2_env.status, 'stopped', 'USDT migration requires stopped writers');
        assert.ok(!matches[0].pid, 'USDT migration still has a live writer');
    }
}

function assertCompatible(schema, activeRuntime) {
    if (!schema.historyUnique) {
        assert.ok(schema.activeUnique && schema.activeColumn, 'USDT active amount schema is incomplete');
        assert.ok(
            activeRuntime,
            'USDT schema forbids restarting a legacy API or worker; use a compatible forward fix',
        );
    }
}

function assertPending(pending) {
    assert.ok(
        pending.every(name => MIGRATIONS.includes(name)),
        'Unreviewed pending migrations; inspect the exact list before release',
    );
}

async function schemaState(db) {
    const [columns] = await db.query('SHOW COLUMNS FROM ??', [TABLE]);
    const [indexes] = await db.query('SHOW INDEX FROM ??', [TABLE]);
    const uniqueColumn = name =>
        indexes.some(
            index =>
                index.Column_name === name &&
                Number(index.Non_unique) === 0 &&
                indexes.filter(other => other.Key_name === index.Key_name).length === 1,
        );
    return {
        activeColumn: columns.some(column => column.Field === 'activeMatchKey' && column.Null === 'YES'),
        activeUnique: uniqueColumn('activeMatchKey'),
        historyUnique: uniqueColumn('matchKey'),
        historyIndexed: indexes.some(index => index.Column_name === 'matchKey'),
        quoteUnique: uniqueColumn('quoteId'),
        transactionUnique: uniqueColumn('transactionId'),
    };
}

async function historySnapshot(db) {
    // Read in bounded pages. Only counts and a digest leave the process, never addresses or order/transaction IDs.
    const digest = createHash('sha256');
    let cursor = '0';
    let count = 0;
    const statuses = {};
    const links = { quote: 0, order: 0, payment: 0, transaction: 0 };
    for (;;) {
        const [rows] = await db.query('SELECT * FROM ?? WHERE id > ? ORDER BY id LIMIT 1000', [
            TABLE,
            cursor,
        ]);
        for (const row of rows) {
            const historical = Object.fromEntries(
                Object.keys(row)
                    .filter(key => key !== 'activeMatchKey')
                    .sort()
                    .map(key => [key, row[key]]),
            );
            digest.update(JSON.stringify(historical) + '\n');
            count++;
            statuses[row.status] = (statuses[row.status] || 0) + 1;
            for (const key of Object.keys(links)) if (row[`${key}Id`] != null) links[key]++;
        }
        if (rows.length < 1000) break;
        cursor = String(rows.at(-1).id);
    }
    return { count, statuses, links, sha256: digest.digest('hex') };
}

async function inspect(db, repository) {
    const [version] = await db.query('SELECT VERSION() AS version');
    assert.match(version[0].version, /^8\./, 'This production guard requires the reviewed MySQL 8 topology');
    const registry = readFileSync(path.join(repository, 'packages/dev-server/migrations/index.ts'), 'utf8');
    const match = registry.match(/export const devServerMigrations\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(match, 'Migration registry is unavailable');
    const names = match[1]
        .split(',')
        .map(name => name.trim())
        .filter(Boolean);
    assert.ok(
        names.every(name => /^[A-Za-z]+\w*\d{13}$/.test(name)),
        'Invalid migration registry',
    );
    const [applied] = await db.query('SELECT name FROM migrations ORDER BY id');
    const pending = names.filter(name => !applied.some(row => row.name === name));
    return { databaseVersion: version[0].version, pending, schema: await schemaState(db) };
}

async function run(operation, runtime, snapshotFile, repository = path.resolve(__dirname, '..')) {
    assert.ok(
        ['plan', 'capture', 'verify', 'check-runtime'].includes(operation),
        'Unsupported USDT guard operation',
    );
    assert.ok(path.isAbsolute(runtime), 'An absolute verified runtime is required');
    const runtimeRequire = createRequire(path.join(runtime, 'packages/dev-server/package.json'));
    const environment = {
        ...runtimeRequire('dotenv').parse(readFileSync('/var/www/kaiyuangouwu/packages/dev-server/.env')),
        ...process.env,
    };
    assert.equal(environment.DB, 'mysql', 'USDT guard requires the reviewed production DB engine');
    for (const key of ['DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'])
        assert.ok(environment[key], 'Missing database configuration');
    const mysql = runtimeRequire('mysql2/promise');
    const db = await mysql.createConnection({
        host: environment.DB_HOST || '127.0.0.1',
        port: Number(environment.DB_PORT || 3306),
        user: environment.DB_USERNAME,
        password: environment.DB_PASSWORD,
        database: environment.DB_NAME,
        connectTimeout: 15000,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
    });
    try {
        const schema = await schemaState(db);
        const entityPath = path.join(
            path.dirname(runtimeRequire.resolve('@vendure/store-management-plugin')),
            'entities/storefront-usdt-payment-intent.entity.js',
        );
        const activeRuntime = readFileSync(entityPath, 'utf8').includes(
            'IDX_storefront_usdt_intent_active_match_key',
        );
        if (operation === 'check-runtime') {
            assertCompatible(schema, activeRuntime);
        } else if (operation === 'plan') {
            const plan = await inspect(db, repository);
            process.stdout.write(`USDT_MIGRATION_PLAN ${JSON.stringify(plan)}\n`);
            assertPending(plan.pending);
        } else {
            assertStopped(JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })));
            assert.ok(path.isAbsolute(snapshotFile), 'Absolute migration snapshot path is required');
            if (operation === 'capture') {
                const plan = await inspect(db, repository);
                assertPending(plan.pending);
                const snapshot = { ...plan, history: await historySnapshot(db) };
                writeFileSync(snapshotFile, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
                process.stdout.write(`USDT_MIGRATION_CAPTURE ${JSON.stringify(snapshot)}\n`);
            } else {
                const before = JSON.parse(readFileSync(snapshotFile, 'utf8'));
                const after = await inspect(db, repository);
                assert.equal(after.pending.length, 0, 'USDT migrations remain pending');
                assertCompatible(schema, activeRuntime);
                assert.ok(
                    !schema.historyUnique &&
                        schema.historyIndexed &&
                        schema.activeUnique &&
                        schema.activeColumn &&
                        schema.quoteUnique &&
                        schema.transactionUnique,
                    'USDT migration index check failed',
                );
                const history = await historySnapshot(db);
                assert.deepEqual(history, before.history, 'USDT migration changed historical data or links');
                const [unclaimed] = await db.query(
                    'SELECT COUNT(*) AS count FROM ?? WHERE activeMatchKey IS NULL',
                    [TABLE],
                );
                if (before.schema.historyUnique)
                    assert.equal(
                        Number(unclaimed[0].count),
                        0,
                        'USDT legacy occupancy was not fully backfilled',
                    );
                process.stdout.write(`USDT_MIGRATION_VERIFIED ${JSON.stringify({ schema, history })}\n`);
            }
        }
        process.stdout.write(`USDT_RUNTIME_GUARD_OK operation=${operation}\n`);
    } finally {
        await db.end();
    }
}

module.exports = { assertStopped, assertCompatible, assertPending, schemaState, historySnapshot, inspect };
if (require.main === module) {
    run(...process.argv.slice(2)).catch(error => {
        // Database/driver errors can contain connection details or records; do not print their raw message.
        process.stderr.write(
            `USDT_RUNTIME_GUARD_FAILED ${error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'operation failed; inspect securely on the production host'}\n`,
        );
        process.exitCode = 1;
    });
}
