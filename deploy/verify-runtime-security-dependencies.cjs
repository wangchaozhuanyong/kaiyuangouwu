'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

function runtimeFile(runtimeRoot, filePath) {
    const resolved = realpathSync(filePath);
    const relative = path.relative(runtimeRoot, resolved);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`));
    assert.ok(!path.isAbsolute(relative));
    assert.ok(statSync(resolved).isFile());
    return resolved;
}

function packageVersion(runtimeRoot, entryPoint, packageName) {
    let directory = path.dirname(entryPoint);
    while (directory !== runtimeRoot) {
        const manifest = path.join(directory, 'package.json');
        if (existsSync(manifest)) {
            const manifestPath = runtimeFile(runtimeRoot, manifest);
            assert.ok(statSync(manifestPath).size <= 64 * 1024);
            const data = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (data.name === packageName) {
                assert.match(data.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
                return data.version;
            }
        }
        directory = path.dirname(directory);
    }
    throw new Error('Runtime package metadata unavailable');
}

function withRuntimeDependencies(runtimeRoot, callback) {
    const originalLoad = Module._load;
    // This synchronous probe runs in the operations process, never in the API.
    // Guard transitive imports too, before Node can load an outside fallback.
    Module._load = function loadRuntimeDependency(request, parent, isMain) {
        if (!Module.isBuiltin(request)) {
            runtimeFile(runtimeRoot, Module._resolveFilename(request, parent, isMain));
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return callback();
    } finally {
        Module._load = originalLoad;
    }
}

function assertPatchedQs(qs) {
    // GHSA-x5fp-wj9c-mxmx: the small bracket group must stop at the configured limit.
    assert.throws(
        () =>
            qs.parse('tags[]=one,two,three,four', {
                comma: true,
                arrayLimit: 3,
                throwOnLimitExceeded: true,
            }),
        RangeError,
    );
    // GHSA-4mjr-xmp4-gh2g: untrusted constructor data must not be invoked.
    for (const options of [{ plainObjects: true }, { allowPrototypes: true }]) {
        const parsed = qs.parse('item[constructor][isBuffer]=not-a-function&name=example', options);
        assert.equal(qs.stringify(parsed), 'item%5Bconstructor%5D%5BisBuffer%5D=not-a-function&name=example');
    }
    assert.deepEqual(qs.parse('tags=one&tags=two'), { tags: ['one', 'two'] });
}

function assertPatchedTiptap(tiptap, version) {
    const [major, minor, patch] = version.split('.').map(Number);
    assert.ok(major > 3 || (major === 3 && (minor > 30 || (minor === 30 && patch >= 4))));
    // GHSA-cp6q-959q-f8rh: JSON-owned __proto__ must not become inherited attributes.
    const imported = JSON.parse('{"__proto__":{"src":"invalid://image","onerror":"probe"}}');
    const attributes = tiptap.mergeAttributes({ class: 'runtime-security-probe' }, imported);
    assert.equal(Object.getPrototypeOf(attributes), Object.prototype);
    assert.equal(attributes.class, 'runtime-security-probe');
    assert.equal('src' in attributes, false);
    assert.equal('onerror' in attributes, false);
}

function hasVerifiedNextAdminWithoutTiptap(runtimeRoot) {
    try {
        // An absent old consumer alone never authorizes N/A. Reconcile the real
        // artifact structure and package manifests before trusting its inventory.
        const files = new Set();
        const links = [];
        const forbidden =
            /(?:^|\/)node_modules\/(?:@tiptap(?:\/|$)|@vendure\/dashboard(?:\/|$))|^packages\/dashboard(?:\/|$)/u;
        function walk(relative = '') {
            for (const entry of readdirSync(path.join(runtimeRoot, relative), { withFileTypes: true })) {
                const child = relative ? `${relative}/${entry.name}` : entry.name;
                assert.ok(!forbidden.test(child));
                assert.ok(files.size + links.length < 100_000);
                if (entry.isSymbolicLink()) {
                    const target = realpathSync(path.join(runtimeRoot, child));
                    const within = path.relative(runtimeRoot, target);
                    assert.ok(within && within !== '..' && !within.startsWith(`..${path.sep}`));
                    assert.ok(!path.isAbsolute(within));
                    links.push({ path: child, target: readlinkSync(path.join(runtimeRoot, child)) });
                } else if (entry.isDirectory()) {
                    walk(child);
                } else {
                    assert.ok(entry.isFile());
                    files.add(child);
                }
            }
        }
        walk();
        assert.ok(files.has('SHA256SUMS'));
        const checksumFile = runtimeFile(runtimeRoot, path.join(runtimeRoot, 'SHA256SUMS'));
        assert.ok(statSync(checksumFile).size <= 16 * 1024 * 1024);
        const checksums = new Map();
        for (const line of readFileSync(checksumFile, 'utf8').trimEnd().split('\n')) {
            const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
            assert.ok(match);
            const relative = match[2];
            assert.ok(!relative.includes('\\') && !path.posix.isAbsolute(relative));
            assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
            assert.ok(!checksums.has(relative));
            checksums.set(relative, match[1]);
        }
        assert.deepEqual(
            [...checksums.keys()].sort(),
            [...files].filter(file => file !== 'SHA256SUMS').sort(),
        );
        function checkedFile(relative, maxBytes = 64 * 1024) {
            assert.ok(files.has(relative) && checksums.has(relative));
            const file = runtimeFile(runtimeRoot, path.join(runtimeRoot, relative));
            assert.ok(statSync(file).size <= maxBytes);
            const bytes = readFileSync(file);
            assert.equal(createHash('sha256').update(bytes).digest('hex'), checksums.get(relative));
            return bytes.toString('utf8');
        }
        const metadata = JSON.parse(checkedFile('RUNTIME-METADATA.json'));
        assert.equal(metadata.artifactFormat, 1);
        assert.match(metadata.gitSha, /^[a-f0-9]{40}$/u);
        assert.equal(metadata.sourceDirty, false);
        assert.equal(metadata.platform, 'linux/x64');
        assert.deepEqual(metadata.startCommands, {
            server: 'node packages/dev-server/dist/index.js',
            worker: 'node packages/dev-server/dist/index-worker.js',
        });
        const inventory = JSON.parse(checkedFile('RUNTIME-PACKAGES.json', 4 * 1024 * 1024));
        assert.ok(Array.isArray(inventory) && inventory.length > 0 && inventory.length < 10_000);
        const symlinks = JSON.parse(checkedFile('RUNTIME-SYMLINKS.json', 1024 * 1024));
        assert.deepEqual(
            links.sort((a, b) => a.path.localeCompare(b.path)),
            symlinks,
        );
        const actualInventory = [];
        const manifests = new Map();
        for (const file of files) {
            const segments = file.split('/');
            const nodeModulesIndex = segments.lastIndexOf('node_modules');
            const packageLength = segments.length - nodeModulesIndex - 1;
            // Match the original runtime collector's installed-manifest definition.
            const installed =
                segments.at(-1) === 'package.json' &&
                (segments.length === 1 ||
                    (segments.length === 3 && segments[0] === 'packages') ||
                    (nodeModulesIndex >= 0 &&
                        (packageLength === 2 ||
                            (packageLength === 3 && segments[nodeModulesIndex + 1].startsWith('@')))));
            if (!installed) continue;
            // Installed manifests can be larger than consumer metadata (for
            // example date-fns' export map). Keep this inventory read bounded.
            const manifest = JSON.parse(checkedFile(file, 1024 * 1024));
            assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest));
            assert.ok(typeof manifest.name === 'string' && typeof manifest.version === 'string');
            assert.ok(manifest.name !== '@vendure/dashboard' && !manifest.name.startsWith('@tiptap/'));
            for (const section of [
                'dependencies',
                'devDependencies',
                'optionalDependencies',
                'peerDependencies',
            ]) {
                if (manifest[section] === undefined) continue;
                assert.ok(
                    manifest[section] &&
                        typeof manifest[section] === 'object' &&
                        !Array.isArray(manifest[section]),
                );
                for (const [name, value] of Object.entries(manifest[section])) {
                    assert.equal(typeof value, 'string');
                    assert.ok(name !== '@vendure/dashboard' && !name.startsWith('@tiptap/'));
                    assert.ok(!/(?:@tiptap\/|@vendure\/dashboard(?:@|$))/u.test(value));
                }
            }
            const packagePath = file === 'package.json' ? '' : file.slice(0, -'/package.json'.length);
            actualInventory.push({ name: manifest.name, path: packagePath, version: manifest.version });
            manifests.set(packagePath, manifest);
            // Resolve from every actual installed consumer, including nested and
            // hoisted contexts. An unexpected outside fallback also forbids N/A.
            const fromConsumer = Module.createRequire(path.join(runtimeRoot, file));
            for (const dependency of ['@tiptap/core', '@vendure/dashboard']) {
                let missing = false;
                try {
                    fromConsumer.resolve(dependency);
                } catch (error) {
                    assert.equal(error.code, 'MODULE_NOT_FOUND');
                    missing = true;
                }
                assert.ok(missing);
            }
        }
        assert.deepEqual(
            actualInventory.sort((a, b) => a.path.localeCompare(b.path)),
            inventory,
        );
        assert.equal(manifests.get('')?.name, 'vendure-production-runtime');
        for (const [directory, name] of [
            ['dev-server', 'dev-server'],
            ['core', '@vendure/core'],
            ['next-admin', 'next-admin'],
            ['next-admin-plugin', '@vendure/next-admin-plugin'],
        ]) {
            assert.equal(manifests.get(`packages/${directory}`)?.name, name);
        }
        assert.equal(
            typeof manifests.get('packages/dev-server').dependencies?.['@vendure/next-admin-plugin'],
            'string',
        );
        const fromServer = Module.createRequire(path.join(runtimeRoot, 'packages/dev-server/package.json'));
        assert.equal(
            runtimeFile(runtimeRoot, fromServer.resolve('@vendure/next-admin-plugin')),
            runtimeFile(runtimeRoot, path.join(runtimeRoot, 'packages/next-admin-plugin/dist/index.js')),
        );
        const release = JSON.parse(checkedFile('packages/next-admin/dist/frontend-release.json'));
        assert.deepEqual(release, {
            sourceSha: metadata.gitSha,
            backendSha: metadata.gitSha,
            component: 'next-admin',
            releaseLane: 'runtime',
        });
        for (const file of [
            'packages/dev-server/dist/index.js',
            'packages/dev-server/dist/index-worker.js',
            'packages/dev-server/dist/run-migrations.js',
            'packages/next-admin-plugin/dist/index.js',
            'packages/next-admin-plugin/dist/next-admin.plugin.js',
            'packages/next-admin-plugin/dist/static-server.js',
        ]) {
            assert.ok(checkedFile(file, 16 * 1024 * 1024).length > 0);
        }
        for (const file of files) {
            if (file.startsWith('packages/next-admin/dist/')) checkedFile(file, 16 * 1024 * 1024);
        }
        const index = checkedFile('packages/next-admin/dist/index.html');
        const assets = [
            ...index.matchAll(/(?:src|href)=["']\/dashboard\/assets\/([^"'?#]+\.(?:js|css))["']/gu),
        ];
        assert.ok(assets.some(asset => asset[1].endsWith('.js')));
        assert.ok(assets.some(asset => asset[1].endsWith('.css')));
        for (const asset of assets) {
            assert.ok(asset[1].split('/').every(part => part && part !== '.' && part !== '..'));
            checkedFile(`packages/next-admin/dist/assets/${asset[1]}`, 16 * 1024 * 1024);
        }
        return true;
    } catch {
        return false;
    }
}

function inspectRuntimeSecurityDependencies(runtimeDirectory) {
    let runtimeRoot;
    try {
        assert.ok(typeof runtimeDirectory === 'string' && path.isAbsolute(runtimeDirectory));
        runtimeRoot = realpathSync(runtimeDirectory);
        assert.ok(statSync(runtimeRoot).isDirectory());
        runtimeFile(runtimeRoot, path.join(runtimeRoot, 'packages/dev-server/package.json'));
    } catch {
        return { status: 'FAIL', packages: {}, checks: [{ name: 'runtime', status: 'FAIL', phase: 'root' }] };
    }

    const packages = {};
    const checks = [];
    // Resolve dependencies from their actual consumer. A hoisted installation can
    // hide incorrect lookup contexts which fail under Bun's isolated linker.
    // A missing consumer/dependency remains a failure, never an implicit skip.
    for (const name of ['express-qs', 'tiptap']) {
        let phase = 'consumer';
        try {
            if (name === 'tiptap' && hasVerifiedNextAdminWithoutTiptap(runtimeRoot)) {
                checks.push({ name, status: 'NOT_APPLICABLE', reason: 'NEXT_ADMIN_WITHOUT_TIPTAP_CONSUMER' });
                continue;
            }
            const owner = name === 'express-qs' ? 'core' : 'dashboard';
            const ownerManifest = path.join(runtimeRoot, 'packages', owner, 'package.json');
            const manifest = runtimeFile(
                runtimeRoot,
                existsSync(ownerManifest)
                    ? ownerManifest
                    : path.join(runtimeRoot, 'packages/dev-server/package.json'),
            );
            const fromConsumer = Module.createRequire(manifest);
            if (name === 'express-qs') {
                phase = 'resolve-express';
                const expressEntry = runtimeFile(runtimeRoot, fromConsumer.resolve('express'));
                const fromExpress = Module.createRequire(expressEntry);
                phase = 'resolve-qs';
                const qsEntry = runtimeFile(runtimeRoot, fromExpress.resolve('qs'));
                phase = 'metadata';
                packages.express = packageVersion(runtimeRoot, expressEntry, 'express');
                packages.qs = packageVersion(runtimeRoot, qsEntry, 'qs');
                phase = 'behavior';
                withRuntimeDependencies(runtimeRoot, () => assertPatchedQs(fromExpress(qsEntry)));
            } else {
                phase = 'resolve-tiptap';
                const tiptapEntry = runtimeFile(runtimeRoot, fromConsumer.resolve('@tiptap/core'));
                phase = 'metadata';
                packages['@tiptap/core'] = packageVersion(runtimeRoot, tiptapEntry, '@tiptap/core');
                phase = 'behavior';
                withRuntimeDependencies(runtimeRoot, () =>
                    assertPatchedTiptap(fromConsumer(tiptapEntry), packages['@tiptap/core']),
                );
            }
            checks.push({ name, status: 'PASS' });
        } catch {
            // Only fixed check names/phases and validated versions leave the
            // probe. Never expose dependency exceptions, assertion diffs or paths.
            checks.push({ name, status: 'FAIL', phase });
        }
    }
    return {
        status: checks.every(check => ['PASS', 'NOT_APPLICABLE'].includes(check.status)) ? 'PASS' : 'FAIL',
        packages,
        checks,
    };
}

function verifyRuntimeSecurityDependencies(runtimeDirectory) {
    const result = inspectRuntimeSecurityDependencies(runtimeDirectory);
    if (result.status !== 'PASS') {
        const phases = result.checks
            .filter(check => check.status === 'FAIL')
            .map(check => `${check.name}:${check.phase}`)
            .join(',');
        throw new Error(`Runtime dependency security verification failed [${phases}]`);
    }
    return {
        status: 'PASS',
        packages: result.packages,
        ...(result.checks.some(check => check.status === 'NOT_APPLICABLE') ? { checks: result.checks } : {}),
    };
}

module.exports = { inspectRuntimeSecurityDependencies, verifyRuntimeSecurityDependencies };
