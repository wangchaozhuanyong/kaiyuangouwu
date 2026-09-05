import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    verifyRuntimeSecurityDependencies,
} = require('../../../deploy/verify-runtime-security-dependencies.cjs');

function writePackage(root, name, version, source) {
    const directory = path.join(root, 'node_modules', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, main: 'index.cjs' }));
    writeFileSync(path.join(directory, 'index.cjs'), source);
    return directory;
}

function fixture(
    t,
    { unsafeArray = false, unsafeBuffer = false, unsafeTiptap = false, tiptapVersion = '3.30.4' } = {},
) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'vendure-runtime-security-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const runtime = path.join(directory, 'runtime');
    mkdirSync(path.join(runtime, 'packages/dev-server'), { recursive: true });
    writeFileSync(path.join(runtime, 'packages/dev-server/package.json'), '{"name":"dev-server"}');
    writePackage(runtime, 'express', '5.2.1', 'module.exports = {};');
    const qs = writePackage(
        runtime,
        'qs',
        '6.15.2',
        `
        exports.parse = (source, options = {}) => {
            const params = new URLSearchParams(source);
            if (params.has('tags[]')) {
                const values = params.get('tags[]').split(',');
                if (!${unsafeArray} && options.throwOnLimitExceeded && values.length > options.arrayLimit) {
                    throw new RangeError('Array limit exceeded');
                }
                return { tags: [values] };
            }
            if (params.has('item[constructor][isBuffer]')) {
                return { item: { constructor: { isBuffer: params.get('item[constructor][isBuffer]') } }, name: params.get('name') };
            }
            return { tags: params.getAll('tags') };
        };
        exports.stringify = value => {
            if (${unsafeBuffer}) value.item.constructor.isBuffer(value.item);
            return new URLSearchParams([
                ['item[constructor][isBuffer]', value.item.constructor.isBuffer],
                ['name', value.name]
            ]).toString();
        };
    `,
    );
    const tiptap = writePackage(
        runtime,
        '@tiptap/core',
        tiptapVersion,
        `
        exports.mergeAttributes = (...items) => {
            const attributes = {};
            for (const item of items) {
                for (const [key, value] of Object.entries(item)) {
                    if (${unsafeTiptap} || key !== '__proto__') attributes[key] = value;
                }
            }
            return attributes;
        };
    `,
    );
    return { directory, runtime, qs, tiptap };
}

void test('accepts behaviorally patched qs without pretending its version changed', t => {
    const { runtime } = fixture(t);
    const originalLoad = Module._load;

    assert.deepEqual(verifyRuntimeSecurityDependencies(runtime), {
        status: 'PASS',
        packages: { express: '5.2.1', qs: '6.15.2', '@tiptap/core': '3.30.4' },
    });
    assert.equal(Module._load, originalLoad);
});

for (const failure of ['unsafeArray', 'unsafeBuffer', 'unsafeTiptap']) {
    void test(`rejects the ${failure} vulnerability and restores the module loader`, t => {
        const { runtime } = fixture(t, { [failure]: true });
        const originalLoad = Module._load;

        assert.throws(() => verifyRuntimeSecurityDependencies(runtime), {
            message: 'Runtime dependency security verification failed',
        });
        assert.equal(Module._load, originalLoad);
    });
}

for (const tiptapVersion of ['3.30.1', '3.30.4-rc.1']) {
    void test(`rejects an older or prerelease Tiptap version: ${tiptapVersion}`, t => {
        const { runtime } = fixture(t, { tiptapVersion });
        assert.throws(() => verifyRuntimeSecurityDependencies(runtime));
    });
}

void test('accepts a newer stable Tiptap release when its behavior remains safe', t => {
    const { runtime } = fixture(t, { tiptapVersion: '3.31.0' });
    assert.equal(verifyRuntimeSecurityDependencies(runtime).packages['@tiptap/core'], '3.31.0');
});

void test('rejects a direct dependency symlink outside the verified runtime before loading it', t => {
    const { directory, runtime, qs } = fixture(t);
    const marker = path.join(directory, 'outside-module-executed');
    const outside = writePackage(
        path.join(directory, 'runtime-other'),
        'qs',
        '6.15.2',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected');`,
    );
    rmSync(qs, { recursive: true });
    symlinkSync(outside, qs, 'dir');

    assert.throws(() => verifyRuntimeSecurityDependencies(runtime));
    assert.equal(existsSync(marker), false);
});

void test('rejects transitive parent-directory fallback before executing outside code', t => {
    const { directory, runtime, qs } = fixture(t);
    const marker = path.join(directory, 'outside-module-executed');
    writePackage(
        directory,
        'outside-helper',
        '1.0.0',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected');`,
    );
    writeFileSync(path.join(qs, 'index.cjs'), "module.exports = require('outside-helper');");
    const originalLoad = Module._load;

    assert.throws(() => verifyRuntimeSecurityDependencies(runtime));
    assert.equal(existsSync(marker), false);
    assert.equal(Module._load, originalLoad);
});

void test('rejects an outside dev-server manifest even when it has a valid runtime-shaped path', t => {
    const { directory, runtime } = fixture(t);
    const outsideManifest = path.join(directory, 'package.json');
    writeFileSync(outsideManifest, '{"name":"dev-server"}');
    const manifest = path.join(runtime, 'packages/dev-server/package.json');
    rmSync(manifest);
    symlinkSync(outsideManifest, manifest);

    assert.throws(() => verifyRuntimeSecurityDependencies(runtime));
});

void test('redacts arbitrary dependency exceptions and returns no source or paths', t => {
    const { runtime, qs } = fixture(t);
    writeFileSync(path.join(qs, 'index.cjs'), "throw new Error('FAKE_SECRET_MUST_NOT_ESCAPE');");

    assert.throws(
        () => verifyRuntimeSecurityDependencies(runtime),
        error => {
            assert.equal(error.message, 'Runtime dependency security verification failed');
            assert.equal(error.cause, undefined);
            assert.equal(error.stack.includes('FAKE_SECRET_MUST_NOT_ESCAPE'), false);
            assert.equal(error.stack.includes(runtime), false);
            return true;
        },
    );
});
