#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE_DIRECTORY = '/var/lib/apport/coredump';
const BYTE_BUDGET = 2 * 1024 ** 3;
const CORE_NAME =
    /^core[.]_usr_bin_node[.]1000[.][a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}[.](?<pid>[1-9][0-9]*)[.][1-9][0-9]*$/u;

function vanished(error) {
    return error.code === 'ENOENT' || error.code === 'ESRCH';
}

function identity(info) {
    return Object.fromEntries(
        ['dev', 'ino', 'size', 'blocks', 'uid', 'gid', 'nlink', 'mtimeNs', 'ctimeNs'].map(key => [
            key,
            String(info[key]),
        ]),
    );
}

function settings(options = {}) {
    const directory = path.resolve(options.directory ?? CORE_DIRECTORY);
    const procRoot = path.resolve(options.procRoot ?? '/proc');
    const byteBudget = options.byteBudget ?? BYTE_BUDGET;
    assert.ok(Number.isSafeInteger(byteBudget) && byteBudget > 0, 'Invalid Node core byte budget');
    return {
        directory,
        procRoot,
        byteBudget,
        directoryUid: BigInt(options.directoryUid ?? 0),
        fileUid: BigInt(options.fileUid ?? 1000),
        io: options.io ?? fs,
    };
}

function directoryInfo(config) {
    const info = config.io.lstatSync(config.directory, { bigint: true });
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Node core directory must be a real directory');
    assert.equal(
        config.io.realpathSync(config.directory),
        config.directory,
        'Node core directory is redirected',
    );
    assert.equal(info.uid, config.directoryUid, 'Unexpected Node core directory owner');
    assert.equal(Number(info.mode & 0o022n), 0, 'Node core directory is writable by another account');
    return info;
}

function processAlive(pid, config) {
    try {
        config.io.lstatSync(path.join(config.procRoot, String(pid)));
        return true;
    } catch (error) {
        if (vanished(error)) return false;
        throw error;
    }
}

function openCorePaths(config) {
    const references = new Set();
    for (const processName of config.io.readdirSync(config.procRoot)) {
        if (!/^[1-9][0-9]*$/u.test(processName)) continue;
        const fdDirectory = path.join(config.procRoot, processName, 'fd');
        let descriptors;
        try {
            descriptors = config.io.readdirSync(fdDirectory);
        } catch (error) {
            if (vanished(error)) continue;
            throw error;
        }
        for (const descriptor of descriptors) {
            try {
                const target = config.io
                    .readlinkSync(path.join(fdDirectory, descriptor))
                    .replace(/ \(deleted\)$/u, '');
                if (path.dirname(target) === config.directory) references.add(target);
            } catch (error) {
                if (!vanished(error)) throw error;
            }
        }
    }
    return references;
}

