#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND_RELEASES_DIR = '/var/www/kaiyuangouwu-frontend-releases';
const STOREFRONT_RELEASES_DIR = '/var/www/kaiyuangouwu-storefront-releases';
const RUNTIME_RELEASES_DIR = '/var/www/kaiyuangouwu-releases';
const PRODUCTION_LOCK = '/run/lock/vendure-production-deploy.lock';
const COMPONENTS = ['storefront', 'next-admin', 'two-factor'];
const POINTERS = Object.fromEntries(COMPONENTS.map(name => [name, `/var/www/kaiyuangouwu-${name}-current`]));
const SHA = /^[a-f0-9]{40}$/u;
const HASH = /^[a-f0-9]{64}$/u;

function parseReleaseName(name) {
    const match =
        /^(?<kind>frontends|storefront-fast)-(?<sha>[a-f0-9]{40})-(?<runId>[0-9]+)-(?<attempt>[0-9]+)$/u.exec(
            name,
        );
    return match ? { name, ...match.groups } : null;
}

function compareReleaseOrder(left, right) {
    for (const key of ['runId', 'attempt']) {
        if (BigInt(left[key]) !== BigInt(right[key])) return BigInt(left[key]) < BigInt(right[key]) ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
}

function identity(info) {
    return Object.fromEntries(
        ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'blocks', 'mtimeNs', 'ctimeNs'].map(key => [
            key,
            String(info[key]),
        ]),
    );
}

function absolute(value, label) {
    assert.ok(path.isAbsolute(value), `${label} must be absolute`);
    const normalized = path.normalize(value);
    assert.notEqual(normalized, path.parse(normalized).root, `${label} cannot be a filesystem root`);
    return normalized;
}

function settings(options = {}) {
    const roots = [
        {
            directory: absolute(
                options.frontendReleasesDir ?? FRONTEND_RELEASES_DIR,
                'Frontend releases directory',
            ),
            kind: 'frontends',
        },
        {
            directory: absolute(
                options.storefrontReleasesDir ?? STOREFRONT_RELEASES_DIR,
                'Legacy storefront releases directory',
            ),
            kind: 'storefront-fast',
        },
    ];
    assert.notEqual(roots[0].directory, roots[1].directory, 'Frontend roots must be separate');
    const keepRollbackCount = options.keepRollbackCount ?? 2;
    assert.ok(
        Number.isSafeInteger(keepRollbackCount) && keepRollbackCount >= 2 && keepRollbackCount <= 10,
        'Keep between 2 and 10 frontend rollbacks',
    );
    const protectedSourceShas = [...new Set(options.protectedSourceShas ?? [])].sort();
    for (const sha of protectedSourceShas) assert.match(sha, SHA, 'Invalid protected source SHA');
    const protectedDirectories = [
        ...new Set((options.protectedDirectories ?? []).map(value => absolute(value, 'Protected candidate'))),
    ].sort();
    for (const directory of protectedDirectories) {
        const root = roots.find(item => item.directory === path.dirname(directory));
        assert.ok(
            root && parseReleaseName(path.basename(directory))?.kind === root.kind,
            'Protected candidate must be a recognized direct child of a frontend root',
        );
    }
    return {
        roots,
        runtimeReleasesDir: absolute(
            options.runtimeReleasesDir ?? RUNTIME_RELEASES_DIR,
            'Runtime releases directory',
        ),
        pointers: Object.fromEntries(
            COMPONENTS.map(component => [
                component,
                absolute(options.pointers?.[component] ?? POINTERS[component], 'Frontend pointer'),
            ]),
        ),
        keepRollbackCount,
        protectedDirectories,
        protectedSourceShas,
    };
}

