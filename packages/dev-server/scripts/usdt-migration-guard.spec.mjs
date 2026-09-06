import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import guard from '../../../deploy/usdt-migration-guard.cjs';

test('USDT maintenance rejects a running, missing, duplicated or still-live writer', () => {
    const stopped = ['vendure-api', 'vendure-worker'].map(name => ({
        name,
        pid: 0,
        pm2_env: { status: 'stopped' },
    }));
    guard.assertStopped(stopped);
    assert.throws(() => guard.assertStopped(stopped.slice(0, 1)));
    assert.throws(() => guard.assertStopped([...stopped, stopped[0]]));
    assert.throws(() => guard.assertStopped([{ ...stopped[0], pid: 12 }, stopped[1]]));
    assert.throws(() => guard.assertStopped([stopped[0], { ...stopped[1], pm2_env: { status: 'online' } }]));
});

test('USDT contracted schema never permits a legacy runtime, even before the first reuse', () => {
    guard.assertCompatible({ historyUnique: true }, false);
    guard.assertCompatible({ historyUnique: false, activeColumn: true, activeUnique: true }, true);
    assert.throws(
        () => guard.assertCompatible({ historyUnique: false, activeColumn: true, activeUnique: true }, false),
        /legacy API/,
    );
    assert.throws(
        () => guard.assertCompatible({ historyUnique: false, activeColumn: true, activeUnique: false }, true),
        /incomplete/,
    );
});

test('USDT migration preflight rejects any extra pending migration', () => {
    guard.assertPending([]);
    guard.assertPending([
        'AddUsdtActiveAmountKey1788703200000',
        'ReleaseUsdtHistoricalAmountKeys1788706800000',
    ]);
    assert.throws(
        () =>
            guard.assertPending(['AddUsdtActiveAmountKey1788703200000', 'UnexpectedMigration1789999999999']),
        /Unreviewed/,
    );
});

test('USDT history digest ignores the new reservation column but detects changed transaction links', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({
        id: id + 1,
        status: 'EXPIRED',
        quoteId: id + 1,
        orderId: id + 1,
        paymentId: null,
        transactionId: null,
        matchKey: `synthetic-${id}`,
    }));
    const db = {
        query: async (_sql, [_table, cursor]) => [rows.filter(row => row.id > Number(cursor)).slice(0, 1000)],
    };
    const before = await guard.historySnapshot(db);
    assert.equal(before.count, 1001);
    assert.equal(before.links.quote, 1001);
    rows.forEach(row => {
        row.activeMatchKey = row.matchKey;
    });
    assert.deepEqual(await guard.historySnapshot(db), before);
    rows[1000].transactionId = 'synthetic-transaction';
    assert.notEqual((await guard.historySnapshot(db)).sha256, before.sha256);
    assert.ok(!JSON.stringify(before).includes('synthetic'));
});

test('USDT deployment checks backup and history while both writers are stopped, before starting the candidate', async () => {
    const script = await readFile(
        new URL('../../../deploy/deploy-production-from-s3.sh', import.meta.url),
        'utf8',
    );
    const stop = script.indexOf(
        'pm2 stop vendure-worker vendure-api 9>&-',
        script.indexOf('readonly usdt_guard='),
    );
    const capture = script.indexOf('node "${usdt_guard}" capture');
    const backup = script.indexOf("printf 'DEPLOY_BACKUP_OK");
    const migrate = script.indexOf('node packages/dev-server/dist/run-migrations.js');
    const verify = script.indexOf('node "${usdt_guard}" verify');
    const start = script.indexOf('"${repository}/deploy/switch-production-runtime.sh" "${candidate}"');
    assert.ok(
        stop > 0 &&
            stop < capture &&
            capture < backup &&
            backup < migrate &&
            migrate < verify &&
            verify < start,
    );
    assert.match(script, /ROLLBACK_BLOCKED_USDT_SCHEMA/);
    const switchScript = await readFile(
        new URL('../../../deploy/switch-production-runtime.sh', import.meta.url),
        'utf8',
    );
    assert.ok(
        switchScript.indexOf('usdt-migration-guard.cjs" check-runtime') < switchScript.indexOf('pm2 delete'),
    );
});
