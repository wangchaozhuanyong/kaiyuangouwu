import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomicJson, connectCase, CONTROL, mysqlInventory } from './store-isolation-mysql-lab.mjs';
import {
    assertOwnership,
    canonical,
    digest,
    projectChanges,
    protectedSummary,
    quote,
} from './store-isolation-rehearsal.mjs';

async function readReceipt(filename, manifestSha256) {
    try {
        const stat = await lstat(filename);
        assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Invalid receipt file');
        assert.equal(stat.mode % 0o1000, 0o600);
        const value = JSON.parse(await readFile(filename, 'utf8'));
        assert.equal(value.manifestSha256, manifestSha256, 'Receipt belongs to another migration');
        assert.ok(
            ['prepared-apply', 'prepared-rollback', 'applied', 'rolled-back'].includes(value.status),
            'Unknown receipt state',
        );
        // File state is advisory. Database journal + complete live inventory always decide recovery.
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

export async function executeMysqlCase(filename, mode = 'preview', { phase = async () => undefined } = {}) {
    assert.ok(['preview', 'apply', 'rollback'].includes(mode), 'No production mode is supported');
    const { connection, manifest, blueprint } = await connectCase(filename);
    const manifestSha256 = digest(manifest);
    const receiptFile = path.join(path.dirname(filename), 'receipt.json');
    const lockName = `vendure-lab:${manifest.runId}:${manifest.caseId}`;
    let locked = false;
    let transaction = false;
    let schemaLocked = false;
    try {
        const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
        assert.equal(lock.acquired, 1, 'Migration already running');
        locked = true;
        await readReceipt(receiptFile, manifestSha256);
        // Also blocks a new reference table appearing after inventory. This is the owned lab instance only.
        await connection.query('LOCK INSTANCE FOR BACKUP');
        schemaLocked = true;
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        await connection.beginTransaction();
        transaction = true;
        const [[registration]] = await connection.execute(
            `SELECT manifest_hash FROM ${quote(CONTROL)}.cases WHERE case_id=? FOR UPDATE`,
            [manifest.caseId],
        );
        assert.equal(registration?.manifest_hash, manifestSha256, 'Manifest registration drift');
        const [journals] = await connection.execute(
            `SELECT * FROM ${quote(CONTROL)}.journal WHERE case_id=? FOR UPDATE`,
            [manifest.caseId],
        );
        const state = await mysqlInventory(connection, true);
        const schemaHash = digest(
            Object.fromEntries(Object.entries(state).map(([table, value]) => [table, value.schema])),
        );
        assert.equal(schemaHash, manifest.schemaSha256, 'Unknown or changed schema');
        assert.deepEqual(Object.keys(state).sort(), Object.keys(blueprint).sort(), 'Unreviewed table');
        const before = Object.fromEntries(
            Object.entries(state).map(([table, value]) => [
                table,
                {
                    schema: value.schema,
                    rows: structuredClone(blueprint[table].rows).sort((a, b) =>
                        JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))),
                    ),
                },
            ]),
        );
        assert.equal(digest(before), manifest.sourceSha256, 'Unreviewed baseline');
        const after = projectChanges(before, manifest.operations);
        assert.equal(digest(after), manifest.afterSha256, 'Unreviewed projection');
        assertOwnership(after);
        const journal = journals[0];
        if (journal) {
            assert.equal(journal.manifest_hash, manifestSha256, 'Journal manifest drift');
            assert.equal(journal.before_hash, manifest.sourceSha256, 'Journal baseline drift');
            assert.equal(journal.after_hash, manifest.afterSha256, 'Journal projection drift');
            assert.equal(journal.apply_count, 1, 'Invalid apply count');
            assert.ok(['applied', 'rolled-back'].includes(journal.status), 'Invalid journal state');
            assert.equal(
                journal.rollback_count,
                journal.status === 'rolled-back' ? 1 : 0,
                'Invalid rollback count',
            );
        }
        const expectedHash = journal?.status === 'applied' ? manifest.afterSha256 : manifest.sourceSha256;
        assert.equal(
            digest(state),
            expectedHash,
            'Database state differs from durable journal; refusing drift',
        );
        const result = {
            mode,
            manifestSha256,
            beforeSha256: manifest.sourceSha256,
            afterSha256: manifest.afterSha256,
            status: journal?.status ?? 'not-applied',
            plannedUpdates: manifest.operations.length,
            updatedRows: 0,
            databaseChanged: false,
            productionReady: false,
            protected: protectedSummary(state),
        };
        await phase('locked');
        if (mode === 'preview') {
            await connection.rollback();
            transaction = false;
            return result;
        }
        const noOp = mode === 'apply' ? Boolean(journal) : journal?.status === 'rolled-back';
        if (noOp) {
            await connection.rollback();
            transaction = false;
            result.status = `already-${journal.status}`;
            await atomicJson(receiptFile, { manifestSha256, status: journal.status });
            return result;
        }
        assert.ok(
            mode !== 'rollback' || journal?.status === 'applied',
            'No committed migration to roll back',
        );
        await atomicJson(receiptFile, { manifestSha256, status: `prepared-${mode}` });
        const reverse = mode === 'rollback';
        const operations = reverse ? [...manifest.operations].reverse() : manifest.operations;
        for (const [index, op] of operations.entries()) {
            const key = { ...op.key };
            if (reverse && Object.hasOwn(key, op.column)) key[op.column] = op.after;
            const where = [
                ...Object.keys(key).map(name => `${quote(name)} = ?`),
                `${quote(op.column)} = ?`,
            ].join(' AND ');
            const [update] = await connection.execute(
                `UPDATE ${quote(op.table)} SET ${quote(op.column)} = ? WHERE ${where}`,
                [reverse ? op.before : op.after, ...Object.values(key), reverse ? op.after : op.before],
            );
            assert.equal(update.affectedRows, 1, 'Expected exactly one changed row');
            await phase(`after-write-${index + 1}`);
        }
        const expected = reverse ? before : after;
        const actual = await mysqlInventory(connection, true);
        assert.deepEqual(actual, expected, 'Exact row/field conservation failed');
        assert.deepEqual(protectedSummary(actual), protectedSummary(before), 'Protected data changed');
        const status = reverse ? 'rolled-back' : 'applied';
        if (reverse) {
            const [update] = await connection.execute(
                `UPDATE ${quote(CONTROL)}.journal SET status='rolled-back',rollback_count=1
                 WHERE case_id=? AND manifest_hash=? AND status='applied' AND rollback_count=0`,
                [manifest.caseId, manifestSha256],
            );
            assert.equal(update.affectedRows, 1, 'Rollback journal guard failed');
        } else
            await connection.execute(
                `INSERT INTO ${quote(CONTROL)}.journal VALUES (?,?,?,?, 'applied',1,0)`,
                [manifest.caseId, manifestSha256, manifest.sourceSha256, manifest.afterSha256],
            );
        await phase('before-commit');
        await connection.commit();
        transaction = false;
        await phase('after-commit');
        await atomicJson(receiptFile, { manifestSha256, status });
        return {
            ...result,
            status,
            updatedRows: operations.length,
            databaseChanged: true,
            actualSha256: digest(actual),
            protected: protectedSummary(actual),
        };
    } finally {
        if (transaction) await connection.rollback().catch(() => undefined);
        if (schemaLocked) await connection.query('UNLOCK INSTANCE').catch(() => undefined);
        if (locked) await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
        await connection.end();
    }
}

