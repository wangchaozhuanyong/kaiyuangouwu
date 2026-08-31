import Database from 'better-sqlite3';
import { config as loadEnv } from 'dotenv';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, '..');

loadEnv({ path: path.join(packageDirectory, '.env') });

export const repairableRelations = [
    {
        childTable: 'product_variant_translation',
        parentTable: 'product_variant',
        foreignKeyId: 0,
    },
    {
        childTable: 'facet_value_translation',
        parentTable: 'facet_value',
        foreignKeyId: 0,
    },
    {
        childTable: 'product_option_translation',
        parentTable: 'product_option',
        foreignKeyId: 0,
    },
    {
        childTable: 'product_option_group_translation',
        parentTable: 'product_option_group',
        foreignKeyId: 0,
    },
    {
        childTable: 'facet_translation',
        parentTable: 'facet',
        foreignKeyId: 0,
    },
];

function quoteIdentifier(identifier) {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function relationKey({ childTable, parentTable, foreignKeyId }) {
    return `${childTable}:${parentTable}:${foreignKeyId}`;
}

function normalizeViolation(violation) {
    return {
        childTable: violation.table,
        rowId: Number(violation.rowid),
        parentTable: violation.parent,
        foreignKeyId: Number(violation.fkid),
    };
}

function getOrphanRows(database, relation) {
    const childTable = quoteIdentifier(relation.childTable);
    const parentTable = quoteIdentifier(relation.parentTable);
    return database
        .prepare(
            `SELECT child.id, child.baseId
             FROM ${childTable} AS child
             WHERE child.baseId IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                   FROM ${parentTable} AS parent
                   WHERE parent.id = child.baseId
               )
             ORDER BY child.id`,
        )
        .all()
        .map(row => ({ id: Number(row.id), baseId: Number(row.baseId) }));
}

export function parseCliArguments(argumentsList) {
    const supportedArguments = new Set(['--dry-run', '--apply']);
    const unsupportedArguments = argumentsList.filter(argument => !supportedArguments.has(argument));
    if (unsupportedArguments.length > 0) {
        throw new Error(`Unsupported argument(s): ${unsupportedArguments.join(', ')}`);
    }

    const dryRun = argumentsList.includes('--dry-run');
    const apply = argumentsList.includes('--apply');
    if (dryRun === apply) {
        throw new Error('Pass exactly one of --dry-run or --apply.');
    }

    return { apply };
}

export function inspectSqliteForeignKeys(database) {
    const violations = database.pragma('foreign_key_check').map(normalizeViolation);
    const violationsByRelation = new Map();

    for (const violation of violations) {
        const key = relationKey(violation);
        const current = violationsByRelation.get(key) ?? [];
        current.push(violation);
        violationsByRelation.set(key, current);
    }

    const repairable = repairableRelations.map(relation => {
        const rows = getOrphanRows(database, relation);
        const pragmaRowIds = (violationsByRelation.get(relationKey(relation)) ?? [])
            .map(violation => violation.rowId)
            .sort((left, right) => left - right);
        const queriedRowIds = rows.map(row => row.id).sort((left, right) => left - right);

        assert.deepEqual(
            pragmaRowIds,
            queriedRowIds,
            `PRAGMA foreign_key_check did not match the orphan query for ${relation.childTable}`,
        );

        return {
            ...relation,
            count: rows.length,
            rows,
        };
    });

    const repairableKeys = new Set(repairableRelations.map(relationKey));
    const unexpected = violations.filter(violation => !repairableKeys.has(relationKey(violation)));

    return {
        total: violations.length,
        repairableTotal: repairable.reduce((total, relation) => total + relation.count, 0),
        repairable,
        unexpected,
    };
}

function deleteOrphans(database, relation) {
    const childTable = quoteIdentifier(relation.childTable);
    const parentTable = quoteIdentifier(relation.parentTable);
    return database
        .prepare(
            `DELETE FROM ${childTable}
             WHERE baseId IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1
                   FROM ${parentTable} AS parent
                   WHERE parent.id = ${childTable}.baseId
               )`,
        )
        .run().changes;
}

export async function repairSqliteForeignKeys({ databasePath, backupPath, apply }) {
    const resolvedDatabasePath = path.resolve(databasePath);
    if (!existsSync(resolvedDatabasePath)) {
        throw new Error(`SQLite database not found: ${resolvedDatabasePath}`);
    }
    if (apply && process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to repair SQLite foreign keys with NODE_ENV=production.');
    }

    const resolvedBackupPath = backupPath ? path.resolve(backupPath) : undefined;
    if (apply && !resolvedBackupPath) {
        throw new Error('A backupPath is required when applying the repair.');
    }
    if (apply && resolvedBackupPath === resolvedDatabasePath) {
        throw new Error('The backup path must be different from the database path.');
    }

    const database = new Database(resolvedDatabasePath, { readonly: !apply, fileMustExist: true });
    database.pragma('busy_timeout = 5000');

    try {
        const before = inspectSqliteForeignKeys(database);
        if (before.unexpected.length > 0) {
            throw new Error(
                `Refusing repair because ${before.unexpected.length} foreign-key violation(s) are outside the whitelist.`,
            );
        }

        if (!apply || before.total === 0) {
            return {
                mode: apply ? 'apply' : 'dry-run',
                databasePath: resolvedDatabasePath,
                backupPath: undefined,
                before,
                deleted: [],
                after: before,
            };
        }

        mkdirSync(path.dirname(resolvedBackupPath), { recursive: true });
        if (existsSync(resolvedBackupPath)) {
            throw new Error(`Backup path already exists: ${resolvedBackupPath}`);
        }
        await database.backup(resolvedBackupPath);

        database.pragma('foreign_keys = ON');
        const deleted = database
            .transaction(() => {
                const current = inspectSqliteForeignKeys(database);
                assert.deepEqual(
                    current,
                    before,
                    'Foreign-key violations changed before the repair transaction started.',
                );

                return current.repairable.map(relation => {
                    const deletedCount = deleteOrphans(database, relation);
                    assert.equal(
                        deletedCount,
                        relation.count,
                        `Deleted row count did not match the repair plan for ${relation.childTable}`,
                    );
                    return { childTable: relation.childTable, count: deletedCount };
                });
            })
            .immediate();

        const after = inspectSqliteForeignKeys(database);
        assert.equal(after.total, 0, 'Foreign-key violations remain after the repair.');

        return {
            mode: 'apply',
            databasePath: resolvedDatabasePath,
            backupPath: resolvedBackupPath,
            before,
            deleted,
            after,
        };
    } finally {
        database.close();
    }
}

function defaultDatabasePath() {
    const configuredName = process.env.DB_NAME?.trim();
    return path.resolve(packageDirectory, configuredName || 'vendure.sqlite');
}

function defaultBackupPath(databasePath) {
    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    return path.join(
        packageDirectory,
        'local-backups',
        `${path.basename(databasePath)}-before-fk-repair-${timestamp}.sqlite`,
    );
}

async function main() {
    if (process.env.DB !== 'sqlite') {
        throw new Error('Set DB=sqlite explicitly before running this SQLite-only repair.');
    }

    const { apply } = parseCliArguments(process.argv.slice(2));
    const databasePath = defaultDatabasePath();
    const result = await repairSqliteForeignKeys({
        databasePath,
        backupPath: apply ? defaultBackupPath(databasePath) : undefined,
        apply,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