function present(file) {
    try {
        return fs.lstatSync(file, { bigint: true });
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function realDirectory(directory) {
    const info = fs.lstatSync(directory, { bigint: true });
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Release path must be a real directory');
    assert.equal(fs.realpathSync(directory), directory, 'Release directory is redirected');
    return identity(info);
}

function readMarker(file) {
    const info = fs.lstatSync(file, { bigint: true });
    assert.ok(
        info.isFile() && !info.isSymbolicLink() && info.nlink === 1n && info.size > 0n && info.size <= 65536n,
        'Invalid release manifest file',
    );
    const bytes = fs.readFileSync(file);
    return {
        value: JSON.parse(bytes),
        digest: createHash('sha256').update(bytes).digest('hex'),
        identity: identity(info),
    };
}

function fileHash(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        assert.ok(fs.fstatSync(fd).isFile(), 'Archive must be a regular file');
        const digest = createHash('sha256');
        const chunk = Buffer.alloc(64 * 1024);
        let count;
        while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0)
            digest.update(chunk.subarray(0, count));
        return digest.digest('hex');
    } finally {
        fs.closeSync(fd);
    }
}

// Match the static release model used by frontend-release.mjs, including its
// independent nested .two-factor output. Runtime outputs have no archive hash.
function componentEvidence(directory, component, release, runtime = false) {
    realDirectory(directory);
    const markerFile = path.join(
        directory,
        runtime || release.kind === 'frontends' ? 'frontend-release.json' : 'storefront-release.json',
    );
    const marker = readMarker(markerFile);
    assert.equal(marker.value.sourceSha, release.sha, 'Frontend manifest source differs from directory');
    assert.match(marker.value.backendSha ?? '', SHA, 'Invalid frontend backend revision');
    if (runtime || release.kind === 'frontends')
        assert.equal(marker.value.component, component, 'Frontend component differs from manifest');
    if (runtime) assert.equal(marker.value.releaseLane, 'runtime', 'Invalid runtime frontend manifest');
    else assert.match(marker.value.artifactSha256 ?? '', HASH, 'Invalid frontend archive checksum');
    if (release.kind === 'storefront-fast')
        assert.equal(
            marker.value.artifact,
            `${release.name}.tar.gz`,
            'Legacy frontend manifest archive differs',
        );
    const index = fs.lstatSync(path.join(directory, 'index.html'), { bigint: true });
    assert.ok(index.isFile() && !index.isSymbolicLink() && index.size > 0n, 'Frontend index is missing');
    realDirectory(path.join(directory, 'assets'));
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const assets = [...html.matchAll(/(?:src|href)=["']((?:\/dashboard)?\/assets\/[^"']+)["']/gu)].map(
        match => match[1],
    );
    assert.ok(
        assets.some(asset => asset.endsWith('.js')),
        'Frontend has no JavaScript entry',
    );
    const assetIdentities = assets.map(asset => {
        const relative = asset.replace(/^\/dashboard/u, '').slice(1);
        const file = path.resolve(directory, relative);
        assert.ok(file.startsWith(`${directory}/assets/`), 'Frontend asset escaped its assets directory');
        assert.equal(fs.realpathSync(file), file, 'Frontend asset is redirected');
        const info = fs.lstatSync(file, { bigint: true });
        assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0n, 'Frontend asset is missing');
        return { file, identity: identity(info) };
    });
    return { component, directory, marker, indexIdentity: identity(index), assetIdentities };
}

