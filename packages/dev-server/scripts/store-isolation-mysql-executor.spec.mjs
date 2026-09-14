import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { lstat, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { executeMysqlCase } from './store-isolation-mysql-executor.mjs';
import {
    atomicJson,
    connectCase,
    CONTROL,
    createCase,
    createLab,
    mysqlInventory,
    stopLab,
} from './store-isolation-mysql-lab.mjs';
import { digest, quote } from './store-isolation-rehearsal.mjs';

const worker = fileURLToPath(new URL('./store-isolation-mysql-executor.mjs', import.meta.url));
function launch(filename, mode, fault, pause = false) {
    const args = [
        '--case',
        filename,
        ...(mode === 'preview' ? [] : [`--${mode}`]),
        ...(fault ? [pause ? '--pause-at' : '--crash-at', fault] : []),
    ];
    const child = fork(worker, args, { silent: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
        stdout += chunk;
    });
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });
    const finished = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    const paused = pause
        ? new Promise((resolve, reject) => {
              child.once('message', resolve);
              child.once('exit', () => reject(new Error('Worker exited before pause')));
          })
        : null;
    return { child, finished, paused };
}
async function run(filename, mode) {
    const result = await launch(filename, mode).finished;
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
}
async function crash(filename, mode, phase) {
    const result = await launch(filename, mode, phase).finished;
    assert.equal(result.signal, 'SIGKILL', result.stderr);
}
async function inspect(filename) {
    const { connection, manifest } = await connectCase(filename);
    try {
        const [journals] = await connection.execute(
            `SELECT * FROM ${quote(CONTROL)}.journal WHERE case_id=?`,
            [manifest.caseId],
        );
        return { manifest, hash: digest(await mysqlInventory(connection)), journal: journals[0] ?? null };
    } finally {
        await connection.end();
    }
}

