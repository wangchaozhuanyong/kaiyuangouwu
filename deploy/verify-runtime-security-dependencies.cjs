'use strict';

const assert = require('node:assert/strict');
const { existsSync, readFileSync, realpathSync, statSync } = require('node:fs');
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

function verifyRuntimeSecurityDependencies(runtimeDirectory) {
    try {
        assert.ok(typeof runtimeDirectory === 'string' && path.isAbsolute(runtimeDirectory));
        const runtimeRoot = realpathSync(runtimeDirectory);
        assert.ok(statSync(runtimeRoot).isDirectory());
        const manifest = runtimeFile(runtimeRoot, path.join(runtimeRoot, 'packages/dev-server/package.json'));
        const fromRuntime = Module.createRequire(manifest);
        const expressEntry = runtimeFile(runtimeRoot, fromRuntime.resolve('express'));
        const fromExpress = Module.createRequire(expressEntry);
        const qsEntry = runtimeFile(runtimeRoot, fromExpress.resolve('qs'));
        const tiptapEntry = runtimeFile(runtimeRoot, fromRuntime.resolve('@tiptap/core'));
        const versions = {
            express: packageVersion(runtimeRoot, expressEntry, 'express'),
            qs: packageVersion(runtimeRoot, qsEntry, 'qs'),
            '@tiptap/core': packageVersion(runtimeRoot, tiptapEntry, '@tiptap/core'),
        };
        withRuntimeDependencies(runtimeRoot, () => {
            assertPatchedQs(fromExpress(qsEntry));
            assertPatchedTiptap(fromRuntime(tiptapEntry), versions['@tiptap/core']);
        });
        return { status: 'PASS', packages: versions };
    } catch {
        // Dependency exceptions and assertion diffs can contain arbitrary values or paths.
        throw new Error('Runtime dependency security verification failed');
    }
}

module.exports = { verifyRuntimeSecurityDependencies };
