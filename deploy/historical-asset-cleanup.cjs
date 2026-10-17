'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

// Exact 95-image list reviewed in this task. No arbitrary IDs, paths or SQL input.
const TARGET_IDS = Object.freeze(
    [
        68, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 118, 119,
        120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 142, 143, 144, 145, 146, 147, 148, 149, 150,
        151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 353, 366,
        375, 388, 412, 419, 428, 486, 487, 488, 489, 491, 492, 493, 494, 495, 496, 497, 498, 502, 505, 506,
        508, 509, 510, 511, 512, 513, 514, 515, 516, 517,
    ].map(String),
);
const BACKUP_ROOT = '/var/www/kaiyuangouwu/backups/historical-asset-cleanup';
const LINKS = { asset_channels_channel: 'assetId', asset_tags_tag: 'assetId', asset_translation: 'baseId' };
const canon = value => {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(canon);
    if (value && typeof value === 'object')
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canon(value[key])]),
        );
    return typeof value === 'bigint' ? String(value) : value;
};
const digest = value =>
    createHash('sha256')
        .update(JSON.stringify(canon(value)))
        .digest('hex');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => {
    assert.match(value, /^[a-zA-Z][a-zA-Z0-9_]*$/u);
    return '`' + value + '`';
};
const marks = values => values.map(() => '?').join(',');
async function query(connection, sql, values = [], limit = 10000) {
    const [rows] = await connection.query(sql, values);
    assert.ok(Array.isArray(rows) && rows.length <= limit, 'ASSET_CLEANUP_READ_BUDGET');
    return rows;
}
function stems(asset) {
    return [
        ...new Set(
            [asset.source, asset.preview].flatMap(identifier => {
                const stem = path.posix
                    .basename(identifier)
                    .replace(/__webp_migrated_[0-9]+\.webp$/u, '')
                    .replace(/\.[a-z0-9]+$/iu, '');
                const needle =
                    stem.length >= 8 ? stem : path.posix.join(path.posix.dirname(identifier), stem);
                assert.ok(needle.length >= 8 && !needle.includes('\0'), 'ASSET_STEM_TOO_SHORT');
                return [needle, encodeURI(needle), encodeURIComponent(needle), needle.replaceAll('/', '\\/')];
            }),
        ),
    ];
}
function mediaColumn(table, column, type) {
    return (
        (/(?:asset|image|avatar|photo|logo|icon|media|attachment)/iu.test(column) ||
            /^(?:storefront_|store_|global_settings$|customer$|product$|product_variant$|product_translation$|collection_translation$|channel$|system_announcement$|after_sales_|customer_service_|fulfillment_delivery_)/u.test(
                table,
            )) &&
        !/(?:audit|event|visit|access_record|presence|notification|attribution|receipt)/u.test(table) &&
        /(?:char|text|json)/u.test(type) &&
        /(?:image|avatar|photo|asset|logo|icon|media|body|description|content|html|markdown|settings|source|config|template|customFields)/iu.test(
            column,
        ) &&
        !/(?:password|credential|secret|token|privateKey|apiKey)/iu.test(column)
    );
}
async function metadata(connection) {
    const columns = await query(
        connection,
        'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS type FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION',
        [],
        20000,
    );
    const foreignKeys = await query(
        connection,
        "SELECT TABLE_NAME AS t,COLUMN_NAME AS c FROM information_schema.key_column_usage WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='asset' AND REFERENCED_COLUMN_NAME='id' ORDER BY TABLE_NAME,COLUMN_NAME",
        [],
        200,
    );
    for (const [table, column] of Object.entries(LINKS))
        assert.ok(
            columns.some(row => row.t === table && row.c === column),
            'ASSET_METADATA_SCHEMA_MISSING',
        );
    assert.ok(
        columns.some(row => row.t === 'catalog_resource_ownership' && row.c === 'resourceId'),
        'ASSET_OWNERSHIP_SCHEMA_MISSING',
    );
    return { columns, foreignKeys };
}
async function rowsFor(connection, ids) {
    const data = {
        asset: await query(
            connection,
            `SELECT * FROM asset WHERE id IN (${marks(ids)}) ORDER BY id`,
            ids,
            95,
        ),
    };
    for (const [table, column] of Object.entries(LINKS))
        data[table] = await query(
            connection,
            `SELECT * FROM ${quote(table)} WHERE ${quote(column)} IN (${marks(ids)}) ORDER BY ${quote(column)}`,
            ids,
            2000,
        );
    // Stabilize join-row order without exporting row values in the public plan.
    for (const table of Object.keys(data))
        data[table].sort((a, b) => JSON.stringify(canon(a)).localeCompare(JSON.stringify(canon(b))));
    return data;
}
async function references(connection, assets, schema) {
    const reasons = new Map(assets.map(asset => [String(asset.id), []]));
    if (!assets.length) return { reasons, surfaceCount: 0, foreignKeyColumns: schema.foreignKeys.length };
    const add = (id, reason) => reasons.get(String(id))?.push(reason);
    const ids = assets.map(asset => String(asset.id));
    const owners = await query(
        connection,
        `SELECT resourceId FROM catalog_resource_ownership WHERE resourceType='Asset' AND resourceId IN (${marks(ids)})`,
        ids,
        95,
    );
    for (const row of owners) add(row.resourceId, { kind: 'REGISTERED_OWNERSHIP' });
    for (const ref of schema.foreignKeys) {
        if (LINKS[ref.t] === ref.c) continue;
        const rows = await query(
            connection,
            `SELECT /*+ MAX_EXECUTION_TIME(3000) */ ${quote(ref.c)} AS assetId,COUNT(*) AS n FROM ${quote(ref.t)} WHERE ${quote(ref.c)} IN (${marks(ids)}) GROUP BY ${quote(ref.c)}`,
            ids,
            95,
        );
        for (const row of rows)
            add(row.assetId, {
                kind: 'FOREIGN_KEY_REFERENCE',
                table: ref.t,
                column: ref.c,
                count: Number(row.n),
            });
    }
    const surfaces = schema.columns.filter(row => mediaColumn(row.t, row.c, row.type));
    assert.ok(surfaces.length <= 160, 'ASSET_MEDIA_SURFACE_BUDGET');
    // Keep each text/JSON cross join small without increasing the statement
    // time budget or omitting any candidate or media field.
    const batches = [];
    for (let offset = 0; offset < assets.length; offset += 8) batches.push(assets.slice(offset, offset + 8));
    for (const surface of surfaces) {
        const column = 'd.' + quote(surface.c);
        const json = `CASE WHEN JSON_VALID(${column}) THEN ${column} ELSE '{}' END`;
        const jsonIds = [
            'mobileImageAssetId',
            'desktopImageAssetId',
            'imageAssetId',
            'assetId',
            'logoAssetId',
            'avatarAssetId',
            'backgroundAssetId',
            'featuredAssetId',
            'coverAssetId',
            'iconAssetId',
        ].map(key => `JSON_UNQUOTE(JSON_EXTRACT(${json}, '$.${key}'))=n.assetId`);
        const scalar = /(?:asset|image)id$/iu.test(surface.c) ? [`${column}=n.assetId`] : [];
        try {
            for (const batch of batches) {
                const needles = batch.flatMap(asset =>
                    stems(asset).map(needle => [String(asset.id), needle]),
                );
                const derived = needles.map(() => 'SELECT ? AS assetId,? AS needle').join(' UNION ALL ');
                const rows = await query(
                    connection,
                    `SELECT /*+ MAX_EXECUTION_TIME(3000) */ n.assetId,COUNT(*) AS n FROM ${quote(surface.t)} AS d INNER JOIN (${derived}) AS n ON (${[
                        `LOCATE(CONVERT(n.needle USING utf8mb4) COLLATE utf8mb4_unicode_ci,CONVERT(${column} USING utf8mb4) COLLATE utf8mb4_unicode_ci)>0`,
                        ...jsonIds,
                        ...scalar,
                    ].join(' OR ')}) GROUP BY n.assetId`,
                    needles.flat(),
                    batch.length,
                );
                for (const row of rows)
                    add(row.assetId, {
                        kind: 'CURRENT_OR_LEGACY_MEDIA_REFERENCE',
                        table: surface.t,
                        column: surface.c,
                        count: Number(row.n),
                    });
            }
        } catch (error) {
            // A timeout or unreadable surface makes every potentially affected
            // target ineligible; never turn incomplete evidence into deletion.
            for (const id of ids)
                add(id, {
                    kind: 'UNVERIFIABLE_MEDIA_SURFACE',
                    table: surface.t,
                    column: surface.c,
                    failure:
                        error.code === 'ER_QUERY_TIMEOUT' || error.errno === 3024
                            ? 'STATEMENT_TIMEOUT'
                            : 'QUERY_FAILED',
                });
        }
    }
    const allPaths = await query(connection, 'SELECT id,source,preview FROM asset ORDER BY id', [], 10000);
    for (const asset of assets)
        if (
            allPaths.some(
                other =>
                    String(other.id) !== String(asset.id) &&
                    [other.source, other.preview].some(p => p === asset.source || p === asset.preview),
            )
        )
            add(asset.id, { kind: 'FILE_PATH_SHARED_WITH_ANOTHER_ASSET' });
    return { reasons, surfaceCount: surfaces.length, foreignKeyColumns: schema.foreignKeys.length };
}
async function bytesAt(root, identifier) {
    assert.ok(
        typeof identifier === 'string' && /^(?:source|preview)\//u.test(identifier),
        'ASSET_PATH_NOT_CATALOG_MEDIA',
    );
    assert.ok(
        !identifier.includes('\\') &&
            !identifier.includes('\0') &&
            path.posix.normalize(identifier) === identifier &&
            !identifier.split('/').includes('..'),
        'ASSET_PATH_INVALID',
    );
    const file = path.join(root, identifier);
    assert.equal(await fs.realpath(path.dirname(file)), path.dirname(file), 'ASSET_PARENT_REDIRECTED');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        assert.ok(
            stat.isFile() && stat.nlink === 1 && stat.size > 0 && stat.size <= 32 * 1024 * 1024,
            'ASSET_FILE_UNSAFE',
        );
        return { bytes: await handle.readFile(), mode: stat.mode, uid: stat.uid, gid: stat.gid };
    } finally {
        await handle.close();
    }
}
async function privateDirectory(directory) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    assert.equal(await fs.realpath(directory), directory, 'ASSET_BACKUP_PATH_REDIRECTED');
    const stat = await fs.lstat(directory);
    // eslint-disable-next-line no-bitwise -- Enforce the private backup directory mode.
    assert.ok(stat.isDirectory() && (stat.mode & 0o077) === 0, 'ASSET_BACKUP_NOT_PRIVATE');
}
async function exclusiveFile(file, bytes) {
    try {
        const output = await fs.open(file, 'wx', 0o600);
        try {
            await output.writeFile(bytes);
            await output.sync();
        } finally {
            await output.close();
        }
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        assert.ok((await handle.readFile()).equals(bytes), 'ASSET_BACKUP_CONTENT_CHANGED');
    } finally {
        await handle.close();
    }
}
async function prepare(connection, root, backupRoot, sourceSha, runtimeSha) {
    const schema = await metadata(connection);
    await connection.query('SET TRANSACTION READ ONLY');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    let data, usage;
    try {
        data = await rowsFor(connection, TARGET_IDS);
        usage = await references(connection, data.asset, schema);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    }
    const present = new Set(data.asset.map(asset => String(asset.id)));
    const kept = TARGET_IDS.filter(id => !present.has(id)).map(id => ({
        id,
        reasons: [{ kind: 'ASSET_ALREADY_ABSENT' }],
    }));
    const files = [],
        eligible = [];
    let bytes = 0;
    for (const asset of data.asset) {
        const id = String(asset.id),
            reasons = usage.reasons.get(id);
        if (asset.type !== 'IMAGE') reasons.push({ kind: 'NOT_AN_IMAGE' });
        const found = [];
        if (!reasons.length) {
            try {
                for (const [kind, identifier] of [
                    ['source', asset.source],
                    ['preview', asset.preview],
                ]) {
                    const input = await bytesAt(root, identifier);
                    bytes += input.bytes.length;
                    assert.ok(bytes <= 512 * 1024 * 1024, 'ASSET_FILE_TOTAL_BUDGET');
                    found.push({
                        assetId: id,
                        kind,
                        identifier,
                        bytes: input.bytes.length,
                        sha256: hash(input.bytes),
                        mode: input.mode,
                        uid: input.uid,
                        gid: input.gid,
                    });
                }
            } catch {
                reasons.push({ kind: 'FILE_UNAVAILABLE_OR_UNSAFE' });
            }
        }
        if (reasons.length) kept.push({ id, reasons });
        else {
            eligible.push(id);
            files.push(...found);
        }
    }
    eligible.sort((a, b) => Number(a) - Number(b));
    kept.sort((a, b) => Number(a.id) - Number(b.id));
    const plan = {
        schema: 'vendure-historical-asset-cleanup-v1',
        sourceSha,
        runtimeSha,
        root,
        fixedIds: TARGET_IDS,
        eligibleIds: eligible,
        pilotIds: eligible.slice(0, 10),
        remainingIds: eligible.slice(10),
        kept,
        files,
        schemaHash: digest(schema),
        dataHash: digest(data),
        data,
    };
    const planHash = digest(plan);
    const directory = path.join(backupRoot, planHash);
    await privateDirectory(backupRoot);
    await privateDirectory(directory);
    for (const file of files) {
        const input = await bytesAt(root, file.identifier);
        assert.equal(hash(input.bytes), file.sha256, 'ASSET_CHANGED_BEFORE_BACKUP');
        const output = path.join(directory, 'files', file.identifier);
        await privateDirectory(path.dirname(output));
        await exclusiveFile(output, input.bytes);
    }
    const encoded = Buffer.from(JSON.stringify(canon(plan)));
    await exclusiveFile(path.join(directory, 'metadata.json'), encoded);
    return {
        mode: 'READ_ONLY',
        productionApply: false,
        schema: plan.schema,
        sourceSha,
        runtimeSha,
        planHash,
        candidateCount: TARGET_IDS.length,
        eligibleIds: eligible,
        pilotIds: plan.pilotIds,
        remainingIds: plan.remainingIds,
        kept,
        referenceCoverage: {
            mediaColumns: usage.surfaceCount,
            assetForeignKeyColumns: usage.foreignKeyColumns,
            legacyFilenameStems: true,
        },
        backup: {
            directory,
            metadataSha256: hash(encoded),
            files: files.length,
            bytes: files.reduce((sum, file) => sum + file.bytes, 0),
            verified: true,
        },
        businessDataWrites: 0,
    };
}
async function loadPlan(backupRoot, expectedHash, sourceSha, runtimeSha) {
    assert.match(expectedHash, /^[a-f0-9]{64}$/u);
    const directory = path.join(backupRoot, expectedHash);
    assert.equal(await fs.realpath(directory), directory, 'ASSET_BACKUP_PATH_REDIRECTED');
    const handle = await fs.open(
        path.join(directory, 'metadata.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let plan;
    try {
        plan = JSON.parse(await handle.readFile('utf8'));
    } finally {
        await handle.close();
    }
    assert.equal(digest(plan), expectedHash, 'ASSET_BACKUP_PLAN_CHANGED');
    assert.equal(plan.sourceSha, sourceSha, 'ASSET_CLEANUP_SOURCE_CHANGED');
    assert.equal(plan.runtimeSha, runtimeSha, 'ASSET_CLEANUP_RUNTIME_CHANGED');
    assert.deepEqual(plan.fixedIds, TARGET_IDS);
    for (const file of plan.files) {
        const h = await fs.open(
            path.join(directory, 'files', file.identifier),
            constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
            assert.equal(hash(await h.readFile()), file.sha256, 'ASSET_BACKUP_FILE_CHANGED');
        } finally {
            await h.close();
        }
    }
    return { plan, directory };
}
async function apply(connection, root, backupRoot, expectedHash, sourceSha, runtimeSha, phase) {
    assert.ok(['pilot', 'remaining'].includes(phase));
    const { plan, directory } = await loadPlan(backupRoot, expectedHash, sourceSha, runtimeSha);
    assert.equal(root, plan.root, 'ASSET_UPLOAD_ROOT_CHANGED');
    const ids = phase === 'pilot' ? plan.pilotIds : plan.remainingIds;
    assert.ok(ids.length > 0, 'ASSET_EMPTY_BATCH');
    if (phase === 'remaining') {
        const pilot = JSON.parse(await fs.readFile(path.join(directory, 'pilot-receipt.json'), 'utf8'));
        assert.equal(pilot.status, 'COMPLETE', 'ASSET_PILOT_NOT_COMPLETE');
        assert.deepEqual(pilot.ids, plan.pilotIds);
    }
    const receiptFile = path.join(directory, phase + '-receipt.json');
    const existing = await query(connection, `SELECT id FROM asset WHERE id IN (${marks(ids)})`, ids, 95);
    if (existing.length) {
        assert.equal(existing.length, ids.length, 'ASSET_BATCH_PARTIALLY_CHANGED');
        const schema = await metadata(connection);
        assert.equal(digest(schema), plan.schemaHash, 'ASSET_SCHEMA_CHANGED');
        await fs.writeFile(
            receiptFile,
            JSON.stringify({ planHash: expectedHash, phase, ids, status: 'PREPARED' }),
            { mode: 0o600 },
        );
        await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        await connection.beginTransaction();
        try {
            await query(
                connection,
                `SELECT id FROM asset WHERE id IN (${marks(ids)}) ORDER BY id FOR UPDATE`,
                ids,
                95,
            );
            const current = await rowsFor(connection, ids);
            const expected = Object.fromEntries(
                Object.entries(plan.data).map(([table, rows]) => [
                    table,
                    rows.filter(row => ids.includes(String(row[table === 'asset' ? 'id' : LINKS[table]]))),
                ]),
            );
            assert.equal(digest(current), digest(expected), 'ASSET_ROWS_CHANGED');
            const usage = await references(connection, current.asset, schema);
            assert.ok(
                [...usage.reasons.values()].every(reasons => reasons.length === 0),
                'ASSET_NEW_REFERENCE_FOUND',
            );
            for (const file of plan.files.filter(file => ids.includes(file.assetId)))
                assert.equal(
                    hash((await bytesAt(root, file.identifier)).bytes),
                    file.sha256,
                    'ASSET_FILE_CHANGED',
                );
            for (const [table, column] of Object.entries(LINKS))
                await connection.query(
                    `DELETE FROM ${quote(table)} WHERE ${quote(column)} IN (${marks(ids)})`,
                    ids,
                );
            const [deleted] = await connection.query(`DELETE FROM asset WHERE id IN (${marks(ids)})`, ids);
            assert.equal(deleted.affectedRows, ids.length, 'ASSET_DELETE_COUNT_CHANGED');
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        }
    } else {
        // A completed database phase may resume only the same approved file list.
        const prior = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
        assert.equal(prior.planHash, expectedHash);
        assert.deepEqual(prior.ids, ids);
    }
    const receipt = { schema: plan.schema, planHash: expectedHash, phase, ids, status: 'DATABASE_REMOVED' };
    await fs.writeFile(receiptFile, JSON.stringify(receipt), { mode: 0o600 });
    for (const file of plan.files.filter(file => ids.includes(file.assetId))) {
        try {
            const input = await bytesAt(root, file.identifier);
            assert.equal(hash(input.bytes), file.sha256, 'ASSET_FILE_CHANGED');
            await fs.unlink(path.join(root, file.identifier));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    assert.equal(
        (await query(connection, `SELECT id FROM asset WHERE id IN (${marks(ids)})`, ids, 95)).length,
        0,
    );
    receipt.status = 'COMPLETE';
    await fs.writeFile(receiptFile, JSON.stringify(receipt), { mode: 0o600 });
    return {
        ...receipt,
        productionApply: true,
        deletedAssetCount: ids.length,
        deletedFileCount: plan.files.filter(file => ids.includes(file.assetId)).length,
        keptCount: plan.kept.length,
        backupVerified: true,
    };
}
async function main() {
    const [operation, sourceSha, runtimeSha, expectedHash] = process.argv.slice(2);
    assert.ok(['prepare', 'pilot', 'remaining'].includes(operation));
    assert.equal(process.argv.length, operation === 'prepare' ? 5 : 6);
    assert.match(sourceSha, /^[a-f0-9]{40}$/u);
    assert.match(runtimeSha, /^[a-f0-9]{40}$/u);
    assert.ok(['mysql', 'mariadb'].includes(String(process.env.DB ?? 'mysql')));
    assert.ok(path.isAbsolute(process.env.VENDURE_ASSET_UPLOAD_DIR || ''), 'ASSET_UPLOAD_ROOT_NOT_PINNED');
    assert.ok(
        path.isAbsolute(process.env.STORE_ISOLATION_MODULE_ROOT || ''),
        'ASSET_RUNTIME_ROOT_NOT_PINNED',
    );
    const root = await fs.realpath(process.env.VENDURE_ASSET_UPLOAD_DIR);
    const requireRuntime = createRequire(path.join(process.env.STORE_ISOLATION_MODULE_ROOT, 'package.json'));
    const mysql = requireRuntime('mysql2/promise');
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USERNAME || 'vendure',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'vendure-dev',
        multipleStatements: false,
    });
    try {
        const output =
            operation === 'prepare'
                ? await prepare(connection, root, BACKUP_ROOT, sourceSha, runtimeSha)
                : await apply(connection, root, BACKUP_ROOT, expectedHash, sourceSha, runtimeSha, operation);
        process.stdout.write(JSON.stringify(output) + '\n');
    } finally {
        await connection.end();
    }
}
if (require.main === module)
    main().catch(error => {
        const code = /^ASSET_[A-Z_]+$/u.test(error.message) ? error.message : 'ASSET_CLEANUP_FAILED';
        process.stderr.write(
            'HISTORICAL_ASSET_FAILURE code=' +
                code +
                ' digest=' +
                digest({ code, errorName: error.name }).slice(0, 12) +
                '\n',
        );
        process.exitCode = 1;
    });
module.exports = { TARGET_IDS, stems, mediaColumn, references, prepare, apply, loadPlan, digest, bytesAt };
