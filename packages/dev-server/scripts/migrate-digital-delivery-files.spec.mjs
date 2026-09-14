import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    migrateDigitalDeliveryFiles,
    parseDigitalDeliveryMigrationArguments,
} from './migrate-digital-delivery-files.mjs';

const content = Buffer.from('isolated delivery');
const digest = createHash('sha256').update(content).digest('hex');

test('parseDigitalDeliveryMigrationArguments requires an explicit mode and manifest', () => {
    assert.deepEqual(parseDigitalDeliveryMigrationArguments(['--dry-run', '--manifest', 'plan.json']), {
        apply: false,
        manifestPath: 'plan.json',
    });
    assert.throws(() => parseDigitalDeliveryMigrationArguments(['--manifest', 'plan.json']), /exactly one/u);
    assert.throws(
        () => parseDigitalDeliveryMigrationArguments(['--dry-run', '--apply', '--manifest', 'plan.json']),
        /exactly one/u,
    );
});

test('dry-run plans copies and apply preserves the verified legacy source', async () => {
    const parent = new URL('../../../reports/pending-migrations-20260913/fixtures/', import.meta.url);
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(fileURLToPath(parent), 'digital-delivery-migration-'));
    try {
        await writeFile(path.join(root, 'SKU-1.txt'), content);
        const manifest = {
            format: 1,
            files: [{ fileName: 'SKU-1.txt', sha256: digest, channelIds: ['channel-a', 'channel-b'] }],
        };

        const preview = await migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: false });
        assert.equal(preview.copiedCount, 0);
        assert.deepEqual(
            preview.plan.map(item => ({ channelId: item.channelId, action: item.action })),
            [
                { channelId: 'channel-a', action: 'copy' },
                { channelId: 'channel-b', action: 'copy' },
            ],
        );

        const applied = await migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: true });
        assert.equal(applied.copiedCount, 2);
        assert.equal(applied.sourceFilesRetained, true);
        assert.deepEqual(await readFile(path.join(root, 'SKU-1.txt')), content);
        assert.deepEqual(await readFile(path.join(root, 'channel-a', 'SKU-1.txt')), content);
        assert.deepEqual(await readFile(path.join(root, 'channel-b', 'SKU-1.txt')), content);

        const replay = await migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: true });
        assert.equal(replay.copiedCount, 0);
        assert.ok(replay.plan.every(item => item.action === 'already-present'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('refuses incomplete manifests and changed source content', async () => {
    const parent = new URL('../../../reports/pending-migrations-20260913/fixtures/', import.meta.url);
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(fileURLToPath(parent), 'digital-delivery-migration-'));
    try {
        await writeFile(path.join(root, 'SKU-1.txt'), content);
        await writeFile(path.join(root, 'SKU-2.txt'), 'second');
        await assert.rejects(
            migrateDigitalDeliveryFiles({
                rootDirectory: root,
                manifest: {
                    format: 1,
                    files: [{ fileName: 'SKU-1.txt', sha256: digest, channelIds: ['channel-a'] }],
                },
                apply: false,
            }),
            /cover every supported top-level legacy file/u,
        );
        const secondDigest = createHash('sha256').update('second').digest('hex');
        await assert.rejects(
            migrateDigitalDeliveryFiles({
                rootDirectory: root,
                manifest: {
                    format: 1,
                    files: [
                        { fileName: 'SKU-1.txt', sha256: '0'.repeat(64), channelIds: ['channel-a'] },
                        { fileName: 'SKU-2.txt', sha256: secondDigest, channelIds: ['channel-a'] },
                    ],
                },
                apply: false,
            }),
            /source hash changed/u,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

async function fixture(action) {
    const parent = fileURLToPath(
        new URL('../../../reports/pending-migrations-20260913/fixtures/', import.meta.url),
    );
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'digital-atomic-'));
    try {
        await writeFile(path.join(root, 'SKU-1.txt'), content);
        const manifest = {
            format: 1,
            files: [{ fileName: 'SKU-1.txt', sha256: digest, channelIds: ['a', 'b'] }],
        };
        await action(root, manifest);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test('atomic copies are private, yield durable verified receipts and do not switch runtime', async () =>
    fixture(async (root, manifest) => {
        const preview = await migrateDigitalDeliveryFiles({ rootDirectory: root, manifest });
        assert.equal(preview.readyForScopedRead, false);
        assert.deepEqual(await readdir(root), ['SKU-1.txt']);
        const result = await migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: true });
        const receipt = path.join(root, '.migration-staging', `receipt-${result.manifestSha256}.json`);
        assert.deepEqual(JSON.parse(await readFile(receipt)), result);
        assert.equal(result.readyForScopedRead, true);
        assert.equal(result.runtimeSwitched, false);
        assert.equal((await lstat(receipt)).mode % 0o1000, 0o600);
        assert.equal((await lstat(path.join(root, 'a', 'SKU-1.txt'))).mode % 0o1000, 0o600);
        assert.ok(
            (await readdir(path.join(root, '.migration-staging'))).every(name => name.endsWith('.json')),
        );
    }));

test('two independent copy attempts converge without overwrites or double-counted publication', async () =>
    fixture(async (root, manifest) => {
        const results = await Promise.all(
            [1, 2].map(() => migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: true })),
        );
        assert.equal(
            results.reduce((sum, result) => sum + result.copiedCount, 0),
            2,
        );
        for (const channel of ['a', 'b'])
            assert.deepEqual(await readFile(path.join(root, channel, 'SKU-1.txt')), content);
        assert.deepEqual(await readFile(path.join(root, 'SKU-1.txt')), content);
    }));

test('all target conflicts are rejected before any copy and pre-existing contents remain intact', async () =>
    fixture(async (root, manifest) => {
        await mkdir(path.join(root, 'b'));
        await writeFile(path.join(root, 'b', 'SKU-1.txt'), 'existing-independent-content');
        await assert.rejects(
            migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: true }),
            /content differs/u,
        );
        await assert.rejects(lstat(path.join(root, 'a')), { code: 'ENOENT' });
        assert.equal(
            await readFile(path.join(root, 'b', 'SKU-1.txt'), 'utf8'),
            'existing-independent-content',
        );
    }));

