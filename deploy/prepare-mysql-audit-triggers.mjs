#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const auditTable = 'administrator_permission_audit';
const message = 'Administrator permission audit is append-only';
const triggerOperations = new Map([
    ['administrator_permission_audit_no_delete', 'DELETE'],
    ['administrator_permission_audit_no_update', 'UPDATE'],
]);
const safeDatabaseName = /^[A-Za-z0-9_$-]+$/u;

export function triggerSql(name, operation, databaseName) {
    if (triggerOperations.get(name) !== operation) throw new Error('Unexpected audit trigger definition');
    if (!safeDatabaseName.test(databaseName)) {
        throw new Error('The production MySQL database name could not be validated safely');
    }
    return [
        `CREATE TRIGGER IF NOT EXISTS \`${databaseName}\`.\`${name}\``,
        `BEFORE ${operation} ON \`${databaseName}\`.\`${auditTable}\``,
        `FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}'`,
    ].join(' ');
}

export function validateTriggerRows(rows) {
    if (rows.length !== triggerOperations.size) {
        throw new Error('The production administrator audit triggers are incomplete');
    }
    for (const row of rows) validateTriggerDefinition(row);
}

function validateTriggerDefinition(row) {
    const operation = triggerOperations.get(row.name);
    const statement = String(row.statement || '')
        .replace(/\s+/gu, ' ')
        .trim();
    const expectedStatement = `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}'`;
    if (
        !operation ||
        row.timing !== 'BEFORE' ||
        row.event !== operation ||
        row.tableName !== auditTable ||
        statement !== expectedStatement
    ) {
        throw new Error('An existing production administrator audit trigger is not the reviewed guard');
    }
}

function mysqlRootQuery(sql) {
    const result = spawnSync(
        'sudo',
        [
            '-n',
            'mysql',
            '--protocol=socket',
            '--user=root',
            '--batch',
            '--raw',
            '--skip-column-names',
            `--execute=${sql}`,
        ],
        { encoding: 'utf8', shell: false },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('The local root MySQL audit trigger preparation failed');
    return String(result.stdout || '').trim();
}

function inspectTriggers(databaseName) {
    const names = [...triggerOperations.keys()].map(name => `'${name}'`).join(', ');
    const output = mysqlRootQuery(
        [
            'SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION,',
            'EVENT_OBJECT_TABLE, ACTION_STATEMENT FROM information_schema.TRIGGERS',
            `WHERE TRIGGER_SCHEMA = '${databaseName}' AND TRIGGER_NAME IN (${names})`,
            'ORDER BY TRIGGER_NAME',
        ].join(' '),
    );
    if (!output) return [];
    return output.split(/\r?\n/u).map(line => {
        const [name, timing, event, tableName, statement] = line.split('\t');
        return { name, timing, event, tableName, statement };
    });
}

function createAndVerifyAuditTriggers(environment = process.env) {
    if (environment.DB !== 'mysql') throw new Error('The production audit trigger guard requires MySQL');
    if (!['127.0.0.1', 'localhost', '::1'].includes(environment.DB_HOST)) {
        throw new Error('The production audit trigger guard requires the reviewed local MySQL topology');
    }
    if (!safeDatabaseName.test(environment.DB_NAME || '')) {
        throw new Error('The production MySQL database name could not be validated safely');
    }
    const before = inspectTriggers(environment.DB_NAME);
    for (const row of before) {
        if (triggerOperations.has(row.name)) validateTriggerDefinition(row);
    }
    for (const [name, operation] of triggerOperations) {
        if (!before.some(row => row.name === name)) {
            mysqlRootQuery(triggerSql(name, operation, environment.DB_NAME));
        }
    }
    const after = inspectTriggers(environment.DB_NAME);
    validateTriggerRows(after);
    process.stdout.write(
        `MYSQL_AUDIT_TRIGGERS_PREPARED created=${triggerOperations.size - before.length} verified=${after.length}\n`,
    );
}

function runMigrations(candidate, environment = process.env) {
    const releasesRoot = '/var/www/kaiyuangouwu-releases/';
    const resolvedCandidate = path.resolve(candidate);
    if (!resolvedCandidate.startsWith(releasesRoot) || !statSync(resolvedCandidate).isDirectory()) {
        throw new Error('The migration candidate is outside the immutable production release directory');
    }
    createAndVerifyAuditTriggers(environment);
    const result = spawnSync(process.execPath, ['packages/dev-server/dist/run-migrations.js'], {
        cwd: resolvedCandidate,
        env: environment,
        stdio: 'inherit',
        shell: false,
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

function main() {
    if (process.argv[2] !== 'run-migrations' || !process.argv[3] || process.argv.length !== 4) {
        throw new Error('Usage: prepare-mysql-audit-triggers.mjs run-migrations <immutable-candidate>');
    }
    process.exitCode = runMigrations(process.argv[3]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `MYSQL_AUDIT_TRIGGER_PREPARATION_FAILED reason=${error?.message || 'unknown'}\n`,
        );
        process.exitCode = 1;
    }
}
