import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyChanges } from '../scripts/ci-impact.mjs';

const require = createRequire(import.meta.url);
const { runHistoricalAssetCleanup } = require('./historical-asset-cleanup-operations.cjs');
const cleanup = require('./historical-asset-cleanup.cjs');
const { validateRequest } = require('./production-operations.cjs');
const sourceSha = 'a'.repeat(40);
const runtimeSha = 'b'.repeat(40);
const fixtureRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../artifacts/historical-asset-cleanup-tests',
);
const prepareOp = 'prepare-historical-asset-cleanup';
const pilotOp = 'apply-historical-asset-cleanup-pilot-reviewed';
const remainingOp = 'apply-historical-asset-cleanup-remaining-reviewed';
const request = operation =>
    validateRequest({
        OPS_OPERATION: operation,
        OPS_SOURCE_SHA: sourceSha,
        OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
        ...(operation === prepareOp ? {} : { OPS_EXPECTED_PLAN_SHA256: 'c'.repeat(64) }),
    });

test('fixed 95-image operations require exact runtime and explicit write approval, without an application release', () => {
    assert.equal(cleanup.TARGET_IDS.length, 95);
    assert.equal(new Set(cleanup.TARGET_IDS).size, 95);
    for (const operation of [prepareOp, pilotOp, remainingOp]) {
        assert.equal(request(operation).operation, operation);
        assert.throws(
            () =>
                validateRequest({
                    OPS_OPERATION: operation,
                    OPS_SOURCE_SHA: sourceSha,
                    OPS_EXPECTED_PLAN_SHA256: operation === prepareOp ? '' : 'c'.repeat(64),
                }),
            /runtime SHA/u,
        );
    }
    assert.throws(
        () =>
            validateRequest({
                OPS_OPERATION: pilotOp,
                OPS_SOURCE_SHA: sourceSha,
                OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
            }),
        /plan SHA/u,
    );
    assert.throws(
        () =>
            validateRequest({
                OPS_OPERATION: prepareOp,
                OPS_SOURCE_SHA: sourceSha,
                OPS_EXPECTED_RUNTIME_SHA: runtimeSha,
                OPS_EXPECTED_PLAN_SHA256: 'c'.repeat(64),
            }),
        /write approval/u,
    );
    const scope = classifyChanges([
        'deploy/historical-asset-cleanup.cjs',
        'deploy/historical-asset-cleanup-operations.cjs',
        '.github/workflows/production_operations.yml',
    ]);
    assert.equal(scope.lane, 'none');
    assert.equal(scope.controls, true);
    assert.deepEqual(scope.packages, []);
    assert.deepEqual(scope.frontends, []);
});

test('media probes cover drafts, published sources, private avatar bindings and legacy aliases without selecting credentials', () => {
    assert.equal(cleanup.mediaColumn('storefront_promotion_page', 'draftSource', 'text'), true);
    assert.equal(cleanup.mediaColumn('storefront_promotion_page', 'publishedSource', 'text'), true);
    assert.equal(cleanup.mediaColumn('customer', 'customFieldsAvatarUrl', 'varchar'), true);
    assert.equal(cleanup.mediaColumn('system_announcement', 'body', 'text'), true);
    assert.equal(cleanup.mediaColumn('custom_feature_table', 'imageUrl', 'text'), true);
    assert.equal(cleanup.mediaColumn('global_settings', 'customFieldsLogo', 'text'), true);
    assert.equal(cleanup.mediaColumn('global_settings', 'apiKey', 'text'), false);
    assert.equal(cleanup.mediaColumn('session', 'token', 'varchar'), false);
    assert.ok(
        cleanup
            .stems({
                source: 'source/a/original-banner__webp_migrated_68.webp',
                preview: 'preview/b/original-banner__preview__webp_migrated_68.webp',
            })
            .includes('original-banner'),
    );
    assert.ok(
        cleanup
            .stems({
                source: 'source/a/222222__webp_migrated_505.webp',
                preview: 'preview/a/222222__webp_migrated_505.webp',
            })
            .includes('source/a/222222'),
    );
});