test('symlink sources, destination directories and root ancestors are rejected', async () =>
    fixture(async (root, manifest) => {
        await symlink(path.join(root, 'SKU-1.txt'), path.join(root, 'SKU-2.txt'));
        await assert.rejects(
            migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: true }),
            /regular file/u,
        );
        await rm(path.join(root, 'SKU-2.txt'));
        await mkdir(path.join(root, 'safe'));
        await symlink(path.join(root, 'safe'), path.join(root, 'a'));
        await assert.rejects(
            migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: true }),
            /symbolic-link/u,
        );
        await mkdir(path.join(root, 'safe', 'nested'));
        await assert.rejects(
            migrateDigitalDeliveryFiles({
                rootDirectory: path.join(root, 'a', 'nested'),
                manifest: { format: 1, files: [] },
            }),
            /symbolic-link ancestor/u,
        );
        assert.deepEqual(await readdir(path.join(root, 'safe')), ['nested']);
    }));

test('unknown ownership fields, duplicate assignments and nonboolean apply are rejected', async () =>
    fixture(async (root, manifest) => {
        for (const changed of [
            { ...manifest, ignoreUnknownOwnership: true },
            { ...manifest, files: [{ ...manifest.files[0], channelIds: ['a', 'a'] }] },
            { ...manifest, files: [{ ...manifest.files[0], channelIds: [null] }] },
            { ...manifest, files: [{ ...manifest.files[0], channelIds: [1.5] }] },
            { ...manifest, files: [{ ...manifest.files[0], unknownReference: 'unreviewed' }] },
        ])
            await assert.rejects(
                migrateDigitalDeliveryFiles({ rootDirectory: root, manifest: changed, apply: true }),
            );
        await assert.rejects(
            migrateDigitalDeliveryFiles({ rootDirectory: root, manifest, apply: 'false' }),
            /boolean/u,
        );
        assert.deepEqual(await readdir(root), ['SKU-1.txt']);
    }));

