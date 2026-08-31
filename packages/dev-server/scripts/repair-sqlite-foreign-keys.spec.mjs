import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
    inspectSqliteForeignKeys,
    parseCliArguments,
    repairSqliteForeignKeys,
    repairableRelations,
} from './repair-sqlite-foreign-keys.mjs';

const temporaryDirectories = [];

function createTemporaryDirectory() {
    const directory = mkdtempSync(path.join(tmpdir(), 'vendure-fk-repair-'));
    temporaryDirectories.push(directory);
    return directory;
}

function createFixture({ includeUnexpectedViolation = false } = {}) {
    const directory = createTemporaryDirectory();
    const databasePath = path.join(directory, 'vendure.sqlite');
    const database = new Database(databasePath);
    database.pragma('foreign_keys = OFF');

    for (const relation of repairableRelations) {
        database.exec(`
            CREATE TABLE "${relation.parentTable}" (
                id INTEGER PRIMARY KEY
            );
            CREATE TABLE "${relation.childTable}" (
                id INTEGER PRIMARY KEY,
                baseId INTEGER,
                locale TEXT,
                FOREIGN KEY (baseId) REFERENCES "${relation.parentTable}" (id) ON DELETE CASCADE
            );
            INSERT INTO "${relation.parentTable}" (id) VALUES (1);
            INSERT INTO "${relation.childTable}" (id, baseId, locale) VALUES
                (1, 1, 'en'),
                (2, 2, 'zh_Hans');
        `);
    }

    if (includeUnexpectedViolation) {
        database.exec(`
            CREATE TABLE unexpected_parent (id INTEGER PRIMARY KEY);
            CREATE TABLE unexpected_child (
                id INTEGER PRIMARY KEY,
                parentId INTEGER,
                FOREIGN KEY (parentId) REFERENCES unexpected_parent (id)
            );
            INSERT INTO unexpected_child (id, parentId) VALUES (1, 999);
        `);
    }

    database.close();
    return { directory, databasePath };
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('parseCliArguments', () => {
    it('requires exactly one supported mode', () => {
        assert.deepEqual(parseCliArguments(['--dry-run']), { apply: false });
        assert.deepEqual(parseCliArguments(['--apply']), { apply: true });
        assert.throws(() => parseCliArguments([]), /exactly one/);
        assert.throws(() => parseCliArguments(['--dry-run', '--apply']), /exactly one/);
        assert.throws(() => parseCliArguments(['--force']), /Unsupported/);
    });
});

describe('repairSqliteForeignKeys', () => {
    it('reports the exact whitelist plan without changing data in dry-run mode', async () => {
        const { directory, databasePath } = createFixture();
        const backupPath = path.join(directory, 'unused-backup.sqlite');

        const result = await repairSqliteForeignKeys({ databasePath, backupPath, apply: false });

        assert.equal(result.mode, 'dry-run');
        assert.equal(result.before.total, repairableRelations.length);
        assert.equal(result.before.repairableTotal, repairableRelations.length);
        assert.deepEqual(result.before.unexpected, []);
        assert.equal(result.backupPath, undefined);
        assert.equal(existsSync(backupPath), false);

        const database = new Database(databasePath, { readonly: true });
        assert.equal(inspectSqliteForeignKeys(database).total, repairableRelations.length);
        for (const relation of repairableRelations) {
            assert.equal(
                database.prepare(`SELECT COUNT(*) AS count FROM "${relation.childTable}"`).get().count,
                2,
            );
        }
        database.close();
    });

    it('backs up, removes only orphan translations, verifies zero violations, and is idempotent', async () => {
        const { directory, databasePath } = createFixture();
        const backupPath = path.join(directory, 'before-repair.sqlite');

        const result = await repairSqliteForeignKeys({ databasePath, backupPath, apply: true });

        assert.equal(result.before.total, repairableRelations.length);
        assert.equal(result.after.total, 0);
        assert.equal(
            result.deleted.reduce((total, item) => total + item.count, 0),
            repairableRelations.length,
        );
        assert.equal(existsSync(backupPath), true);

        const repairedDatabase = new Database(databasePath, { readonly: true });
        assert.equal(inspectSqliteForeignKeys(repairedDatabase).total, 0);
        for (const relation of repairableRelations) {
            assert.deepEqual(
                repairedDatabase.prepare(`SELECT id, baseId FROM "${relation.childTable}" ORDER BY id`).all(),
                [{ id: 1, baseId: 1 }],
            );
        }
        repairedDatabase.close();

        const backupDatabase = new Database(backupPath, { readonly: true });
        assert.equal(inspectSqliteForeignKeys(backupDatabase).total, repairableRelations.length);
        backupDatabase.close();

        const unusedSecondBackup = path.join(directory, 'second-backup.sqlite');
        const secondResult = await repairSqliteForeignKeys({
            databasePath,
            backupPath: unusedSecondBackup,
            apply: true,
        });
        assert.equal(secondResult.before.total, 0);
        assert.equal(secondResult.after.total, 0);
        assert.equal(existsSync(unusedSecondBackup), false);
    });

    it('refuses unexpected violations before creating a backup or deleting rows', async () => {
        const { directory, databasePath } = createFixture({ includeUnexpectedViolation: true });
        const backupPath = path.join(directory, 'must-not-exist.sqlite');

        await assert.rejects(
            repairSqliteForeignKeys({ databasePath, backupPath, apply: true }),
            /outside the whitelist/,
        );
        assert.equal(existsSync(backupPath), false);

        const database = new Database(databasePath, { readonly: true });
        const inspection = inspectSqliteForeignKeys(database);
        assert.equal(inspection.total, repairableRelations.length + 1);
        assert.equal(inspection.unexpected.length, 1);
        for (const relation of repairableRelations) {
            assert.equal(
                database.prepare(`SELECT COUNT(*) AS count FROM "${relation.childTable}"`).get().count,
                2,
            );
        }
        database.close();
    });
});
