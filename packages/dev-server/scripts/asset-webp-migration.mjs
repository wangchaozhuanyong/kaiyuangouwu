import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const BATCH_SIZE = 100;
const URL_COLUMNS = [
    ['storefront_content_block', 'imageUrl'],
    ['storefront_content_item', 'imageUrl'],
    ['storefront_review', 'imageAssets'],
];

function runtimeRequire(environment) {
    const root = environment.STORE_ISOLATION_MODULE_ROOT?.trim();
    return root
        ? createRequire(path.join(path.resolve(root), 'package.json'))
        : createRequire(import.meta.url);
}

export function migratedIdentifier(identifier, id) {
    assert.match(String(id), /^\d+$/u);
    assert.equal(path.isAbsolute(identifier), false, 'Asset identifier must be relative');
    const normalized = identifier.replaceAll('\\', '/');
    assert.ok(normalized === path.posix.normalize(normalized), 'Asset identifier is not normalized');
    assert.ok(
        !normalized.startsWith('../') && !normalized.includes('/../'),
        'Asset path escapes upload root',
    );
    assert.match(normalized, /^(?:[a-z0-9_-]+\/)+[^/]+\.[a-z0-9]+$/iu);
    return normalized.replace(/\.[a-z0-9]+$/iu, `__webp_migrated_${id}.webp`);
}

function digest(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function hashBytes(value) {
    return createHash('sha256').update(value).digest('hex');
}

function uploadRoot(environment) {
    const directory = environment.VENDURE_ASSET_UPLOAD_DIR?.trim();
    assert.ok(
        directory && path.isAbsolute(directory),
        'Pinned absolute VENDURE_ASSET_UPLOAD_DIR is required',
    );
    return path.resolve(directory);
}

async function checkedPath(root, identifier) {
    const full = path.join(root, identifier);
    const directory = await fs.realpath(path.dirname(full));
    assert.ok(directory.startsWith(`${root}${path.sep}`), 'Asset path escapes upload root');
    return full;
}

async function checkedInput(root, identifier) {
    const full = await checkedPath(root, identifier);
    const stat = await fs.lstat(full);
    assert.ok(stat.isFile(), 'Asset input must be a regular file');
    return full;
}

async function targetWrite(file, bytes) {
    try {
        await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o644 });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await fs.readFile(file);
        assert.ok(existing.equals(bytes), `Existing migrated file differs: ${path.basename(file)}`);
    }
}

async function hasWebpSignature(root, identifier) {
    try {
        const file = await checkedInput(root, identifier);
        const handle = await fs.open(file, 'r');
        try {
            const header = Buffer.alloc(12);
            const { bytesRead } = await handle.read(header, 0, header.length, 0);
            return (
                bytesRead === 12 &&
                header.toString('ascii', 0, 4) === 'RIFF' &&
                header.toString('ascii', 8, 12) === 'WEBP'
            );
        } finally {
            await handle.close();
        }
    } catch {
        return false;
    }
}

async function verifyAllImages(connection, root) {
    let inspected = 0;
    let mismatched = 0;
    let trustedPrivateAvatars = 0;
    const sampleIds = [];
    const rowsToMigrate = [];
    for (let offset = 0; ; offset += 500) {
        const [rows] = await connection.execute(
            `SELECT id, source, preview, mimeType, fileSize FROM asset WHERE type = 'IMAGE' ORDER BY id LIMIT 500 OFFSET ${offset}`,
        );
        if (!rows.length) break;
        for (let index = 0; index < rows.length; index += 50) {
            const group = rows.slice(index, index + 50);
            const results = await Promise.all(
                group.map(async row => {
                    if (row.mimeType !== 'image/webp') return false;
                    if (
                        row.source.startsWith('avatars/v2/source/') &&
                        row.preview.startsWith('avatars/v2/preview/') &&
                        row.source.endsWith('.webp') &&
                        row.preview.endsWith('.webp')
                    ) {
                        trustedPrivateAvatars += 1;
                        return true;
                    }
                    return (
                        (await hasWebpSignature(root, row.source)) &&
                        (await hasWebpSignature(root, row.preview))
                    );
                }),
            );
            results.forEach((valid, resultIndex) => {
                inspected += 1;
                if (!valid) {
                    mismatched += 1;
                    if (sampleIds.length < 20) sampleIds.push(String(group[resultIndex].id));
                    if (rowsToMigrate.length < BATCH_SIZE) rowsToMigrate.push(group[resultIndex]);
                }
            });
        }
    }
    return { inspected, physicalMismatchCount: mismatched, trustedPrivateAvatars, sampleIds, rowsToMigrate };
}

