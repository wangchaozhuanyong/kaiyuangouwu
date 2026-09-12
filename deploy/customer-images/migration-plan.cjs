'use strict';
// Local preparation only. Does not contact S3, update a database, delete originals or deploy.
const { createHash } = require('node:crypto');
const { mkdir, open, readFile, realpath, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { processCustomerImage } = require('../../packages/core/dist/common/process-customer-image.js');
const sharp = require(require.resolve('sharp', { paths: [path.join(__dirname, '../../packages/core')] }));
const TYPES = new Set(['avatar-source', 'avatar-preview', 'reference', 'output']);

async function prepareMigration(inventory, sourceRoots, outputDirectory, processor = processCustomerImage) {
    if (inventory?.version !== 1 || !Array.isArray(inventory.assets) || inventory.assets.length > 200)
        throw new Error('Invalid inventory; use batches of at most 200');
    // A new output directory is required; existing plans/staged images are never overwritten.
    await mkdir(outputDirectory, { mode: 0o700 });
    const assets = [];
    const ids = new Set();
    for (const item of inventory.assets) {
        if (
            !TYPES.has(item.kind) ||
            typeof item.id !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) ||
            typeof item.storageKey !== 'string' ||
            item.storageKey.length > 255 ||
            !/^[a-zA-Z0-9/_.-]+$/.test(item.storageKey) ||
            item.storageKey.split('/').some(part => !part || part === '.' || part === '..')
        )
            throw new Error('Invalid inventory entry');
        const identity = item.kind + ':' + item.id;
        if (ids.has(identity)) throw new Error('Duplicate inventory entry');
        ids.add(identity);
        const root = await realpath(sourceRoots[item.kind.startsWith('avatar-') ? 'avatars' : 'private']);
        const source = await realpath(path.join(root, item.storageKey));
        if (!source.startsWith(root + path.sep)) throw new Error('Source path escaped inventory root');
        const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
        let input;
        try {
            const details = await handle.stat();
            const limit = item.kind.startsWith('avatar-')
                ? 5 * 1024 * 1024
                : item.kind === 'reference'
                  ? 10 * 1024 * 1024
                  : 25 * 1024 * 1024;
            if (!details.isFile() || !details.size || details.size > limit)
                throw new Error('Source file exceeds migration limit');
            const chunks = [];
            let size = 0;
            for (;;) {
                const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - size));
                const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
                if (!bytesRead) break;
                size += bytesRead;
                if (size > limit) throw new Error('Source grew beyond migration limit');
                chunks.push(chunk.subarray(0, bytesRead));
            }
            input = Buffer.concat(chunks);
            if (input.length !== details.size || input.length > limit)
                throw new Error('Source changed during read');
        } finally {
            await handle.close();
        }
        const inputSha256 = createHash('sha256').update(input).digest('hex');
        if (item.sha256 && item.sha256 !== inputSha256) throw new Error('Source checksum changed');
        const kind = item.kind.startsWith('avatar-') ? 'avatar' : item.kind;
        const normalized = await processor(input, kind);
        const sha256 = createHash('sha256').update(normalized).digest('hex');
        const { fileTypeFromBuffer } = await import(
            require.resolve('file-type', { paths: [path.join(__dirname, '../../packages/core')] })
        );
        const mime = await fileTypeFromBuffer(normalized);
        if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime.mime))
            throw new Error('Invalid processed image');
        const metadata = await sharp(normalized, {
            limitInputPixels: 40_000_000,
            failOn: 'warning',
        }).metadata();
        if (!metadata.width || !metadata.height) throw new Error('Missing processed dimensions');
        const name =
            createHash('sha256')
                .update(identity + ':' + inputSha256)
                .digest('hex') +
            '.' +
            mime.ext;
        const key =
            kind === 'avatar'
                ? `avatars/v2/${item.kind === 'avatar-source' ? 'source' : 'preview'}/${name}`
                : `private/v1/${kind}/migration/${name}`;
        await writeFile(path.join(outputDirectory, name), normalized, { mode: 0o600, flag: 'wx' });
        assets.push({
            id: item.id,
            kind: item.kind,
            oldKey: item.storageKey,
            newKey: key,
            inputSha256,
            sha256,
            byteSize: normalized.length,
            mimeType: mime.mime,
            width: metadata.width,
            height: metadata.height,
            stagedFile: name,
        });
    }
    const plan = {
        version: 1,
        createdAt: new Date().toISOString(),
        isolatedProcessor: !!process.env.CUSTOMER_IMAGE_PROCESSOR_SOCKET,
        assets,
        count: assets.length,
        bytes: assets.reduce((total, item) => total + item.byteSize, 0),
    };
    await writeFile(path.join(outputDirectory, 'plan.json'), JSON.stringify(plan, null, 2), {
        mode: 0o600,
        flag: 'wx',
    });
    return plan;
}
if (require.main === module)
    (async () => {
        const [inventoryFile, avatarRoot, privateRoot, outputDirectory] = process.argv.slice(2);
        if (![inventoryFile, avatarRoot, privateRoot, outputDirectory].every(Boolean))
            throw new Error('Expected inventory, avatar root, private root, and new staging directory');
        if ((await stat(inventoryFile)).size > 512 * 1024) throw new Error('Inventory too large');
        const text = await readFile(inventoryFile, 'utf8');
        if (text.length > 512 * 1024) throw new Error('Inventory too large');
        const plan = await prepareMigration(
            JSON.parse(text),
            { avatars: avatarRoot, private: privateRoot },
            path.resolve(outputDirectory),
        );
        process.stdout.write(
            JSON.stringify({
                count: plan.count,
                bytes: plan.bytes,
                isolatedProcessor: plan.isolatedProcessor,
            }) + '\n',
        );
    })().catch(() => {
        process.stderr.write('Migration preparation failed; original files were not modified\n');
        process.exitCode = 1;
    });
module.exports = { prepareMigration };