function inspect(options = {}) {
    const config = settings(options);
    let root;
    try {
        root = directoryInfo(config);
    } catch (error) {
        if (error.code === 'ENOENT')
            return {
                directory: config.directory,
                status: 'directory-missing',
                deleteFiles: [],
                protectedFiles: [],
            };
        throw error;
    }
    const openPaths = openCorePaths(config);
    const files = [];
    const protectedFiles = [];
    for (const name of config.io.readdirSync(config.directory)) {
        const file = path.join(config.directory, name);
        const match = CORE_NAME.exec(name);
        if (!match) {
            protectedFiles.push({ file, reason: 'unknown-name' });
            continue;
        }
        let info;
        try {
            info = config.io.lstatSync(file, { bigint: true });
        } catch (error) {
            if (vanished(error)) continue;
            throw error;
        }
        if (!info.isFile() || info.isSymbolicLink() || info.uid !== config.fileUid || info.nlink !== 1n) {
            protectedFiles.push({ file, reason: 'unmanaged-file' });
            continue;
        }
        if (info.size <= 0n || info.blocks === 0n) {
            protectedFiles.push({ file, reason: 'incomplete-file' });
            continue;
        }
        const pid = Number(match.groups.pid);
        assert.ok(Number.isSafeInteger(pid), 'Invalid Node core PID');
        const allocatedBytes = Number(info.blocks * 512n);
        assert.ok(Number.isSafeInteger(allocatedBytes), 'Invalid Node core allocated size');
        const reason = processAlive(pid, config)
            ? 'active-pid'
            : openPaths.has(file)
              ? 'open-descriptor'
              : null;
        const entry = { file, pid, allocatedBytes, identity: identity(info), reason };
        files.push(entry);
        if (reason) protectedFiles.push({ file, reason });
    }
    files.sort((left, right) => {
        const a = BigInt(left.identity.mtimeNs);
        const b = BigInt(right.identity.mtimeNs);
        return a === b ? left.file.localeCompare(right.file) : a < b ? -1 : 1;
    });
    const completed = files.filter(file => !file.reason);
    const latest = completed.at(-1);
    const allocatedBytes = files.reduce((total, file) => total + file.allocatedBytes, 0);
    let retainedBytes = allocatedBytes;
    const deleteFiles = [];
    for (const file of completed) {
        if (retainedBytes <= config.byteBudget || file === latest) break;
        deleteFiles.push(file);
        retainedBytes -= file.allocatedBytes;
    }
    return {
        directory: config.directory,
        directoryIdentity: identity(root),
        status: retainedBytes > config.byteBudget ? 'protected-over-budget' : 'within-budget',
        byteBudget: config.byteBudget,
        allocatedBytes,
        retainedBytes,
        latestCompleted: latest?.file ?? null,
        deleteFiles,
        protectedFiles,
    };
}

function apply(plan, options = {}) {
    const config = settings(options);
    assert.deepEqual(inspect(options), plan, 'Node core inventory changed before retention');
    if (!plan.deleteFiles.length) return { ...plan, removedFiles: [] };
    const directoryFd = config.io.openSync(
        config.directory,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
    const removedFiles = [];
    try {
        assert.deepEqual(
            identity(config.io.fstatSync(directoryFd, { bigint: true })),
            plan.directoryIdentity,
        );
        for (const entry of plan.deleteFiles) {
            const currentDirectory = directoryInfo(config);
            // Deleting the previous entry changes directory timestamps, but never its identity or owner.
            for (const key of ['dev', 'ino', 'uid', 'gid'])
                assert.equal(
                    String(currentDirectory[key]),
                    plan.directoryIdentity[key],
                    'Node core directory changed',
                );
            assert.equal(processAlive(entry.pid, config), false, 'Node core process became active');
            assert.equal(
                openCorePaths(config).has(entry.file),
                false,
                'Node core acquired an open descriptor',
            );
            const current = config.io.lstatSync(entry.file, { bigint: true });
            assert.ok(current.isFile() && !current.isSymbolicLink(), 'Node core file type changed');
            assert.deepEqual(identity(current), entry.identity, 'Node core file metadata changed');
            const target =
                process.platform === 'linux'
                    ? path.join('/proc/self/fd', String(directoryFd), path.basename(entry.file))
                    : entry.file;
            config.io.unlinkSync(target);
            removedFiles.push(entry);
            options.onRemoved?.(entry);
        }
    } finally {
        config.io.closeSync(directoryFd);
    }
    return { ...plan, removedFiles };
}

function run({ arguments_ = process.argv.slice(2), options = {} } = {}) {
    assert.ok(
        arguments_.length <= 1 && arguments_.every(value => ['--dry-run', '--apply'].includes(value)),
        'Choose --dry-run or --apply; no directory, environment or budget override is accepted',
    );
    const plan = inspect(options);
    return arguments_[0] === '--apply'
        ? { mode: 'apply', ...apply(plan, options) }
        : { mode: 'dry-run', ...plan, removedFiles: [] };
}

if (require.main === module) {
    try {
        const result = run({
            options: {
                onRemoved: file =>
                    process.stdout.write(`${JSON.stringify({ event: 'node-core-removed', file })}\n`),
            },
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
        // Never forward arbitrary OS error text, process contents or crash-report data.
        process.stderr.write('NODE_CORE_RETENTION_BLOCKED metadata-or-reference-validation-failed\n');
        process.exitCode = 1;
    }
}

module.exports = { CORE_DIRECTORY, BYTE_BUDGET, inspect, apply, run };