test(
    'owned MySQL 8.4 durable migration, crash recovery, constraints and concurrent writers',
    { timeout: 240000 },
    async t => {
        const lab = process.env.MYSQL_REHEARSAL_LAB_FILE || (await createLab());
        const results = [];
        const match = process.env.MYSQL_REHEARSAL_TEST_MATCH;
        const check = async (name, action) =>
            t.test(name, { skip: Boolean(match && !new RegExp(match, 'u').test(name)) }, async () => {
                await action();
                results.push({ name, passed: true });
            });
        const untouched = await createCase(lab);
        const original = await inspect(untouched);
        try {
            await check(
                'default CLI preview preserves all rows and creates no journal or receipt',
                async () => {
                    const result = await run(untouched, 'preview');
                    assert.equal(result.databaseChanged, false);
                    assert.equal(result.plannedUpdates, 21);
                    assert.equal((await inspect(untouched)).hash, original.hash);
                    assert.equal((await inspect(untouched)).journal, null);
                    await assert.rejects(lstat(path.join(path.dirname(untouched), 'receipt.json')), {
                        code: 'ENOENT',
                    });
                },
            );
            await check(
                'fresh processes apply once and roll back exactly; a completed rollback cannot reapply',
                async () => {
                    const filename = await createCase(lab);
                    const before = await inspect(filename);
                    const first = await run(filename, 'apply');
                    assert.equal(first.status, 'applied');
                    assert.equal(first.updatedRows, 21);
                    assert.equal((await run(filename, 'apply')).status, 'already-applied');
                    assert.deepEqual(first.protected, (await run(filename, 'preview')).protected);
                    assert.equal((await inspect(filename)).journal.apply_count, 1);
                    const rollback = await run(filename, 'rollback');
                    assert.equal(rollback.status, 'rolled-back');
                    assert.deepEqual(first.protected, rollback.protected);
                    assert.equal((await inspect(filename)).hash, before.hash);
                    assert.equal((await run(filename, 'rollback')).status, 'already-rolled-back');
                    assert.equal((await run(filename, 'apply')).status, 'already-rolled-back');
                    assert.equal((await inspect(filename)).journal.rollback_count, 1);
                },
            );
            for (const phase of ['after-write-1', 'after-write-11', 'after-write-21', 'before-commit'])
                await check(
                    `SIGKILL apply ${phase}: MySQL rolls back and a new process safely resumes`,
                    async () => {
                        const filename = await createCase(lab);
                        const before = await inspect(filename);
                        await crash(filename, 'apply', phase);
                        const failed = await inspect(filename);
                        assert.equal(failed.hash, before.hash);
                        assert.equal(failed.journal, null);
                        assert.equal((await run(filename, 'apply')).status, 'applied');
                        assert.equal((await inspect(filename)).journal.apply_count, 1);
                    },
                );
            await check(
                'SIGKILL after COMMIT reconciles a stale intent from the DB without a second update',
                async () => {
                    const filename = await createCase(lab);
                    await crash(filename, 'apply', 'after-commit');
                    const receipt = path.join(path.dirname(filename), 'receipt.json');
                    assert.equal(JSON.parse(await readFile(receipt)).status, 'prepared-apply');
                    const applied = await inspect(filename);
                    assert.equal(applied.hash, applied.manifest.afterSha256);
                    assert.equal(applied.journal.apply_count, 1);
                    assert.equal((await run(filename, 'apply')).status, 'already-applied');
                    assert.equal(JSON.parse(await readFile(receipt)).status, 'applied');
                    await rename(receipt, `${receipt}.preserved`);
                    assert.equal((await run(filename, 'apply')).status, 'already-applied');
                    assert.equal((await inspect(filename)).journal.apply_count, 1);
                },
            );
            for (const phase of ['after-write-11', 'before-commit', 'after-commit'])
                await check(
                    `SIGKILL rollback ${phase}: new-process recovery restores every row exactly once`,
                    async () => {
                        const filename = await createCase(lab);
                        await run(filename, 'apply');
                        await crash(filename, 'rollback', phase);
                        const state = await inspect(filename);
                        assert.equal(
                            state.hash,
                            phase === 'after-commit'
                                ? state.manifest.sourceSha256
                                : state.manifest.afterSha256,
                        );
                        assert.equal(
                            (await run(filename, 'rollback')).status,
                            phase === 'after-commit' ? 'already-rolled-back' : 'rolled-back',
                        );
                        const restored = await inspect(filename);
                        assert.equal(restored.hash, restored.manifest.sourceSha256);
                        assert.equal(restored.journal.apply_count, 1);
                        assert.equal(restored.journal.rollback_count, 1);
                    },
                );
            await check(
                'two executors cannot overlap; unrelated-field writers are locked until commit',
                async () => {
                    const filename = await createCase(lab);
                    const running = launch(filename, 'apply', 'locked', true);
                    let connection;
                    try {
                        assert.equal((await running.paused).phase, 'locked');
                        await assert.rejects(executeMysqlCase(filename, 'apply'), /already running/u);
                        ({ connection } = await connectCase(filename));
                        await connection.query('SET SESSION innodb_lock_wait_timeout=1');
                        await assert.rejects(
                            connection.execute('UPDATE `order` SET subTotal=subTotal+1 WHERE id=?', [101]),
                            { code: 'ER_LOCK_WAIT_TIMEOUT' },
                        );
                        await assert.rejects(
                            connection.execute('INSERT INTO channel (id,code) VALUES (?,?)', [
                                99,
                                'unrelated-concurrent',
                            ]),
                            { code: 'ER_LOCK_WAIT_TIMEOUT' },
                        );
                        await connection.query('SET SESSION lock_wait_timeout=1');
                        await assert.rejects(
                            connection.query(
                                'CREATE TABLE concurrent_reference (id INT PRIMARY KEY, customerId INT) ENGINE=InnoDB',
                            ),
                            { code: 'ER_LOCK_WAIT_TIMEOUT' },
                        );
                    } finally {
                        if (connection) await connection.end();
                        running.child.send('continue');
                    }
                    const result = await running.finished;
                    assert.equal(result.code, 0, result.stderr);
                    assert.equal((await run(filename, 'apply')).status, 'already-applied');
                },
            );
            await check(
                'real InnoDB FK, composite PK and unique constraints reject invalid references and preserve rollback',
                async () => {
                    const filename = await createCase(lab);
                    const before = await inspect(filename);
                    const { connection } = await connectCase(filename);
                    try {
                        const [[count]] = await connection.query(
                            'SELECT COUNT(*) AS count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()',
                        );
                        assert.ok(count.count > 80);
                        await connection.beginTransaction();
                        await connection.execute('UPDATE address SET customerId=? WHERE id=?', [21, 202]);
                        await assert.rejects(
                            connection.execute('UPDATE `order` SET customerId=? WHERE id=?', [999999, 102]),
                            { code: 'ER_NO_REFERENCED_ROW_2' },
                        );
                        await connection.rollback();
                        await assert.rejects(
                            connection.execute('UPDATE customer SET userId=? WHERE id=?', [91, 21]),
                            { code: 'ER_DUP_ENTRY' },
                        );
                        await assert.rejects(
                            connection.execute('INSERT INTO customer_channels_channel VALUES (?,?)', [11, 1]),
                            { code: 'ER_DUP_ENTRY' },
                        );
                        await assert.rejects(
                            connection.execute(
                                'INSERT INTO stock_level VALUES (?,?,?,?,?)',
                                [999, 41, 51, 1, 0],
                            ),
                            { code: 'ER_DUP_ENTRY' },
                        );
                    } finally {
                        await connection.end();
                    }
                    assert.equal((await inspect(filename)).hash, before.hash);
                },
            );
            await check(
                'pre-existing data drift and unknown reference tables block all executor writes',
                async () => {
                    const filename = await createCase(lab);
                    const { connection } = await connectCase(filename);
                    try {
                        await connection.execute('UPDATE `order` SET subTotal=subTotal+1 WHERE id=?', [101]);
                        await assert.rejects(executeMysqlCase(filename, 'apply'), /refusing drift/u);
                        await connection.execute('UPDATE `order` SET subTotal=subTotal-1 WHERE id=?', [101]);
                        await connection.query(
                            'CREATE TABLE unreviewed_reference (id INT PRIMARY KEY, customerId INT, FOREIGN KEY (customerId) REFERENCES customer(id)) ENGINE=InnoDB',
                        );
                        await connection.execute('INSERT INTO unreviewed_reference VALUES (?,?)', [1, 11]);
                        await assert.rejects(executeMysqlCase(filename, 'apply'), /changed schema/u);
                        const [[row]] = await connection.query(
                            'SELECT COUNT(*) AS count FROM unreviewed_reference',
                        );
                        assert.equal(row.count, 1);
                    } finally {
                        await connection.end();
                    }
                    assert.equal((await inspect(filename)).journal, null);
                },
            );
            await check(
                'post-commit business drift blocks retry and rollback, preserving the newer row',
                async () => {
                    const filename = await createCase(lab);
                    await run(filename, 'apply');
                    const { connection } = await connectCase(filename);
                    try {
                        await connection.execute('UPDATE `order` SET subTotal=subTotal+1 WHERE id=?', [101]);
                    } finally {
                        await connection.end();
                    }
                    const changed = await inspect(filename);
                    for (const mode of ['apply', 'rollback'])
                        await assert.rejects(executeMysqlCase(filename, mode), /refusing drift/u);
                    assert.equal((await inspect(filename)).hash, changed.hash);
                    assert.equal((await inspect(filename)).journal.status, 'applied');
                },
            );
            await check('tampered ownership mapping, receipt and database journal fail closed', async () => {
                const filename = await createCase(lab);
                const manifest = JSON.parse(await readFile(filename));
                const changed = structuredClone(manifest);
                changed.operations[0].after = 12;
                await atomicJson(filename, changed);
                await assert.rejects(executeMysqlCase(filename, 'apply'), /Unreviewed ownership/u);
                await atomicJson(filename, manifest);
                const receipt = path.join(path.dirname(filename), 'receipt.json');
                await atomicJson(receipt, { manifestSha256: 'wrong', status: 'applied' });
                await assert.rejects(executeMysqlCase(filename, 'apply'), /another migration/u);
                await rename(receipt, `${receipt}.rejected`);
                await run(filename, 'apply');
                const { connection } = await connectCase(filename);
                try {
                    await connection.execute(
                        `UPDATE ${quote(CONTROL)}.journal SET after_hash=? WHERE case_id=?`,
                        ['0'.repeat(64), manifest.caseId],
                    );
                } finally {
                    await connection.end();
                }
                await assert.rejects(executeMysqlCase(filename, 'rollback'), /Journal projection drift/u);
            });
            await check('changed transport or MySQL UUID is rejected before operation', async () => {
                const descriptor = JSON.parse(await readFile(lab));
                try {
                    await atomicJson(lab, { ...descriptor, transport: 'external-tcp' });
                    await assert.rejects(executeMysqlCase(untouched, 'apply'));
                    await atomicJson(lab, { ...descriptor, serverUuid: 'unowned-instance' });
                    await assert.rejects(executeMysqlCase(untouched, 'apply'));
                } finally {
                    await atomicJson(lab, descriptor);
                }
                assert.equal((await inspect(untouched)).hash, original.hash);
            });
            await check(
                'independent untouched case remains byte-for-byte identical with no journal',
                async () => {
                    const current = await inspect(untouched);
                    assert.equal(current.hash, original.hash);
                    assert.equal(current.journal, null);
                },
            );
        } finally {
            const evidenceFile = path.join(
                path.dirname(lab),
                match ? 'test-evidence-followup.json' : 'test-evidence.json',
            );
            await atomicJson(evidenceFile, {
                scope: 'owned-synthetic-mysql-only',
                results,
                productionReady: false,
            });
            await stopLab(lab);
            process.stdout.write(`Owned MySQL evidence: ${evidenceFile}\n`);
        }
    },
);
