import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { applyPlan, makePlan, migratedIdentifier } from './asset-webp-migration.mjs';

void test('migrated asset identifiers keep the storage namespace and cannot overwrite originals', () => {
    assert.equal(
        migratedIdentifier('source/6e/product-photo.jpg', '41'),
        'source/6e/product-photo__webp_migrated_41.webp',
    );
    assert.equal(
        migratedIdentifier('preview/6e/product-photo__preview.png', '41'),
        'preview/6e/product-photo__preview__webp_migrated_41.webp',
    );
    assert.throws(() => migratedIdentifier('../outside.png', '41'));
    assert.throws(() => migratedIdentifier('/tmp/asset.png', '41'));
    assert.throws(() => migratedIdentifier('preview/../../outside.png', '41'));
    assert.throws(() => migratedIdentifier('preview/asset.png', 'invalid'));
});

void test('a reviewed batch converts source and preview, updates references, and retains originals', async t => {
    const project = fileURLToPath(new URL('../', import.meta.url));
    const root = await fs.mkdtemp(path.join(project, '.asset-webp-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    for (const directory of ['source/6e', 'preview/6e']) {
        await fs.mkdir(path.join(root, directory), { recursive: true });
    }
    const source = 'source/6e/product.jpg';
    const preview = 'preview/6e/product__preview.png';
    const original = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#368' } })
        .jpeg()
        .toBuffer();
    const thumbnail = await sharp(original).resize(6, 4).png().toBuffer();
    await fs.writeFile(path.join(root, source), original);
    await fs.writeFile(path.join(root, preview), thumbnail);
    const row = { id: 7, source, preview, mimeType: 'image/jpeg', fileSize: original.length };
    let imageUrl = `/assets/${preview}?preset=storefront-card-480`;
    const transactionCalls = [];
    const connection = {
        async execute(sql, values) {
            if (sql.includes('information_schema.columns')) {
                return [[{ table_name: 'storefront_content_block', column_name: 'imageUrl' }]];
            }
            if (sql.includes('SELECT COUNT(*)')) return [[{ count: row.mimeType === 'image/webp' ? 0 : 1 }]];
            if (sql.includes('LIMIT 500 OFFSET')) return [sql.includes('OFFSET 0') ? [{ ...row }] : []];
            if (sql.includes('SELECT id, source, preview')) {
                return [row.mimeType === 'image/webp' ? [] : [{ ...row }]];
            }
            if (sql.includes('UPDATE asset SET')) {
                assert.equal(values[6], source);
                Object.assign(row, {
                    source: values[0],
                    preview: values[1],
                    mimeType: 'image/webp',
                    fileSize: values[2],
                });
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('UPDATE `storefront_content_block`')) {
                imageUrl = imageUrl.replace(values[0], values[1]).replace(values[2], values[3]);
                return [{ affectedRows: 1 }];
            }
            throw new Error(`Unexpected query: ${sql}`);
        },
        async beginTransaction() {
            transactionCalls.push('begin');
        },
        async commit() {
            transactionCalls.push('commit');
        },
        async rollback() {
            transactionCalls.push('rollback');
        },
    };
    const plan = await makePlan(connection, root);
    assert.equal(plan.remaining, 1);
    assert.equal(plan.selected, 1);
    const previousUmask = process.umask(0o077);
    try {
        await applyPlan(connection, sharp, root, plan);
    } finally {
        process.umask(previousUmask);
    }
    assert.match(row.source, /\.webp$/u);
    assert.match(row.preview, /\.webp$/u);
    assert.ok(imageUrl.includes(row.preview));
    assert.deepEqual(transactionCalls, ['begin', 'commit']);
    assert.equal((await sharp(await fs.readFile(path.join(root, row.source))).metadata()).format, 'webp');
    assert.equal((await sharp(await fs.readFile(path.join(root, row.preview))).metadata()).format, 'webp');
    assert.deepEqual(await fs.readFile(path.join(root, source)), original);
    assert.deepEqual(await fs.readFile(path.join(root, preview)), thumbnail);
    assert.equal((await makePlan(connection, root)).remaining, 0);

    for (const identifier of [row.source, row.preview]) {
        // eslint-disable-next-line no-bitwise -- POSIX permission bits are a bit mask.
        assert.equal((await fs.stat(path.join(root, identifier))).mode & 0o777, 0o644);
        await fs.chmod(path.join(root, identifier), 0o600);
    }
    const permissionsPlan = await makePlan(connection, root);
    assert.equal(permissionsPlan.phase, 'permissions');
    assert.equal(permissionsPlan.remaining, 1);
    assert.equal(permissionsPlan.selected, 1);
    await applyPlan(connection, sharp, root, permissionsPlan);
    assert.deepEqual(transactionCalls, ['begin', 'commit']);
    for (const identifier of [row.source, row.preview]) {
        // eslint-disable-next-line no-bitwise -- POSIX permission bits are a bit mask.
        assert.equal((await fs.stat(path.join(root, identifier))).mode & 0o777, 0o644);
    }
    assert.equal((await makePlan(connection, root)).remaining, 0);
});

void test('physical audit selects a PNG mislabelled as WebP', async t => {
    const project = fileURLToPath(new URL('../', import.meta.url));
    const root = await fs.mkdtemp(path.join(project, '.asset-webp-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'source'), { recursive: true });
    await fs.mkdir(path.join(root, 'preview'), { recursive: true });
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
        .png()
        .toBuffer();
    await fs.writeFile(path.join(root, 'source', 'wrong.webp'), png);
    await fs.writeFile(path.join(root, 'preview', 'wrong.webp'), png);
    const row = {
        id: 9,
        source: 'source/wrong.webp',
        preview: 'preview/wrong.webp',
        mimeType: 'image/webp',
        fileSize: png.length,
    };
    const connection = {
        async execute(sql) {
            if (sql.includes('SELECT COUNT(*)')) return [[{ count: 0 }]];
            if (sql.includes('LIMIT 500 OFFSET')) return [sql.includes('OFFSET 0') ? [row] : []];
            if (sql.includes('information_schema.columns')) return [[]];
            throw new Error(`Unexpected query: ${sql}`);
        },
    };
    const plan = await makePlan(connection, root);
    assert.equal(plan.phase, 'physical');
    assert.equal(plan.remaining, 1);
    assert.deepEqual(plan.ids, ['9']);
});