async function existingUrlColumns(connection) {
    const [rows] = await connection.execute(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = DATABASE()
         AND ((table_name = 'storefront_content_block' AND column_name = 'imageUrl')
           OR (table_name = 'storefront_content_item' AND column_name = 'imageUrl')
           OR (table_name = 'storefront_review' AND column_name = 'imageAssets'))`,
    );
    return URL_COLUMNS.filter(([table, column]) =>
        rows.some(row => row.table_name === table && row.column_name === column),
    );
}

async function candidates(connection, root) {
    const [countRows] = await connection.execute(
        `SELECT COUNT(*) AS count FROM asset
         WHERE type = 'IMAGE' AND (mimeType <> 'image/webp' OR source NOT LIKE '%.webp' OR preview NOT LIKE '%.webp')`,
    );
    const metadataRemaining = Number(countRows[0].count);
    if (metadataRemaining > 0) {
        const [rows] = await connection.execute(
            `SELECT id, source, preview, mimeType, fileSize FROM asset
             WHERE type = 'IMAGE' AND (mimeType <> 'image/webp' OR source NOT LIKE '%.webp' OR preview NOT LIKE '%.webp')
             ORDER BY id LIMIT ${BATCH_SIZE}`,
        );
        return { rows, remaining: metadataRemaining, metadataRemaining, phase: 'metadata' };
    }
    const physical = await verifyAllImages(connection, root);
    return {
        rows: physical.rowsToMigrate,
        remaining: physical.physicalMismatchCount,
        metadataRemaining: 0,
        phase: 'physical',
        physicalInspected: physical.inspected,
        trustedPrivateAvatars: physical.trustedPrivateAvatars,
    };
}

export async function makePlan(connection, root) {
    const { rows, remaining, metadataRemaining, phase, physicalInspected, trustedPrivateAvatars } =
        await candidates(connection, root);
    const files = [];
    for (const row of rows) {
        const source = await checkedInput(root, row.source);
        const preview = await checkedInput(root, row.preview);
        const [sourceBytes, previewBytes] = await Promise.all([fs.readFile(source), fs.readFile(preview)]);
        files.push({
            id: String(row.id),
            source: row.source,
            preview: row.preview,
            mimeType: row.mimeType,
            fileSize: Number(row.fileSize),
            sourceBytes: sourceBytes.length,
            previewBytes: previewBytes.length,
            sourceSha256: hashBytes(sourceBytes),
            previewSha256: hashBytes(previewBytes),
        });
    }
    const columns = await existingUrlColumns(connection);
    const operationDigest = digest({ schema: 1, root, files, columns });
    return {
        schema: 'vendure-asset-webp-migration-v1',
        batchSize: BATCH_SIZE,
        remaining,
        metadataRemaining,
        phase,
        ...(physicalInspected === undefined ? {} : { physicalInspected }),
        ...(trustedPrivateAvatars === undefined ? {} : { trustedPrivateAvatars }),
        selected: files.length,
        inputBytes: files.reduce((total, file) => total + file.sourceBytes + file.previewBytes, 0),
        ids: files.map(file => file.id),
        urlColumns: columns.map(([table, column]) => `${table}.${column}`),
        operationDigest,
        files,
        columns,
    };
}

export async function applyPlan(connection, sharp, root, plan) {
    for (const row of plan.files) {
        const sourcePath = await checkedInput(root, row.source);
        const previewPath = await checkedInput(root, row.preview);
        const sourceBytes = await fs.readFile(sourcePath);
        const previewBytes = await fs.readFile(previewPath);
        assert.equal(sourceBytes.length, row.sourceBytes, `Asset ${row.id} source changed`);
        assert.equal(previewBytes.length, row.previewBytes, `Asset ${row.id} preview changed`);
        assert.equal(hashBytes(sourceBytes), row.sourceSha256, `Asset ${row.id} source changed`);
        assert.equal(hashBytes(previewBytes), row.previewSha256, `Asset ${row.id} preview changed`);
        const sourceWebp = await sharp(sourceBytes, { animated: true, failOn: 'truncated' })
            .rotate()
            .webp({ quality: 95, effort: 4 })
            .toBuffer();
        const previewWebp = await sharp(previewBytes, { animated: true, failOn: 'truncated' })
            .rotate()
            .webp({ quality: 95, effort: 4 })
            .toBuffer();
        const nextSource = migratedIdentifier(row.source, row.id);
        const nextPreview = migratedIdentifier(row.preview, row.id);
        await targetWrite(await checkedPath(root, nextSource), sourceWebp);
        await targetWrite(await checkedPath(root, nextPreview), previewWebp);
        const metadata = await sharp(sourceWebp).metadata();
        await connection.beginTransaction();
        try {
            const [updated] = await connection.execute(
                `UPDATE asset SET source = ?, preview = ?, mimeType = 'image/webp', fileSize = ?, width = ?, height = ?
                 WHERE id = ? AND source = ? AND preview = ? AND mimeType = ? AND fileSize = ?`,
                [
                    nextSource,
                    nextPreview,
                    sourceWebp.length,
                    metadata.width,
                    metadata.pageHeight || metadata.height,
                    row.id,
                    row.source,
                    row.preview,
                    row.mimeType,
                    row.fileSize,
                ],
            );
            assert.equal(updated.affectedRows, 1, `Asset ${row.id} changed during migration`);
            for (const [table, column] of plan.columns) {
                // Identifiers are unique hashed paths; this updates legacy direct URLs and review snapshots.
                await connection.execute(
                    `UPDATE \`${table}\` SET \`${column}\` = REPLACE(REPLACE(\`${column}\`, ?, ?), ?, ?)
                     WHERE \`${column}\` LIKE ? OR \`${column}\` LIKE ?`,
                    [row.preview, nextPreview, row.source, nextSource, `%${row.preview}%`, `%${row.source}%`],
                );
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        }
    }
}