async function killedCopy(root, manifest, phase) {
    const moduleUrl = new URL('./migrate-digital-delivery-files.mjs', import.meta.url).href;
    const code = `import {migrateDigitalDeliveryFiles} from ${JSON.stringify(moduleUrl)};
        await migrateDigitalDeliveryFiles({rootDirectory:process.argv[1], manifest:JSON.parse(process.argv[2]),apply:true,
        onProgress:async event=>{if(event.phase===process.argv[3]) process.kill(process.pid,'SIGKILL');}});`;
    const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', code, root, JSON.stringify(manifest), phase],
        { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', chunk => {
        stderr += chunk;
    });
    const result = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    assert.equal(result.signal, 'SIGKILL', stderr);
}

for (const phase of ['copying', 'published'])
    test(`SIGKILL while ${phase} resumes from verified files in a new process`, async () =>
        fixture(async (root, manifest) => {
            const large = Buffer.alloc(256 * 1024, 97);
            await writeFile(path.join(root, 'SKU-1.txt'), large);
            manifest.files[0].sha256 = createHash('sha256').update(large).digest('hex');
            await killedCopy(root, manifest, phase);
            if (phase === 'copying') {
                await assert.rejects(lstat(path.join(root, 'a', 'SKU-1.txt')), { code: 'ENOENT' });
                const staged = (await readdir(path.join(root, '.migration-staging'))).find(name =>
                    name.endsWith('.partial'),
                );
                assert.ok(staged);
                const bytes = (await lstat(path.join(root, '.migration-staging', staged))).size;
                assert.ok(
                    bytes > 0 && bytes < large.length,
                    'A real partial staged file must remain unpublished',
                );
            } else assert.deepEqual(await readFile(path.join(root, 'a', 'SKU-1.txt')), large);
            const moduleUrl = new URL('./migrate-digital-delivery-files.mjs', import.meta.url).href;
            const code = `import {migrateDigitalDeliveryFiles} from ${JSON.stringify(moduleUrl)};
                const result=await migrateDigitalDeliveryFiles({
                    rootDirectory:process.argv[1],manifest:JSON.parse(process.argv[2]),apply:true});
                console.log(JSON.stringify(result));`;
            const child = spawn(process.execPath, [
                '--input-type=module',
                '-e',
                code,
                root,
                JSON.stringify(manifest),
            ]);
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', value => {
                stdout += value;
            });
            child.stderr.on('data', value => {
                stderr += value;
            });
            const exitCode = await new Promise((resolve, reject) => {
                child.once('error', reject);
                child.once('close', resolve);
            });
            assert.equal(exitCode, 0, stderr);
            const result = JSON.parse(stdout);
            assert.equal(result.copiedCount, phase === 'copying' ? 2 : 1);
            assert.equal(result.readyForScopedRead, true);
            for (const channel of ['a', 'b'])
                assert.deepEqual(await readFile(path.join(root, channel, 'SKU-1.txt')), large);
            assert.deepEqual(await readFile(path.join(root, 'SKU-1.txt')), large);
        }));

test('source drift during copy never publishes a destination or cutover-ready receipt', async () =>
    fixture(async (root, manifest) => {
        await assert.rejects(
            migrateDigitalDeliveryFiles({
                rootDirectory: root,
                manifest,
                apply: true,
                onProgress: async event => {
                    if (event.phase === 'copying')
                        await writeFile(path.join(root, 'SKU-1.txt'), 'changed-source');
                },
            }),
            /content differs/u,
        );
        await assert.rejects(lstat(path.join(root, 'a', 'SKU-1.txt')), { code: 'ENOENT' });
        assert.deepEqual(await readdir(path.join(root, '.migration-staging')), []);
    }));