function treeEvidence(directory) {
    const digest = createHash('sha256');
    let allocatedBytes = 0;
    const visit = file => {
        const info = fs.lstatSync(file, { bigint: true });
        assert.ok(
            !info.isSymbolicLink() && (info.isFile() || info.isDirectory()),
            'Frontend release contains a link or unmanaged entry',
        );
        if (info.isFile()) assert.equal(info.nlink, 1n, 'Frontend release contains a shared file');
        digest.update(JSON.stringify([path.relative(directory, file), identity(info)]));
        allocatedBytes += Number(info.blocks * 512n);
        if (info.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    };
    visit(directory);
    assert.ok(Number.isSafeInteger(allocatedBytes), 'Invalid frontend allocated size');
    return { digest: digest.digest('hex'), allocatedBytes };
}

function inspectCandidate(directory, release) {
    realDirectory(directory);
    const components = [];
    if (release.kind === 'storefront-fast')
        components.push(componentEvidence(directory, 'storefront', release));
    else {
        const entries = fs.readdirSync(directory).sort();
        assert.ok(
            entries.length > 0 && entries.every(name => ['storefront', 'next-admin'].includes(name)),
            'Frontend release has unknown top-level content',
        );
        for (const component of entries)
            components.push(componentEvidence(path.join(directory, component), component, release));
        const vault = path.join(directory, 'storefront/.two-factor');
        if (present(vault)) components.push(componentEvidence(vault, 'two-factor', release));
    }
    const hashes = new Set(components.map(item => item.marker.value.artifactSha256));
    assert.equal(hashes.size, 1, 'Frontend components have different archive hashes');
    return {
        ...release,
        directory,
        components,
        artifactSha256: [...hashes][0],
        tree: treeEvidence(directory),
    };
}

function inspectPointers(config) {
    return COMPONENTS.map(component => {
        const pointer = config.pointers[component];
        const info = present(pointer);
        if (!info && component === 'two-factor') return { component, pointer, target: null };
        assert.ok(info?.isSymbolicLink(), `Current ${component} pointer is missing or is not a symlink`);
        const target = fs.realpathSync(pointer); // An existing broken pointer fails closed.
        let release;
        let releaseDirectory;
        let evidence;
        for (const root of config.roots) {
            const relative = path.relative(root.directory, target).split(path.sep);
            const parsed = parseReleaseName(relative[0]);
            const expected =
                parsed?.kind === 'storefront-fast' && component === 'storefront'
                    ? []
                    : component === 'two-factor'
                      ? ['storefront', '.two-factor']
                      : [component];
            if (parsed?.kind !== root.kind || JSON.stringify(relative.slice(1)) !== JSON.stringify(expected))
                continue;
            releaseDirectory = path.join(root.directory, parsed.name);
            realDirectory(root.directory);
            realDirectory(releaseDirectory);
            release = parsed;
            evidence = componentEvidence(target, component, release);
            break;
        }
        if (!release) {
            const relative = path.relative(config.runtimeReleasesDir, target).split(path.sep);
            const match = /^(?<sha>[a-f0-9]{40})-(?<runId>[0-9]+)-(?<attempt>[0-9]+)-linux-x64$/u.exec(
                relative[0],
            );
            const suffix =
                component === 'two-factor'
                    ? ['packages', 'storefront', 'dist-two-factor']
                    : ['packages', component, 'dist'];
            assert.ok(
                match && JSON.stringify(relative.slice(1)) === JSON.stringify(suffix),
                `Current ${component} target is outside recognized release output`,
            );
            realDirectory(config.runtimeReleasesDir);
            releaseDirectory = path.join(config.runtimeReleasesDir, relative[0]);
            realDirectory(releaseDirectory);
            release = { name: relative[0], kind: 'runtime', ...match.groups };
            const metadata = readMarker(path.join(releaseDirectory, 'RUNTIME-METADATA.json'));
            assert.equal(metadata.value.gitSha, release.sha, 'Runtime metadata differs from directory');
            evidence = componentEvidence(target, component, release, true);
            evidence.runtimeMetadata = metadata;
        }
        return {
            component,
            pointer,
            pointerIdentity: identity(info),
            target,
            releaseDirectory,
            release,
            evidence,
        };
    });
}

function inspect(options = {}) {
    const config = settings(options);
    const pointers = inspectPointers(config);
    const candidates = [];
    const preservedEntries = [];
    const roots = config.roots.map(root => {
        const info = present(root.directory);
        if (!info) return { ...root, identity: null };
        const rootIdentity = realDirectory(root.directory);
        for (const name of fs.readdirSync(root.directory).sort()) {
            const directory = path.join(root.directory, name);
            const parsed = parseReleaseName(name);
            const entryInfo = fs.lstatSync(directory, { bigint: true });
            if (
                !parsed ||
                parsed.kind !== root.kind ||
                !entryInfo.isDirectory() ||
                entryInfo.isSymbolicLink()
            ) {
                preservedEntries.push({
                    path: directory,
                    identity: identity(entryInfo),
                    reason: 'unmanaged-entry',
                });
                continue;
            }
            try {
                candidates.push(inspectCandidate(directory, parsed));
            } catch {
                preservedEntries.push({
                    path: directory,
                    identity: identity(entryInfo),
                    reason: 'unverified-release-output',
                });
            }
        }
        return { ...root, identity: rootIdentity };
    });
    const keep = new Set(config.protectedDirectories);
    for (const pointer of pointers) if (pointer.target) keep.add(pointer.releaseDirectory);
    for (const candidate of candidates)
        if (config.protectedSourceShas.includes(candidate.sha)) keep.add(candidate.directory);
    const rollbackDirectories = {};
    for (const pointer of pointers) {
        rollbackDirectories[pointer.component] = candidates
            .filter(
                candidate =>
                    candidate.components.some(item => item.component === pointer.component) &&
                    (!pointer.release || compareReleaseOrder(candidate, pointer.release) < 0),
            )
            .sort((left, right) => compareReleaseOrder(right, left))
            .slice(0, config.keepRollbackCount)
            .map(candidate => candidate.directory);
        for (const directory of rollbackDirectories[pointer.component]) keep.add(directory);
    }
    const deleteDirectories = candidates
        .filter(candidate => !keep.has(candidate.directory))
        .map(candidate => candidate.directory)
        .sort();
    const deleteFiles = [];
    for (const candidate of candidates) {
        const archive = `${candidate.directory}.tar.gz`;
        for (const file of [archive, `${archive}.sha256`, `${candidate.directory}.sha256`]) {
            const info = present(file);
            if (!info || keep.has(candidate.directory)) continue;
            if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) continue;
            let verified;
            if (file === archive) verified = fileHash(file) === candidate.artifactSha256;
            else if (info.size <= 65536n) {
                const match = /^([a-f0-9]{64})\s+\*?([^\r\n]+)\r?\n?$/u.exec(fs.readFileSync(file, 'utf8'));
                verified = match?.[1] === candidate.artifactSha256 && match?.[2] === path.basename(archive);
            }
            if (verified) deleteFiles.push({ path: file, identity: identity(info) });
        }
    }
    const selectedFiles = new Set(deleteFiles.map(file => file.path));
    return {
        roots,
        pointers,
        keepRollbackCount: config.keepRollbackCount,
        protectedDirectories: config.protectedDirectories,
        protectedSourceShas: config.protectedSourceShas,
        candidates,
        rollbackDirectories,
        keepDirectories: [...keep].sort(),
        deleteDirectories,
        deleteFiles: deleteFiles.sort((a, b) => a.path.localeCompare(b.path)),
        preservedEntries: preservedEntries.filter(entry => !selectedFiles.has(entry.path)),
    };
}