test('catalog files reject traversal, redirected parents, symlinks and hard links', async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    const dir = await fs.mkdtemp(path.join(fixtureRoot, 'paths-'));
    try {
        const root = path.join(dir, 'uploads');
        await fs.mkdir(path.join(root, 'source/a'), { recursive: true });
        await fs.writeFile(path.join(root, 'source/a/good.webp'), 'fixture');
        await assert.rejects(cleanup.bytesAt(root, 'source/../../escape.webp'), /ASSET_PATH_INVALID/u);
        await fs.symlink(path.join(root, 'source/a/good.webp'), path.join(root, 'source/a/link.webp'));
        await assert.rejects(cleanup.bytesAt(root, 'source/a/link.webp'));
        await fs.link(path.join(root, 'source/a/good.webp'), path.join(root, 'source/a/hard.webp'));
        await assert.rejects(cleanup.bytesAt(root, 'source/a/hard.webp'), /ASSET_FILE_UNSAFE/u);
        await fs.mkdir(path.join(dir, 'outside'));
        await fs.symlink(path.join(dir, 'outside'), path.join(root, 'source/redirect'));
        await assert.rejects(
            cleanup.bytesAt(root, 'source/redirect/anything.webp'),
            /ASSET_PARENT_REDIRECTED/u,
        );
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('native wrapper checks health and runtime after success or failure, preserves only safe output and rejects arbitrary keys', () => {
    let stages = [];
    const deps = {
        inspect: () => ({ markerSha: runtimeSha, currentRuntime: '/verified/runtime' }),
        health: stage => stages.push(stage),
        spawn: () => ({ status: 1, stderr: 'private credential must not escape\n' }),
    };
    assert.throws(
        () => runHistoricalAssetCleanup(request(prepareOp), deps),
        error => !error.message.includes('credential') && /operation failed/u.test(error.message),
    );
    assert.deepEqual(stages, ['before', 'after']);
    const plan = {
        schema: 'vendure-historical-asset-cleanup-v1',
        mode: 'READ_ONLY',
        productionApply: false,
        sourceSha,
        runtimeSha,
        planHash: 'c'.repeat(64),
        candidateCount: 95,
        eligibleIds: [...cleanup.TARGET_IDS],
        pilotIds: cleanup.TARGET_IDS.slice(0, 10),
        remainingIds: cleanup.TARGET_IDS.slice(10),
        kept: [],
        businessDataWrites: 0,
        referenceCoverage: { mediaColumns: 1 },
        backup: {
            directory: '/var/www/kaiyuangouwu/backups/historical-asset-cleanup/' + 'c'.repeat(64),
            metadataSha256: 'd'.repeat(64),
            files: 190,
            bytes: 100,
            verified: true,
        },
    };
    let transported = false;
    stages = [];
    const success = runHistoricalAssetCleanup(request(prepareOp), {
        ...deps,
        spawn: () => ({ status: 0, stdout: JSON.stringify(plan) }),
        persistPlan: () => {
            transported = true;
            return { sha256: 'e'.repeat(64) };
        },
    });
    assert.equal(success.audit.businessDataWrites, 0);
    assert.equal(transported, true);
    assert.deepEqual(stages, ['before', 'after']);
    assert.throws(() =>
        runHistoricalAssetCleanup(request(prepareOp), {
            ...deps,
            spawn: () => ({ status: 0, stdout: JSON.stringify({ ...plan, private: 'NEVER_EXPORT' }) }),
        }),
    );
});

let mysqlPort = null;
try {
    const image = execFileSync(
        'docker',
        ['inspect', '--format', '{{.Config.Image}}', 'vendure-asset-cleanup-qa-20261017'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    assert.equal(image, 'mysql:8.0');
    const address = execFileSync('docker', ['port', 'vendure-asset-cleanup-qa-20261017', '3306'], {
        encoding: 'utf8',
    }).trim();
    assert.match(address, /^127\.0\.0\.1:[0-9]+$/u);
    mysqlPort = Number(address.split(':')[1]);
} catch {
    /* Real MySQL verification is explicit and isolated; CI without the fixture reports a skip. */
}

test(
    'MySQL: legacy references and AI/gallery uses are retained; verified backups restore both pilot and remaining deletions',
    {
        skip: mysqlPort === null ? 'isolated local MySQL fixture is not running' : false,
    },
    async () => {
        await fs.mkdir(fixtureRoot, { recursive: true });
        const directory = await fs.mkdtemp(path.join(fixtureRoot, 'run-'));
        const root = path.join(directory, 'uploads');
        const backups = path.join(directory, 'backups');
        await fs.mkdir(path.join(root, 'source/a'), { recursive: true });
        await fs.mkdir(path.join(root, 'preview/a'), { recursive: true });
        const conn = await mysql.createConnection({
            host: '127.0.0.1',
            port: mysqlPort,
            user: 'root',
            multipleStatements: false,
        });
        try {
            await conn.query('DROP DATABASE IF EXISTS asset_cleanup_qa');
            await conn.query('CREATE DATABASE asset_cleanup_qa');
            await conn.query('USE asset_cleanup_qa');
            for (const sql of [
                'CREATE TABLE asset(id INT PRIMARY KEY,name VARCHAR(255),type VARCHAR(16),source VARCHAR(255),preview VARCHAR(255))',
                'CREATE TABLE asset_channels_channel(assetId INT,channelId INT,PRIMARY KEY(assetId,channelId),' +
                    'FOREIGN KEY(assetId) REFERENCES asset(id) ON DELETE CASCADE)',
                'CREATE TABLE tag(id INT PRIMARY KEY,value VARCHAR(255))',
                'CREATE TABLE asset_tags_tag(assetId INT,tagId INT,PRIMARY KEY(assetId,tagId),' +
                    'FOREIGN KEY(assetId) REFERENCES asset(id) ON DELETE CASCADE,FOREIGN KEY(tagId) REFERENCES tag(id))',
                'CREATE TABLE asset_translation(id INT PRIMARY KEY,baseId INT,name VARCHAR(255),FOREIGN KEY(baseId) REFERENCES asset(id) ON DELETE CASCADE)',
                'CREATE TABLE catalog_resource_ownership(resourceType VARCHAR(50),resourceId VARCHAR(50),ownerChannelId INT)',
                'CREATE TABLE storefront_promotion_page(id INT PRIMARY KEY,draftSource TEXT,publishedSource TEXT)',
                'CREATE TABLE storefront_content_block(id INT PRIMARY KEY,imageAssetId INT,settings TEXT,' +
                    'FOREIGN KEY(imageAssetId) REFERENCES asset(id) ON DELETE SET NULL)',
                'CREATE TABLE image_generation_output(id INT PRIMARY KEY,catalogAssetId INT,FOREIGN KEY(catalogAssetId) REFERENCES asset(id) ON DELETE SET NULL)',
                'CREATE TABLE product_asset(id INT PRIMARY KEY,assetId INT,FOREIGN KEY(assetId) REFERENCES asset(id))',
            ])
                await conn.query(sql);
            await conn.query("INSERT INTO tag VALUES(33,'retained-tag')");
            for (const id of cleanup.TARGET_IDS) {
                const source = `source/a/asset-${id}__webp_migrated_${id}.webp`;
                const preview = `preview/a/asset-${id}__webp_migrated_${id}.webp`;
                await conn.query('INSERT INTO asset VALUES(?,?,?,?,?)', [
                    id,
                    'fixture-' + id,
                    'IMAGE',
                    source,
                    preview,
                ]);
                await conn.query('INSERT INTO asset_translation VALUES(?,?,?)', [id, id, 'fixture-' + id]);
                for (const channel of [1, 2, 5])
                    await conn.query('INSERT INTO asset_channels_channel VALUES(?,?)', [id, channel]);
                await fs.writeFile(path.join(root, source), Buffer.from('source fixture ' + id));
                await fs.writeFile(path.join(root, preview), Buffer.from('preview fixture ' + id));
            }
            await conn.query('INSERT INTO storefront_promotion_page VALUES(?,?,?)', [
                1,
                '<img src=/assets/preview/a/asset-68.png>',
                '<style>background:url(/assets/source/a/asset-68.jpg)</style>',
            ]);
            await conn.query(
                'INSERT INTO storefront_content_block VALUES(1,80,\'{"mobileImageAssetId":82,"privateFixture":"NEVER_EXPORT_CONFIG"}\')',
            );
            await conn.query('INSERT INTO image_generation_output VALUES(1,79)');
            await conn.query('INSERT INTO product_asset VALUES(1,81)');
            await conn.query("INSERT INTO catalog_resource_ownership VALUES('Asset','84',2)");
            await conn.query(
                "INSERT INTO asset VALUES(999,'shared-file','IMAGE','source/a/asset-85__webp_migrated_85.webp','preview/a/asset-85__webp_migrated_85.webp')",
            );
            await fs.unlink(path.join(root, 'source/a/asset-83__webp_migrated_83.webp'));
            await conn.query('INSERT INTO asset_tags_tag VALUES(142,33)');
            const result = await cleanup.prepare(conn, root, backups, sourceSha, runtimeSha);
            const limited = {
                query: (sql, ...args) => {
                    if (sql.includes('LOCATE') && sql.includes('`storefront_promotion_page`'))
                        throw new Error('fixture unavailable media read');
                    return conn.query(sql, ...args);
                },
                commit: () => conn.commit(),
                rollback: () => conn.rollback(),
            };
            const incomplete = await cleanup.prepare(limited, root, backups, sourceSha, runtimeSha);
            assert.equal(incomplete.eligibleIds.length, 0);
            assert.equal(incomplete.kept.length, 95);
            assert.ok(
                incomplete.kept.every(row =>
                    row.reasons.some(reason => reason.kind === 'UNVERIFIABLE_MEDIA_SURFACE'),
                ),
            );
            for (const id of ['68', '79', '80', '81', '82', '83', '84', '85'])
                assert.ok(
                    result.kept.some(row => row.id === id),
                    id,
                );
            // 95 - eight retained records = 87. Shared paths and JSON bindings are retained.
            assert.equal(result.eligibleIds.length, 87);
            assert.equal(result.backup.verified, true);
            assert.doesNotMatch(JSON.stringify(result), /NEVER_EXPORT_CONFIG/u);
            assert.equal(result.backup.files, 174);
            const loaded = await cleanup.loadPlan(backups, result.planHash, sourceSha, runtimeSha);
            const first = result.pilotIds[0];
            await conn.query('UPDATE storefront_content_block SET settings=? WHERE id=1', [
                `<img src="/assets/source/a/asset-${first}.png">`,
            ]);
            await assert.rejects(
                cleanup.apply(conn, root, backups, result.planHash, sourceSha, runtimeSha, 'pilot'),
                /ASSET_NEW_REFERENCE_FOUND/u,
            );
            assert.equal((await conn.query('SELECT COUNT(*) AS n FROM asset'))[0][0].n, 96);
            await conn.query("UPDATE storefront_content_block SET settings='{}' WHERE id=1");
            const pilot = await cleanup.apply(
                conn,
                root,
                backups,
                result.planHash,
                sourceSha,
                runtimeSha,
                'pilot',
            );
            assert.equal(pilot.deletedAssetCount, 10);
            assert.equal(pilot.status, 'COMPLETE');
            const repeated = await cleanup.apply(
                conn,
                root,
                backups,
                result.planHash,
                sourceSha,
                runtimeSha,
                'pilot',
            );
            assert.equal(repeated.deletedAssetCount, 10);
            const rest = await cleanup.apply(
                conn,
                root,
                backups,
                result.planHash,
                sourceSha,
                runtimeSha,
                'remaining',
            );
            assert.equal(rest.deletedAssetCount, 77);
            assert.equal((await conn.query('SELECT COUNT(*) AS n FROM asset'))[0][0].n, 9);
            assert.equal((await conn.query('SELECT COUNT(*) AS n FROM tag'))[0][0].n, 1);
            assert.equal((await conn.query('SELECT COUNT(*) AS n FROM storefront_content_block'))[0][0].n, 1);
            // Restore the deleted records and exact image bytes from the verified backup in the isolated DB.
            for (const table of ['asset', 'asset_channels_channel', 'asset_translation', 'asset_tags_tag'])
                for (const row of loaded.plan.data[table]) {
                    const id = String(
                        row[table === 'asset' ? 'id' : table === 'asset_translation' ? 'baseId' : 'assetId'],
                    );
                    if (!result.eligibleIds.includes(id)) continue;
                    const columns = Object.keys(row);
                    await conn.query(
                        'INSERT INTO `' +
                            table +
                            '`(' +
                            columns.map(c => '`' + c + '`').join(',') +
                            ') VALUES(' +
                            columns.map(() => '?').join(',') +
                            ')',
                        Object.values(row),
                    );
                }
            for (const file of loaded.plan.files) {
                const restoredFile = path.join(root, file.identifier);
                await fs.copyFile(path.join(loaded.directory, 'files', file.identifier), restoredFile);
                // eslint-disable-next-line no-bitwise -- Restore the original public file mode.
                const mode = file.mode & 0o777;
                await fs.chmod(restoredFile, mode);
                // eslint-disable-next-line no-bitwise -- Verify the POSIX mode survived restoration.
                assert.equal((await fs.stat(restoredFile)).mode & 0o777, mode);
            }
            const restored = await cleanup.loadPlan(backups, result.planHash, sourceSha, runtimeSha);
            assert.equal(restored.plan.files.length, 174);
            assert.equal((await conn.query('SELECT COUNT(*) AS n FROM asset'))[0][0].n, 96);
            assert.equal((await conn.query('SELECT COUNT(*) AS n FROM asset_channels_channel'))[0][0].n, 285);
            const target = path.join(loaded.directory, 'files', loaded.plan.files[0].identifier);
            await fs.writeFile(target, 'tampered');
            await assert.rejects(
                cleanup.loadPlan(backups, result.planHash, sourceSha, runtimeSha),
                /ASSET_BACKUP_FILE_CHANGED/u,
            );
        } finally {
            await conn.query('DROP DATABASE IF EXISTS asset_cleanup_qa');
            await conn.end();
            await fs.rm(directory, { recursive: true, force: true });
        }
    },
);