export async function run(operation, expectedDigest, environment = process.env) {
    assert.ok(['plan', 'apply', 'verify'].includes(operation), 'Unsupported migration operation');
    const databaseType = String(environment.DB ?? 'mysql').toLowerCase();
    assert.ok(['mysql', 'mariadb'].includes(databaseType), 'Production migration requires MySQL');
    const require = runtimeRequire(environment);
    const mysql = require('mysql2/promise');
    const connection = await mysql.createConnection({
        host: environment.DB_HOST || '127.0.0.1',
        port: Number(environment.DB_PORT || 3306),
        user: environment.DB_USERNAME || 'vendure',
        password: environment.DB_PASSWORD || '',
        database: environment.DB_NAME || 'vendure-dev',
        multipleStatements: false,
    });
    try {
        const root = await fs.realpath(uploadRoot(environment));
        const plan = await makePlan(connection, root);
        if (operation === 'verify') {
            return {
                databaseRemaining: plan.remaining,
                metadataRemaining: plan.metadataRemaining,
                remaining: plan.remaining,
                complete: plan.remaining === 0,
                phase: plan.phase,
                ...(plan.physicalInspected === undefined
                    ? {}
                    : { physicalInspected: plan.physicalInspected }),
                ...(plan.trustedPrivateAvatars === undefined
                    ? {}
                    : { trustedPrivateAvatars: plan.trustedPrivateAvatars }),
            };
        }
        if (operation === 'apply') {
            assert.equal(plan.operationDigest, expectedDigest, 'Migration plan changed; review a fresh plan');
            await applyPlan(connection, require('sharp'), root, plan);
        }
        const { files: _files, columns: _columns, ...publicPlan } = plan;
        return publicPlan;
    } finally {
        await connection.end();
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    run(process.argv[2], process.argv[3])
        .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
        .catch(error => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}