// The caller owns the production lock through activation, rollback and retention.
// The callback is required again before every deletion; stale plans never apply.
function apply(plan, options = {}) {
    assert.equal(
        typeof options.assertLockHeld,
        'function',
        'Frontend retention requires the production deployment lock',
    );
    options.assertLockHeld();
    assert.deepEqual(
        inspect(options),
        plan,
        'Frontend release inventory or pointers changed before retention',
    );
    const removedDirectories = [];
    const removedFiles = [];
    const rootDescriptors = new Map();
    try {
        for (const root of plan.roots.filter(root => root.identity)) {
            const fd = fs.openSync(
                root.directory,
                fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
            );
            rootDescriptors.set(root.directory, fd);
            assert.deepEqual(
                identity(fs.fstatSync(fd, { bigint: true })),
                root.identity,
                'Frontend root changed',
            );
        }
        const targetPath = file => {
            const root = path.dirname(file);
            const fd = rootDescriptors.get(root);
            assert.ok(fd !== undefined, 'Deletion escaped frontend release roots');
            const original = plan.roots.find(item => item.directory === root).identity;
            const current = realDirectory(root);
            for (const key of ['dev', 'ino', 'uid', 'gid'])
                assert.equal(current[key], original[key], 'Frontend root changed during retention');
            return process.platform === 'linux'
                ? path.join('/proc/self/fd', String(fd), path.basename(file))
                : file;
        };
        for (const directory of plan.deleteDirectories) {
            options.assertLockHeld();
            assert.deepEqual(
                inspectPointers(settings(options)),
                plan.pointers,
                'Frontend pointers changed during retention',
            );
            const candidate = plan.candidates.find(item => item.directory === directory);
            assert.ok(
                candidate && !plan.keepDirectories.includes(directory),
                'Deletion target was not an unprotected verified release',
            );
            assert.deepEqual(
                inspectCandidate(directory, parseReleaseName(path.basename(directory))),
                candidate,
                'Frontend output changed during retention',
            );
            fs.rmSync(targetPath(directory), { recursive: true, force: false });
            removedDirectories.push(directory);
        }
        for (const file of plan.deleteFiles) {
            options.assertLockHeld();
            assert.deepEqual(
                inspectPointers(settings(options)),
                plan.pointers,
                'Frontend pointers changed during retention',
            );
            const info = fs.lstatSync(file.path, { bigint: true });
            assert.ok(info.isFile() && !info.isSymbolicLink(), 'Frontend archive type changed');
            assert.deepEqual(identity(info), file.identity, 'Frontend archive changed during retention');
            fs.unlinkSync(targetPath(file.path));
            removedFiles.push(file.path);
        }
    } finally {
        for (const fd of rootDescriptors.values()) fs.closeSync(fd);
    }
    return { removedDirectories, removedFiles };
}

