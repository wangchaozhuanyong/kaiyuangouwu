#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const tableName = 'referral_poster_template';

export function analyzePosterDefaults(output, expected) {
    const rows = new Map();
    for (const line of output.split(/\r?\n/u).filter(Boolean)) {
        const parts = line.split('\t');
        if (parts.length !== 2 || rows.has(parts[0])) throw new Error('Invalid poster default audit row');
        const [name, hex] = parts;
        if (!/^(?:[0-9A-F]{2})*$/iu.test(hex)) throw new Error(`Invalid default encoding: ${name}`);
        rows.set(name, Buffer.from(hex, 'hex').toString('utf8'));
    }
    const expectedNames = Object.keys(expected).sort();
    if (rows.size !== expectedNames.length || expectedNames.some(name => !rows.has(name))) {
        throw new Error(`Expected ${expectedNames.length} poster copy column defaults; found ${rows.size}`);
    }
    const columns = expectedNames.map(name => ({
        name,
        current: rows.get(name),
        target: expected[name],
        changeRequired: rows.get(name) !== expected[name],
    }));
    const baselineSha256 = createHash('sha256')
        .update(JSON.stringify(columns.map(({ name, current }) => [name, current])))
        .digest('hex');
    const targetSha256 = createHash('sha256')
        .update(JSON.stringify(columns.map(({ name, target }) => [name, target])))
        .digest('hex');
    return {
        table: tableName,
        inspectedColumns: columns.length,
        changedDefaults: columns.filter(column => column.changeRequired).length,
        baselineSha256,
        targetSha256,
        columns,
    };
}

export async function auditProduction(
    environment = process.env,
    {
        loadExpected = async () =>
            (await import('../packages/store-management-plugin/dist/referral/referral-poster-presets.js'))
                .referralPosterCopy,
        runQuery = spawnSync,
    } = {},
) {
    const referralPosterCopy = await loadExpected();
    const fields = Object.keys(referralPosterCopy);
    const query = [
        'SELECT COLUMN_NAME, HEX(COLUMN_DEFAULT)',
        'FROM information_schema.COLUMNS',
        `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'`,
        `AND COLUMN_NAME IN (${fields.map(name => `'${name}'`).join(', ')})`,
        'ORDER BY COLUMN_NAME',
    ].join(' ');
    if (environment.DB !== 'mysql' || !['127.0.0.1', 'localhost', '::1'].includes(environment.DB_HOST)) {
        throw new Error('Poster default audit requires the reviewed local MySQL topology');
    }
    if (!/^[A-Za-z0-9_$-]+$/u.test(environment.DB_NAME || '')) {
        throw new Error('Invalid database name');
    }
    if (
        !/^\d{1,5}$/u.test(environment.DB_PORT || '') ||
        !environment.DB_USERNAME ||
        !environment.DB_PASSWORD
    ) {
        throw new Error('Database connection settings are incomplete');
    }
    const result = runQuery(
        'mysql',
        [
            `--host=${environment.DB_HOST}`,
            `--port=${environment.DB_PORT}`,
            `--user=${environment.DB_USERNAME}`,
            '--batch',
            '--raw',
            '--skip-column-names',
            `--execute=${query}`,
            `--database=${environment.DB_NAME}`,
        ],
        {
            encoding: 'utf8',
            shell: false,
            env: { ...environment, MYSQL_PWD: environment.DB_PASSWORD },
        },
    );
    if (result.error || result.status !== 0) throw new Error('Read-only MySQL poster default audit failed');
    return analyzePosterDefaults(result.stdout, referralPosterCopy);
}

if (process.argv[1]?.endsWith('/audit-referral-poster-defaults.mjs')) {
    try {
        process.stdout.write(`${JSON.stringify(await auditProduction())}\n`);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
