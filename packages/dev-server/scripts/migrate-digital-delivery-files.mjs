import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAFE_FILE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.(?:zip|pdf|txt|md)$/u;
const SAFE_CHANNEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;
// eslint-disable-next-line no-bitwise -- Combine OS open flags to reject symlinks on the actual opened file.
const READ_NO_SYMLINK = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;

async function fingerprint(filePath) {
    const handle = await open(filePath, READ_NO_SYMLINK);
    try {
        const metadata = await handle.stat();
        assert.ok(metadata.isFile(), 'Expected a regular delivery file');
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        return { metadata, sha256: hash.digest('hex') };
    } finally {
        await handle.close();
    }
}

function resolveChild(root, ...segments) {
    const candidate = path.resolve(root, ...segments);
    assert.ok(candidate.startsWith(`${root}${path.sep}`), 'Digital delivery path escaped its root');
    return candidate;
}

export function parseDigitalDeliveryMigrationArguments(args) {
    const options = { apply: false, manifestPath: '' };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--apply') options.apply = true;
        else if (argument === '--dry-run') options.apply = false;
        else if (argument === '--manifest') options.manifestPath = args[++index] ?? '';
        else throw new Error(`Unknown argument: ${String(argument)}`);
    }
    assert.ok(
        args.includes('--apply') !== args.includes('--dry-run'),
        'Pass exactly one of --dry-run or --apply',
    );
    assert.ok(options.manifestPath, '--manifest is required');
    return options;
}

export function validateDigitalDeliveryMigrationManifest(value) {
    assert.equal(value?.format, 1, 'Migration manifest format must be 1');
    assert.deepEqual(Object.keys(value).sort(), ['files', 'format'], 'Unknown migration manifest fields');
    assert.ok(Array.isArray(value.files), 'Migration manifest files must be an array');
    const sourceNames = new Set();
    const targetKeys = new Set();
    return {
        format: 1,
        files: value.files.map((item, index) => {
            assert.deepEqual(
                Object.keys(item).sort(),
                ['channelIds', 'fileName', 'sha256'],
                'Unknown file mapping fields',
            );
            assert.ok(SAFE_FILE_NAME.test(item?.fileName), `files[${index}].fileName is invalid`);
            assert.match(item?.sha256 ?? '', /^[a-f0-9]{64}$/u, `files[${index}].sha256 is invalid`);
            assert.ok(
                Array.isArray(item?.channelIds) && item.channelIds.length > 0,
                `files[${index}].channelIds is required`,
            );
            assert.ok(
                item.channelIds.every(
                    channelId =>
                        typeof channelId === 'string' || (Number.isSafeInteger(channelId) && channelId >= 0),
                ),
                'Channel assignments must be explicit string or integer IDs',
            );
            assert.equal(sourceNames.has(item.fileName), false, `Duplicate source file: ${item.fileName}`);
            sourceNames.add(item.fileName);
            const channelIds = Array.from(new Set(item.channelIds.map(channelId => String(channelId))));
            assert.equal(channelIds.length, item.channelIds.length, 'Duplicate Channel assignment');
            for (const channelId of channelIds) {
                assert.ok(SAFE_CHANNEL_ID.test(channelId), `Invalid Channel ID: ${channelId}`);
                const targetKey = `${channelId}\u0000${item.fileName}`;
                assert.equal(targetKeys.has(targetKey), false, `Duplicate migration target: ${targetKey}`);
                targetKeys.add(targetKey);
            }
            return { fileName: item.fileName, sha256: item.sha256, channelIds };
        }),
    };
}

async function existingLegacyFiles(root) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.filter(item => SAFE_FILE_NAME.test(item.name)))
        assert.ok(
            entry.isFile() && !entry.isSymbolicLink(),
            'Supported legacy source must be a regular file',
        );
    return entries
        .filter(entry => entry.isFile() && SAFE_FILE_NAME.test(entry.name))
        .map(entry => entry.name)
        .sort();
}