function assertInheritedLock(fd, lockPath = PRODUCTION_LOCK) {
    assert.ok(Number.isSafeInteger(fd) && fd >= 3 && fd <= 64, 'Invalid inherited production lock FD');
    const descriptor = fs.fstatSync(fd, { bigint: true });
    const lock = fs.lstatSync(lockPath, { bigint: true });
    assert.ok(lock.isFile() && !lock.isSymbolicLink() && descriptor.isFile(), 'Invalid production lock file');
    for (const key of ['dev', 'ino'])
        assert.equal(descriptor[key], lock[key], 'Inherited FD differs from production lock');
    // An inherited open-file description shares the parent's lock. This also
    // refuses a conflicting holder instead of trusting an environment flag.
    execFileSync('/usr/bin/flock', ['--exclusive', '--nonblock', String(fd)], {
        stdio: ['ignore', 'pipe', 'pipe', ...Array.from({ length: fd - 3 }, () => 'ignore'), fd],
    });
}

function run({ arguments_ = process.argv.slice(2), environment = process.env, options = {} } = {}) {
    let applyRequested = false;
    let mode;
    let lockFd;
    const protectedDirectories = [...(options.protectedDirectories ?? [])];
    const protectedSourceShas = [...(options.protectedSourceShas ?? [])];
    for (let index = 0; index < arguments_.length; index++) {
        const argument = arguments_[index];
        if (argument === '--apply' || argument === '--dry-run') {
            assert.equal(mode, undefined, 'Choose one retention mode');
            mode = argument;
            applyRequested = argument === '--apply';
        } else if (argument === '--lock-fd') {
            assert.match(arguments_[++index] ?? '', /^[0-9]+$/u);
            lockFd = Number(arguments_[index]);
        } else if (argument === '--protect-directory') protectedDirectories.push(arguments_[++index]);
        else if (argument === '--protect-source') protectedSourceShas.push(arguments_[++index]);
        else throw new Error(`Unknown argument: ${argument}`);
    }
    const configuration = { ...options, protectedDirectories, protectedSourceShas };
    if (applyRequested) {
        assert.equal(
            environment.VENDURE_ALLOW_PRODUCTION_RELEASE_PRUNE,
            '1',
            'Frontend deletion requires the existing production release prune authorization',
        );
        configuration.assertLockHeld ??= () => assertInheritedLock(lockFd);
        configuration.assertLockHeld();
    }
    const plan = inspect(configuration);
    const result = applyRequested ? apply(plan, configuration) : {};
    return { mode: applyRequested ? 'apply' : 'dry-run', ...plan, ...result };
}

if (require.main === module) {
    try {
        process.stdout.write(`${JSON.stringify(run(), null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}

module.exports = { apply, assertInheritedLock, compareReleaseOrder, inspect, parseReleaseName, run };
