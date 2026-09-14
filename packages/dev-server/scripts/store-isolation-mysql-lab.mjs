import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
    approvedOperations,
    assertOwnership,
    canonical,
    digest,
    projectChanges,
    quote,
    syntheticFixtureState,
} from './store-isolation-rehearsal.mjs';

const exec = promisify(execFile);
export const labRoot = fileURLToPath(
    new URL('../../../reports/pending-migrations-20260913/', import.meta.url),
);
const IMAGE = 'sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb';
const PURPOSE = 'vendure-owned-synthetic-migration-lab-v1';
const CONTROL = 'rehearsal_control';
const label = 'codex.vendure.rehearsal';
const idPattern = /^[a-f0-9]{16}$/u;
let pinnedEndpoint;

async function docker(...args) {
    const contextRead = args[0] === 'context' && args[1] === 'inspect';
    assert.ok(contextRead || pinnedEndpoint, 'Docker endpoint must be verified first');
    const command = contextRead ? args : ['--host', pinnedEndpoint, ...args];
    return (await exec('docker', command, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
}
async function localDocker() {
    const endpoint = await docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}');
    assert.ok(endpoint.startsWith('unix:///'), 'Only a local Unix Docker socket is permitted');
    // Explicit host prevents ambient DOCKER_HOST/context overrides from changing subsequent operations.
    assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT, 'Ambient Docker override rejected');
    if (pinnedEndpoint) assert.equal(endpoint, pinnedEndpoint, 'Docker endpoint changed during this process');
    pinnedEndpoint = endpoint;
    return endpoint;
}
export async function atomicJson(filename, value) {
    const temp = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
    const handle = await open(temp, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
        await handle.sync();
    } finally {
        await handle.close();
    }
    await rename(temp, filename);
    const directory = await open(path.dirname(filename), 'r');
    try {
        await directory.sync();
    } finally {
        await directory.close();
    }
}
async function ownedFile(filename, basename) {
    assert.ok(path.isAbsolute(filename), 'Absolute owned lab path required');
    assert.equal(path.basename(filename), basename, 'Unexpected lab file');
    assert.equal(await realpath(filename), filename, 'Symlinks are not accepted');
    const root = await realpath(labRoot);
    const relative = path.relative(root, filename).split(path.sep);
    assert.match(relative[0], /^mysql-[a-f0-9]{16}$/u, 'Not an owned lab directory');
    assert.ok(relative.length === (basename === 'lab.json' ? 2 : 3), 'Unexpected lab nesting');
    assert.equal((await lstat(filename)).mode % 0o1000, 0o600, 'Lab files must be private');
    return JSON.parse(await readFile(filename, 'utf8'));
}
export async function verifyLab(filename) {
    const descriptor = await ownedFile(filename, 'lab.json');
    assert.equal(descriptor.purpose, PURPOSE);
    assert.match(descriptor.runId, idPattern);
    assert.equal(path.dirname(filename), path.join(await realpath(labRoot), `mysql-${descriptor.runId}`));
    assert.equal(descriptor.endpoint, await localDocker(), 'Docker endpoint changed');
    assert.equal(descriptor.image, IMAGE);
    assert.match(descriptor.containerId, /^[a-f0-9]{64}$/u);
    const [container] = JSON.parse(await docker('inspect', descriptor.containerId));
    assert.equal(container.Id, descriptor.containerId);
    assert.equal(container.Image, IMAGE, 'Container image changed');
    assert.equal(container.Config.Labels[label], descriptor.runId, 'Unowned container');
    assert.equal(container.Config.Labels[`${label}.purpose`], PURPOSE);
    assert.equal(container.State.Running, true, 'Owned container is not running');
    assert.equal(container.HostConfig.Privileged, false);
    assert.deepEqual(container.HostConfig.RestartPolicy, { Name: 'no', MaximumRetryCount: 0 });
    assert.equal(container.Mounts.length, 1, 'Unexpected container mounts');
    assert.equal(container.Mounts[0].Type, 'bind');
    assert.equal(container.Mounts[0].Source, path.join(path.dirname(filename), 'data'));
    assert.equal(container.Mounts[0].Destination, '/var/lib/mysql');
    assert.equal(descriptor.transport, 'owned-container-stdio');
    assert.deepEqual(container.HostConfig.PortBindings, {}, 'Published ports are forbidden');
    assert.ok(
        Object.values(container.NetworkSettings.Ports).every(value => value === null || value.length === 0),
    );
    assert.equal(Object.keys(container.NetworkSettings.Networks).length, 1);
    const [network] = JSON.parse(await docker('network', 'inspect', descriptor.networkId));
    assert.equal(network.Internal, true, 'Lab network must have no external routing');
    assert.equal(network.Labels[label], descriptor.runId);
    assert.equal(Object.values(container.NetworkSettings.Networks)[0].NetworkID, network.Id);
    assert.deepEqual(
        Object.keys(network.Containers),
        [descriptor.containerId],
        'Unexpected network participant',
    );
    return descriptor;
}
async function openTransport(descriptor, database) {
    const { createConnection } = await import('mysql2/promise');
    const relay = spawn(
        'docker',
        [
            '--host',
            descriptor.endpoint,
            'exec',
            '-i',
            descriptor.containerId,
            'bash',
            '-c',
            'exec 3<>/dev/tcp/127.0.0.1/3306 || exit 1; cat <&3 & reader=$!; cat >&3; kill "$reader" 2>/dev/null; wait',
        ],
        { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const stream = Duplex.from({ readable: relay.stdout, writable: relay.stdin });
    relay.once('error', error => stream.destroy(error));
    stream.once('close', () => relay.kill());
    try {
        const connection = await createConnection({
            stream,
            user: 'root',
            password: '',
            database,
            connectTimeout: 3000,
            multipleStatements: false,
            dateStrings: true,
            supportBigNumbers: true,
        });
        const end = connection.end.bind(connection);
        connection.end = async () => {
            try {
                await end();
            } finally {
                stream.end();
            }
        };
        return connection;
    } catch (error) {
        stream.destroy();
        relay.kill();
        throw error;
    }
}
async function connectDescriptor(descriptor, database) {
    const connection = await openTransport(descriptor, database);
    try {
        const [[identity]] = await connection.query('SELECT @@server_uuid AS uuid, DATABASE() AS db');
        assert.equal(identity.uuid, descriptor.serverUuid, 'MySQL instance identity changed');
        assert.equal(identity.db, database, 'Unexpected database');
        return connection;
    } catch (error) {
        await connection.end();
        throw error;
    }
}
export async function createLab() {
    const endpoint = await localDocker();
    assert.equal(await docker('image', 'inspect', IMAGE, '--format', '{{.Id}}'), IMAGE);
    await mkdir(labRoot, { recursive: true });
    const runId = randomBytes(8).toString('hex');
    const directory = path.join(await realpath(labRoot), `mysql-${runId}`);
    await mkdir(directory, { mode: 0o700 });
    await mkdir(path.join(directory, 'data'), { mode: 0o700 });
    const networkId = await docker(
        'network',
        'create',
        '--internal',
        '--label',
        `${label}=${runId}`,
        `vendure-rehearsal-${runId}`,
    );
    const containerId = await docker(
        'run',
        '--detach',
        '--pull=never',
        '--restart=no',
        '--name',
        `vendure-rehearsal-${runId}`,
        '--label',
        `${label}=${runId}`,
        '--label',
        `${label}.purpose=${PURPOSE}`,
        '--network',
        networkId,
        '--mount',
        `type=bind,source=${path.join(directory, 'data')},target=/var/lib/mysql`,
        '--env',
        'MYSQL_ALLOW_EMPTY_PASSWORD=yes',
        IMAGE,
    );
    const descriptor = {
        format: 1,
        purpose: PURPOSE,
        endpoint,
        runId,
        directory,
        image: IMAGE,
        networkId,
        containerId,
        transport: 'owned-container-stdio',
        serverUuid: null,
    };
    // No environment files or project credentials are read. Empty authentication is restricted to this new synthetic lab.
    let connection;
    const deadline = Date.now() + 45000;
    for (let attempt = 0; attempt < 45 && Date.now() < deadline; attempt++) {
        try {
            connection = await openTransport(descriptor);
            break;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    if (!connection) {
        await docker('stop', '--timeout', '10', containerId);
        await atomicJson(path.join(directory, 'startup-failure.json'), {
            containerId,
            stopped: true,
            dataPreserved: true,
        });
        throw new Error('Owned MySQL lab startup timed out');
    }
    try {
        const [[row]] = await connection.query('SELECT @@server_uuid AS uuid');
        descriptor.serverUuid = row.uuid;
        await connection.query(`CREATE DATABASE ${quote(CONTROL)}`);
        await connection.query(
            `CREATE TABLE ${quote(CONTROL)}.cases (case_id VARCHAR(16) PRIMARY KEY, manifest_hash CHAR(64) NOT NULL) ENGINE=InnoDB`,
        );
        await connection.query(`CREATE TABLE ${quote(CONTROL)}.journal (case_id VARCHAR(16) PRIMARY KEY, manifest_hash CHAR(64) NOT NULL,
            before_hash CHAR(64) NOT NULL, after_hash CHAR(64) NOT NULL, status ENUM('applied','rolled-back') NOT NULL,
            apply_count INT NOT NULL, rollback_count INT NOT NULL, FOREIGN KEY (case_id) REFERENCES cases(case_id)) ENGINE=InnoDB`);
    } catch (error) {
        await docker('stop', '--timeout', '10', containerId);
        throw error;
    } finally {
        await connection.end();
    }
    const filename = path.join(directory, 'lab.json');
    await atomicJson(filename, descriptor);
    await verifyLab(filename);
    return filename;
}
export async function stopLab(filename) {
    const descriptor = await verifyLab(filename);
    await docker('stop', '--timeout', '10', descriptor.containerId);
    await atomicJson(path.join(path.dirname(filename), 'stopped.json'), {
        containerId: descriptor.containerId,
        stopped: true,
        dataPreserved: true,
    });
}

const references = {
    customerId: 'customer',
    inviterCustomerId: 'customer',
    inviteeCustomerId: 'customer',
    channelId: 'channel',
    userId: 'user',
    ownerId: 'user',
    countryId: 'region',
    orderId: 'order',
    activeOrderId: 'order',
    lockedOrderId: 'order',
    usedOrderId: 'order',
    activeChannelId: 'channel',
    productVariantId: 'product_variant',
    productId: 'product',
    stockLocationId: 'stock_location',
    orderLineId: 'order_line',
    referralAccountId: 'referral_account',
    walletId: 'referral_wallet',
    refundId: 'refund',
    withdrawalId: 'referral_withdrawal',
    paymentMethodId: 'payment_method',
    shippingMethodId: 'shipping_method',
    customerCouponId: 'customer_coupon',
    promotionId: 'promotion',
    campaignConfigId: 'store_coupon_campaign_config',
    customerGroupId: 'customer_group',
    administratorId: 'administrator',
    apiKeyId: 'api_key',
    roleId: 'role',
};
export async function mysqlBlueprint() {
    const state = await syntheticFixtureState();
    for (const [table, ids] of [
        ['product', [501]],
        ['promotion', [1, 2]],
        ['store_coupon_campaign_config', [1, 2]],
        ['refund', []],
    ])
        state[table] = { schema: `CREATE TABLE ${table} (id INTEGER)`, rows: ids.map(id => ({ id })) };
    const tables = {};
    for (const [table, value] of Object.entries(state)) {
        const columns = value.schema
            .slice(value.schema.indexOf('(') + 1, value.schema.lastIndexOf(')'))
            .split(',')
            .map(part => {
                const match = part.trim().match(/^(\w+)\s+(INTEGER|TEXT)\b/u);
                assert.ok(match, 'Unrecognized fixed synthetic column');
                const [, name, type] = match;
                return {
                    name,
                    type: type === 'INTEGER' ? 'INT' : name === 'currencyCode' ? 'VARCHAR(32)' : 'LONGTEXT',
                };
            });
        const primary = columns.some(column => column.name === 'id')
            ? ['id']
            : columns.map(column => column.name);
        const unique =
            table === 'customer'
                ? [['userId']]
                : table === 'stock_level'
                  ? [['productVariantId', 'stockLocationId']]
                  : table === 'referral_wallet'
                    ? [['referralAccountId', 'currencyCode']]
                    : [];
        tables[table] = { columns, primary, unique, rows: value.rows };
    }
    return tables;
}
export async function mysqlInventory(connection, lock = false) {
    const [tables] = await connection.query(
        'SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME',
    );
    const result = {};
    for (const table of tables) {
        assert.equal(table.engine, 'InnoDB', 'Nontransactional or unknown table');
        const [rows] = await connection.query(
            `SELECT * FROM ${quote(table.name)}${lock ? ' FOR UPDATE' : ''}`,
        );
        const [[schema]] = await connection.query(`SHOW CREATE TABLE ${quote(table.name)}`);
        result[table.name] = {
            schema: schema['Create Table'],
            rows: rows
                .map(row => ({ ...row }))
                .sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b)))),
        };
    }
    return result;
}
export async function createCase(labFile) {
    const descriptor = await verifyLab(labFile);
    const caseId = randomBytes(8).toString('hex');
    const database = `case_${caseId}`;
    const connection = await connectDescriptor(descriptor, CONTROL);
    const blueprint = await mysqlBlueprint();
    try {
        await connection.query(`CREATE DATABASE ${quote(database)}`);
        await connection.query(`USE ${quote(database)}`);
        for (const [table, value] of Object.entries(blueprint)) {
            const definitions = value.columns.map(
                column =>
                    `${quote(column.name)} ${column.type}${value.primary.includes(column.name) ? ' NOT NULL' : ''}`,
            );
            definitions.push(`PRIMARY KEY (${value.primary.map(quote).join(',')})`);
            for (const columns of value.unique) definitions.push(`UNIQUE (${columns.map(quote).join(',')})`);
            await connection.query(`CREATE TABLE ${quote(table)} (${definitions.join(',')}) ENGINE=InnoDB`);
            for (const row of value.rows)
                await connection.execute(
                    `INSERT INTO ${quote(table)} (${Object.keys(row).map(quote).join(',')}) VALUES (${Object.keys(
                        row,
                    )
                        .map(() => '?')
                        .join(',')})`,
                    Object.values(row),
                );
        }
        for (const [table, value] of Object.entries(blueprint))
            for (const column of value.columns) {
                const target = references[column.name];
                if (column.name.endsWith('Id'))
                    assert.ok(
                        target ||
                            (table === 'api_key' && column.name === 'ownerId' && value.rows.length === 0),
                        'Unknown fixture reference',
                    );
                if (target)
                    await connection.query(
                        `ALTER TABLE ${quote(table)} ADD FOREIGN KEY (${quote(column.name)}) REFERENCES ${quote(target)} (id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
                    );
            }
        const before = await mysqlInventory(connection);
        const after = projectChanges(before, approvedOperations());
        assertOwnership(after);
        const manifest = {
            format: 1,
            scope: PURPOSE,
            runId: descriptor.runId,
            serverUuid: descriptor.serverUuid,
            caseId,
            database,
            blueprintSha256: digest(blueprint),
            schemaSha256: digest(
                Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value.schema])),
            ),
            sourceSha256: digest(before),
            afterSha256: digest(after),
            operations: approvedOperations(),
            productionReady: false,
        };
        await connection.execute(`INSERT INTO ${quote(CONTROL)}.cases VALUES (?, ?)`, [
            caseId,
            digest(manifest),
        ]);
        const directory = path.join(path.dirname(labFile), caseId);
        await mkdir(directory, { mode: 0o700 });
        const filename = path.join(directory, 'case.json');
        await atomicJson(filename, manifest);
        return filename;
    } finally {
        await connection.end();
    }
}
export async function connectCase(filename) {
    const manifest = await ownedFile(filename, 'case.json');
    assert.match(manifest.caseId, idPattern);
    assert.equal(path.basename(path.dirname(filename)), manifest.caseId);
    const descriptor = await verifyLab(path.join(path.dirname(path.dirname(filename)), 'lab.json'));
    assert.equal(manifest.scope, PURPOSE);
    assert.equal(manifest.database, `case_${manifest.caseId}`);
    assert.equal(manifest.runId, descriptor.runId);
    assert.equal(manifest.serverUuid, descriptor.serverUuid);
    assert.equal(manifest.productionReady, false);
    assert.deepEqual(manifest.operations, approvedOperations(), 'Unreviewed ownership mapping');
    const blueprint = await mysqlBlueprint();
    assert.equal(manifest.blueprintSha256, digest(blueprint), 'Fixture source changed');
    const connection = await connectDescriptor(descriptor, manifest.database);
    try {
        const [[record]] = await connection.execute(
            `SELECT manifest_hash FROM ${quote(CONTROL)}.cases WHERE case_id=?`,
            [manifest.caseId],
        );
        assert.equal(record?.manifest_hash, digest(manifest), 'Manifest registration mismatch');
        return { connection, manifest, blueprint };
    } catch (error) {
        await connection.end();
        throw error;
    }
}
export { CONTROL };