async function assertDirectoryIsNotSymlink(directory) {
    try {
        const metadata = await lstat(directory);
        assert.equal(metadata.isSymbolicLink(), false, `Refusing symbolic-link directory: ${directory}`);
        assert.equal(metadata.isDirectory(), true, `Expected a directory: ${directory}`);
        assert.equal(await realpath(directory), directory, 'Directory has a symbolic-link ancestor');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

async function syncDirectory(directory) {
    const handle = await open(directory, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function verifiedFile(filename, expectedHash) {
    const value = await fingerprint(filename);
    assert.equal(value.sha256, expectedHash, 'Delivery file content differs');
    return value.metadata;
}

async function publishCopy(root, item, stagingDirectory, onProgress) {
    const channelDirectory = resolveChild(root, item.channelId);
    await mkdir(channelDirectory, { recursive: true, mode: 0o700 });
    await assertDirectoryIsNotSymlink(root);
    await assertDirectoryIsNotSymlink(channelDirectory);
    await assertDirectoryIsNotSymlink(stagingDirectory);
    const sourcePath = resolveChild(root, item.fileName);
    const targetPath = resolveChild(root, item.channelId, item.fileName);
    // An interrupted process can only leave an unpublished file here. A new run verifies final targets and resumes.
    const stagedPath = resolveChild(stagingDirectory, `copy-${randomUUID()}.partial`);
    const source = await open(sourcePath, READ_NO_SYMLINK);
    let staged;
    try {
        assert.ok((await source.stat()).isFile(), 'Source changed to a non-file');
        staged = await open(stagedPath, 'wx', 0o600);
        let bytesWritten = 0;
        for await (const chunk of source.createReadStream({ autoClose: false })) {
            await staged.writeFile(chunk);
            bytesWritten += chunk.length;
            await onProgress({
                phase: 'copying',
                fileName: item.fileName,
                channelId: item.channelId,
                bytesWritten,
            });
        }
        await staged.sync();
        await verifiedFile(stagedPath, item.sha256);
        await verifiedFile(sourcePath, item.sha256);
        await assertDirectoryIsNotSymlink(channelDirectory);
        await assertDirectoryIsNotSymlink(stagingDirectory);
        await onProgress({ phase: 'verified', fileName: item.fileName, channelId: item.channelId });
        try {
            // link is an atomic, exclusive publication: readers never see partial bytes and existing files are never replaced.
            await link(stagedPath, targetPath);
            await syncDirectory(channelDirectory);
            await onProgress({ phase: 'published', fileName: item.fileName, channelId: item.channelId });
            return 'copied';
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            await verifiedFile(targetPath, item.sha256);
            return 'already-present';
        }
    } finally {
        await source.close();
        if (staged) {
            await staged.close();
            // Only the temporary file created by this invocation is removed. Legacy and destination files are retained.
            await unlink(stagedPath);
        }
    }
}

async function writeCopyReceipt(directory, manifestSha256, receipt) {
    const temp = resolveChild(directory, `receipt-${randomUUID()}.partial`);
    const file = await open(temp, 'wx', 0o600);
    try {
        await file.writeFile(`${JSON.stringify(receipt, null, 2)}\n`);
        await file.sync();
    } finally {
        await file.close();
    }
    await rename(temp, resolveChild(directory, `receipt-${manifestSha256}.json`));
    await syncDirectory(directory);
}

export async function migrateDigitalDeliveryFiles({
    rootDirectory,
    manifest,
    apply = false,
    onProgress = async () => undefined,
}) {
    assert.equal(typeof apply, 'boolean', 'apply must be a boolean');
    assert.equal(typeof onProgress, 'function', 'onProgress must be a function');
    assert.ok(rootDirectory, 'DIGITAL_DELIVERY_ROOT is required');
    const root = path.resolve(rootDirectory);
    const rootMetadata = await lstat(root);
    assert.equal(rootMetadata.isDirectory(), true, 'DIGITAL_DELIVERY_ROOT must be a directory');
    assert.equal(rootMetadata.isSymbolicLink(), false, 'DIGITAL_DELIVERY_ROOT must not be a symbolic link');
    await assertDirectoryIsNotSymlink(root);
    const validated = validateDigitalDeliveryMigrationManifest(manifest);
    const legacyFiles = await existingLegacyFiles(root);
    const manifestFiles = validated.files.map(item => item.fileName).sort();
    assert.deepEqual(
        manifestFiles,
        legacyFiles,
        'Manifest must cover every supported top-level legacy file exactly once',
    );

    const plan = [];
    for (const item of validated.files) {
        const sourcePath = resolveChild(root, item.fileName);
        const sourceMetadata = await lstat(sourcePath);
        assert.equal(sourceMetadata.isFile(), true, `Legacy source is not a regular file: ${item.fileName}`);
        assert.equal(
            sourceMetadata.isSymbolicLink(),
            false,
            `Legacy source must not be a symbolic link: ${item.fileName}`,
        );
        const sourceHash = (await fingerprint(sourcePath)).sha256;
        assert.equal(sourceHash, item.sha256, `Legacy source hash changed: ${item.fileName}`);
        for (const channelId of item.channelIds) {
            const channelDirectory = resolveChild(root, channelId);
            const targetPath = resolveChild(root, channelId, item.fileName);
            await assertDirectoryIsNotSymlink(channelDirectory);
            let action = 'copy';
            try {
                const targetMetadata = await lstat(targetPath);
                assert.equal(
                    targetMetadata.isFile(),
                    true,
                    `Migration target is not a regular file: ${targetPath}`,
                );
                assert.equal(
                    targetMetadata.isSymbolicLink(),
                    false,
                    `Migration target is a symbolic link: ${targetPath}`,
                );
                assert.equal(
                    (await fingerprint(targetPath)).sha256,
                    sourceHash,
                    `Migration target content differs: ${targetPath}`,
                );
                action = 'already-present';
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
            }
            plan.push({
                fileName: item.fileName,
                channelId,
                bytes: sourceMetadata.size,
                sha256: sourceHash,
                action,
            });
        }
    }

    let copiedCount = 0;
    const manifestSha256 = createHash('sha256').update(JSON.stringify(validated)).digest('hex');
    const stagingDirectory = resolveChild(root, '.migration-staging');
    if (apply) {
        await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
        await assertDirectoryIsNotSymlink(stagingDirectory);
        for (const item of plan.filter(entry => entry.action === 'copy')) {
            item.action = await publishCopy(root, item, stagingDirectory, onProgress);
            if (item.action === 'copied') copiedCount++;
        }
        assert.deepEqual(
            await existingLegacyFiles(root),
            manifestFiles,
            'Legacy inventory changed while copying',
        );
        for (const item of plan) {
            await assertDirectoryIsNotSymlink(resolveChild(root, item.channelId));
            await verifiedFile(resolveChild(root, item.fileName), item.sha256);
            await verifiedFile(resolveChild(root, item.channelId, item.fileName), item.sha256);
        }
    }
    const result = {
        mode: apply ? 'apply' : 'dry-run',
        sourceFilesRetained: true,
        manifestSha256,
        copiedCount,
        readyForScopedRead: apply || plan.every(item => item.action === 'already-present'),
        runtimeSwitched: false,
        plan,
    };
    if (apply) await writeCopyReceipt(stagingDirectory, manifestSha256, result);
    return result;
}

async function main() {
    await import('dotenv/config');
    const options = parseDigitalDeliveryMigrationArguments(process.argv.slice(2));
    const manifest = JSON.parse(await readFile(path.resolve(options.manifestPath), 'utf8'));
    const rootDirectory = process.env.DIGITAL_DELIVERY_ROOT?.trim();
    if (process.env.NODE_ENV === 'production') {
        assert.ok(path.isAbsolute(rootDirectory ?? ''), 'Production DIGITAL_DELIVERY_ROOT must be absolute');
    }
    const result = await migrateDigitalDeliveryFiles({
        rootDirectory,
        manifest,
        apply: options.apply,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
