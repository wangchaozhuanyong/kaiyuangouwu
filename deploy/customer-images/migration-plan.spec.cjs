'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile, symlink } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../../packages/core')] }));
const { prepareMigration } = require('./migration-plan.cjs');

test('migration preparation verifies checksums, writes a new private plan, and preserves the source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'image-migration-'));
    try {
        const source = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
            .png()
            .toBuffer();
        await writeFile(path.join(root, 'old.png'), source);
        const inventory = {
            version: 1,
            assets: [{ id: 'asset-1', kind: 'reference', storageKey: 'old.png' }],
        };
        const plan = await prepareMigration(
            inventory,
            { avatars: root, private: root },
            path.join(root, 'plan'),
        );
        assert.equal(plan.count, 1);
        assert.equal(plan.assets[0].width, 10);
        assert.equal(plan.assets[0].height, 10);
        assert.match(plan.assets[0].newKey, /^private\/v1\/reference\/migration\//);
        assert.deepEqual(await readFile(path.join(root, 'old.png')), source);
        await assert.rejects(
            prepareMigration(inventory, { avatars: root, private: root }, path.join(root, 'plan')),
        );
        inventory.assets[0].sha256 = 'changed';
        await assert.rejects(
            prepareMigration(inventory, { avatars: root, private: root }, path.join(root, 'changed')),
            /checksum/,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('migration records dimensions after orientation and refuses paths outside the reviewed root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'image-migration-orientation-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'image-migration-outside-'));
    try {
        const source = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#fff' } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer();
        await writeFile(path.join(root, 'oriented.jpg'), source);
        const inventory = {
            version: 1,
            assets: [{ id: 'oriented', kind: 'reference', storageKey: 'oriented.jpg' }],
        };
        const plan = await prepareMigration(
            inventory,
            { avatars: root, private: root },
            path.join(root, 'plan'),
        );
        assert.equal(plan.assets[0].width, 8);
        assert.equal(plan.assets[0].height, 12);
        await writeFile(path.join(outside, 'synthetic.jpg'), source);
        await symlink(path.join(outside, 'synthetic.jpg'), path.join(root, 'escape.jpg'));
        inventory.assets[0].storageKey = 'escape.jpg';
        await assert.rejects(
            prepareMigration(inventory, { avatars: root, private: root }, path.join(root, 'refused')),
            /escaped/,
        );
        assert.deepEqual(await readFile(path.join(outside, 'synthetic.jpg')), source);
    } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    }
});

test('storage template retains buckets and never grants public or decoder access', async () => {
    const template = JSON.parse(await readFile(path.join(__dirname, 'storage.template.json'), 'utf8'));
    for (const name of ['AvatarBucket', 'PrivateImageBucket']) {
        const bucket = template.Resources[name];
        assert.equal(bucket.DeletionPolicy, 'Retain');
        assert.deepEqual(Object.values(bucket.Properties.PublicAccessBlockConfiguration), [
            true,
            true,
            true,
            true,
        ]);
    }
    const statements = template.Resources.PrivateImageBucketPolicy.Properties.PolicyDocument.Statement;
    assert.equal(
        statements.some(statement => statement.Effect === 'Allow' && statement.Principal === '*'),
        false,
    );
    assert.equal(template.Resources.ApplicationImagePolicy.Properties.Roles, undefined);
});