async function main() {
    const args = process.argv.slice(2);
    assert.equal(args[0], '--case', 'Use --case <owned-case.json> [--apply|--rollback]');
    const filename = args[1];
    const mode = args[2] === '--apply' ? 'apply' : args[2] === '--rollback' ? 'rollback' : 'preview';
    const extra = args.slice(mode === 'preview' ? 2 : 3);
    // Faults are only for this owned synthetic entry point. No external database or arbitrary SQL argument exists.
    assert.ok(
        extra.length === 0 || (extra.length === 2 && ['--crash-at', '--pause-at'].includes(extra[0])),
        'Unknown argument',
    );
    const fault = extra[1];
    if (fault) assert.match(fault, /^(locked|before-commit|after-commit|after-write-([1-9]|1[0-9]|2[01]))$/u);
    const result = await executeMysqlCase(filename, mode, {
        phase: async name => {
            if (name !== fault) return;
            if (extra[0] === '--crash-at') process.kill(process.pid, 'SIGKILL');
            else {
                assert.ok(process.send, 'Pause requires a local test IPC channel');
                process.send({ phase: name });
                await new Promise(resolve =>
                    process.once('message', message => {
                        assert.equal(message, 'continue');
                        resolve();
                    }),
                );
            }
        },
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(() => {
        process.stderr.write('Owned synthetic MySQL operation rejected; no external target is accepted.\n');
        process.exitCode = 1;
    });
