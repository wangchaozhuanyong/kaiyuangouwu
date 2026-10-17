import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    readlinkSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
void test('preserves brace-expansion CommonJS compatibility and the new rewrite bound export', async () => {
    const commonjs = require('brace-expansion');
    const esm = await import('brace-expansion');
    assert.equal(typeof commonjs, 'function');
    assert.equal(typeof esm.default, 'function');
    for (const name of [
        'EXPANSION_MAX',
        'EXPANSION_MAX_LENGTH',
        'EXPANSION_MAX_DEPTH',
        'EXPANSION_MAX_REWRITES',
    ]) {
        assert.equal(typeof commonjs[name], 'number', name);
        assert.equal(commonjs[name], esm[name], name);
    }
    assert.deepEqual(commonjs('file.{js,ts}'), ['file.js', 'file.ts']);
    assert.deepEqual(esm.default('file.{js,ts}'), ['file.js', 'file.ts']);
    const minimatch = require('minimatch');
    const matches = typeof minimatch === 'function' ? minimatch : minimatch.minimatch;
    assert.equal(matches('file.ts', 'file.{js,ts}'), true);
});

const {
    inspectRuntimeSecurityDependencies,
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
            message: `Runtime dependency security verification failed [${failure === 'unsafeTiptap' ? 'tiptap' : 'express-qs'}:behavior]`,
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
            assert.equal(
                error.message,
                'Runtime dependency security verification failed [express-qs:behavior]',
            );
            assert.equal(error.cause, undefined);
            assert.equal(error.stack.includes('FAKE_SECRET_MUST_NOT_ESCAPE'), false);
            assert.equal(error.stack.includes(runtime), false);
            return true;
        },
    );
});

void test('checks qs even when Tiptap is absent and keeps the operation failed', t => {
    const { runtime, tiptap } = fixture(t);
    rmSync(tiptap, { recursive: true });
    const result = inspectRuntimeSecurityDependencies(runtime);
    assert.deepEqual(result, {
        status: 'FAIL',
        packages: { express: '5.2.1', qs: '6.15.2' },
        checks: [
            { name: 'express-qs', status: 'PASS' },
            { name: 'tiptap', status: 'FAIL', phase: 'resolve-tiptap' },
        ],
    });
    assert.throws(() => verifyRuntimeSecurityDependencies(runtime), {
        message: 'Runtime dependency security verification failed [tiptap:resolve-tiptap]',
    });
});

void test('reports independent dependency failures without echoing arbitrary exceptions', t => {
    const { runtime, qs, tiptap } = fixture(t);
    writeFileSync(path.join(qs, 'index.cjs'), "throw new Error('FAKE_PRIVATE_VALUE');");
    rmSync(tiptap, { recursive: true });
    const result = inspectRuntimeSecurityDependencies(runtime);
    assert.deepEqual(result.checks, [
        { name: 'express-qs', status: 'FAIL', phase: 'behavior' },
        { name: 'tiptap', status: 'FAIL', phase: 'resolve-tiptap' },
    ]);
    assert.equal(JSON.stringify(result).includes('FAKE_PRIVATE_VALUE'), false);
    assert.equal(JSON.stringify(result).includes(runtime), false);
});

void test('uses the Dashboard consumer with an isolated dependency layout', t => {
    const { runtime, tiptap } = fixture(t);
    const dashboard = path.join(runtime, 'packages/dashboard');
    mkdirSync(path.join(dashboard, 'node_modules/@tiptap'), { recursive: true });
    writeFileSync(path.join(dashboard, 'package.json'), '{"name":"@vendure/dashboard"}');
    renameSync(tiptap, path.join(dashboard, 'node_modules/@tiptap/core'));
    assert.equal(verifyRuntimeSecurityDependencies(runtime).status, 'PASS');
});

void test('checks Core own Express dependency instead of an unrelated hoisted safe copy', t => {
    const { runtime } = fixture(t);
    const core = path.join(runtime, 'packages/core');
    mkdirSync(core, { recursive: true });
    writeFileSync(path.join(core, 'package.json'), '{"name":"@vendure/core"}');
    const express = writePackage(core, 'express', '5.2.1', 'module.exports = {};');
    writePackage(express, 'qs', '6.15.2', 'exports.parse = () => ({});');
    assert.deepEqual(inspectRuntimeSecurityDependencies(runtime).checks, [
        { name: 'express-qs', status: 'FAIL', phase: 'behavior' },
        { name: 'tiptap', status: 'PASS' },
    ]);
});

void test('rejects an outside consumer manifest before executing its dependencies', t => {
    const { directory, runtime } = fixture(t);
    const dashboard = path.join(runtime, 'packages/dashboard');
    mkdirSync(dashboard, { recursive: true });
    const outside = path.join(directory, 'outside-package.json');
    writeFileSync(outside, '{"name":"@vendure/dashboard"}');
    symlinkSync(outside, path.join(dashboard, 'package.json'));
    assert.deepEqual(inspectRuntimeSecurityDependencies(runtime).checks, [
        { name: 'express-qs', status: 'PASS' },
        { name: 'tiptap', status: 'FAIL', phase: 'consumer' },
    ]);
});

const nextAdminSha = '1234567890abcdef1234567890abcdef12345678';

function writeJson(file, value) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
}

function artifactEntries(root, relative = '') {
    const entries = [];
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) entries.push(...artifactEntries(root, child));
        else if (entry.isSymbolicLink()) {
            entries.push({ path: child, target: readlinkSync(path.join(root, child)) });
        } else entries.push({ path: child });
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function sealNextAdmin(root, { inventory = true } = {}) {
    const entries = artifactEntries(root);
    if (inventory) {
        const packages = entries
            .filter(entry => !entry.target && entry.path.endsWith('/package.json'))
            .map(entry => ({
                manifest: JSON.parse(readFileSync(path.join(root, entry.path), 'utf8')),
                directory: path.posix.dirname(entry.path),
            }));
        packages.push({
            manifest: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
            directory: '',
        });
        writeJson(
            path.join(root, 'RUNTIME-PACKAGES.json'),
            packages
                .map(({ manifest, directory }) => ({
                    name: manifest.name,
                    path: directory,
                    version: manifest.version,
                }))
                .sort((a, b) => a.path.localeCompare(b.path)),
        );
        writeJson(
            path.join(root, 'RUNTIME-SYMLINKS.json'),
            entries.filter(entry => entry.target),
        );
    }
    writeFileSync(
        path.join(root, 'SHA256SUMS'),
        artifactEntries(root)
            .filter(entry => !entry.target && entry.path !== 'SHA256SUMS')
            .map(
                entry =>
                    `${createHash('sha256')
                        .update(readFileSync(path.join(root, entry.path)))
                        .digest('hex')}  ${entry.path}\n`,
            )
            .join(''),
    );
}

function nextAdminFixture(t, options) {
    const result = fixture(t, options);
    const { runtime, tiptap } = result;
    rmSync(tiptap, { recursive: true });
    // Removing the scope too is significant: an unlisted dependency directory
    // must never turn a partial installer workspace into an accepted artifact.
    rmSync(path.dirname(tiptap), { recursive: true });
    writeJson(path.join(runtime, 'package.json'), { name: 'vendure-production-runtime', version: '0.0.0' });
    for (const [directory, name, dependencies] of [
        ['dev-server', 'dev-server', { '@vendure/next-admin-plugin': '0.1.0' }],
        ['core', '@vendure/core', { express: '5.2.1' }],
        ['next-admin', 'next-admin', { react: '19.2.8' }],
        ['next-admin-plugin', '@vendure/next-admin-plugin', { '@vendure/core': '3.7.2' }],
    ]) {
        writeJson(path.join(runtime, 'packages', directory, 'package.json'), {
            name,
            version: '3.7.2',
            dependencies,
            ...(directory === 'next-admin-plugin' ? { main: './dist/index.js' } : {}),
        });
    }
    mkdirSync(path.join(runtime, 'node_modules/@vendure'), { recursive: true });
    symlinkSync(
        '../../packages/next-admin-plugin',
        path.join(runtime, 'node_modules/@vendure/next-admin-plugin'),
    );
    writeJson(path.join(runtime, 'RUNTIME-METADATA.json'), {
        artifactFormat: 1,
        gitSha: nextAdminSha,
        sourceDirty: false,
        platform: 'linux/x64',
        startCommands: {
            server: 'node packages/dev-server/dist/index.js',
            worker: 'node packages/dev-server/dist/index-worker.js',
        },
    });
    writeJson(path.join(runtime, 'packages/next-admin/dist/frontend-release.json'), {
        sourceSha: nextAdminSha,
        backendSha: nextAdminSha,
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
        'packages/next-admin/dist/assets/index.js',
        'packages/next-admin/dist/assets/editor.js',
        'packages/next-admin/dist/assets/index.css',
    ]) {
        mkdirSync(path.dirname(path.join(runtime, file)), { recursive: true });
        writeFileSync(path.join(runtime, file), '/* immutable build output */');
    }
    writeFileSync(
        path.join(runtime, 'packages/next-admin/dist/index.html'),
        '<script src="/dashboard/assets/index.js"></script><link rel="stylesheet" href="/dashboard/assets/index.css">',
    );
    sealNextAdmin(runtime);
    return result;
}

void test('records Tiptap N/A only for the complete immutable Next Admin artifact, including the operations return value', t => {
    const { runtime } = nextAdminFixture(t);
    const expected = {
        status: 'PASS',
        packages: { express: '5.2.1', qs: '6.15.2' },
        checks: [
            { name: 'express-qs', status: 'PASS' },
            { name: 'tiptap', status: 'NOT_APPLICABLE', reason: 'NEXT_ADMIN_WITHOUT_TIPTAP_CONSUMER' },
        ],
    };
    assert.deepEqual(inspectRuntimeSecurityDependencies(runtime), expected);
    assert.deepEqual(verifyRuntimeSecurityDependencies(runtime), expected);
});

for (const [label, mutate] of [
    ['missing metadata', root => rmSync(path.join(root, 'RUNTIME-METADATA.json'))],
    ['missing marker', root => rmSync(path.join(root, 'packages/next-admin/dist/frontend-release.json'))],
    ['missing index', root => rmSync(path.join(root, 'packages/next-admin/dist/index.html'))],
    ['missing plugin entry', root => rmSync(path.join(root, 'packages/next-admin-plugin/dist/index.js'))],
    ['missing worker entry', root => rmSync(path.join(root, 'packages/dev-server/dist/index-worker.js'))],
    [
        'missing referenced asset',
        root => rmSync(path.join(root, 'packages/next-admin/dist/assets/index.css')),
    ],
    [
        'dirty metadata',
        root =>
            changeJson(root, 'RUNTIME-METADATA.json', data => {
                data.sourceDirty = true;
            }),
    ],
    [
        'invalid SHA',
        root =>
            changeJson(root, 'RUNTIME-METADATA.json', data => {
                data.gitSha = 'invalid';
            }),
    ],
    [
        'wrong platform',
        root =>
            changeJson(root, 'RUNTIME-METADATA.json', data => {
                data.platform = 'darwin/arm64';
            }),
    ],
    [
        'wrong start command',
        root =>
            changeJson(root, 'RUNTIME-METADATA.json', data => {
                data.startCommands.worker = 'node other.js';
            }),
    ],
    [
        'conflicting frontend SHA',
        root =>
            changeJson(root, 'packages/next-admin/dist/frontend-release.json', data => {
                data.backendSha = 'f'.repeat(40);
            }),
    ],
    [
        'wrong frontend component',
        root =>
            changeJson(root, 'packages/next-admin/dist/frontend-release.json', data => {
                data.component = 'dashboard';
            }),
    ],
    [
        'wrong frontend lane',
        root =>
            changeJson(root, 'packages/next-admin/dist/frontend-release.json', data => {
                data.releaseLane = 'frontend';
            }),
    ],
    [
        'wrong Admin name',
        root =>
            changeJson(root, 'packages/next-admin/package.json', data => {
                data.name = 'unrelated';
            }),
    ],
    [
        'missing plugin dependency',
        root =>
            changeJson(root, 'packages/dev-server/package.json', data => {
                delete data.dependencies['@vendure/next-admin-plugin'];
            }),
    ],
    [
        'missing actual plugin consumer link',
        root => rmSync(path.join(root, 'node_modules/@vendure/next-admin-plugin')),
    ],
    [
        'wrong actual plugin consumer link',
        root => {
            rmSync(path.join(root, 'node_modules/@vendure/next-admin-plugin'));
            symlinkSync('../qs', path.join(root, 'node_modules/@vendure/next-admin-plugin'));
        },
    ],
    ['legacy directory', root => mkdirSync(path.join(root, 'packages/dashboard'))],
    ['legacy dangling symlink', root => symlinkSync('absent', path.join(root, 'packages/dashboard'))],
    [
        'Tiptap package alias',
        root =>
            changeJson(root, 'packages/next-admin/package.json', data => {
                data.dependencies.editor = 'npm:@tiptap/core@3.30.5';
            }),
    ],
    [
        'Tiptap package under another directory',
        root => {
            writePackage(root, 'aliased-editor', '3.30.5', '');
            changeJson(root, 'node_modules/aliased-editor/package.json', data => {
                data.name = '@tiptap/core';
            });
        },
    ],
]) {
    void test(`keeps a Next Admin profile fail-closed: ${label}`, t => {
        const { runtime } = nextAdminFixture(t);
        mutate(runtime);
        sealNextAdmin(runtime);
        const result = inspectRuntimeSecurityDependencies(runtime);
        assert.equal(result.status, 'FAIL');
        assert.deepEqual(result.checks[1], { name: 'tiptap', status: 'FAIL', phase: 'resolve-tiptap' });
    });
}

function changeJson(root, file, mutate) {
    const fullPath = path.join(root, file);
    const data = JSON.parse(readFileSync(fullPath, 'utf8'));
    mutate(data);
    writeJson(fullPath, data);
}

for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    void test(`rejects a Tiptap or legacy dependency edge in ${section}`, t => {
        const { runtime } = nextAdminFixture(t);
        for (const name of ['@tiptap/core', '@vendure/dashboard']) {
            changeJson(runtime, 'packages/next-admin/package.json', data => {
                data[section] = { [name]: '3.30.5' };
            });
            sealNextAdmin(runtime);
            assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
        }
    });
}

for (const [label, mutate] of [
    ['empty inventory', root => writeJson(path.join(root, 'RUNTIME-PACKAGES.json'), [])],
    [
        'omitted inventory package',
        root =>
            changeJson(root, 'RUNTIME-PACKAGES.json', data => {
                data.pop();
            }),
    ],
    [
        'duplicate inventory package',
        root =>
            changeJson(root, 'RUNTIME-PACKAGES.json', data => {
                data.push(data[0]);
            }),
    ],
    [
        'forged inventory package',
        root =>
            changeJson(root, 'RUNTIME-PACKAGES.json', data => {
                data.push({ name: 'fake', path: 'packages/fake', version: '1.0.0' });
            }),
    ],
    [
        'escaping inventory path',
        root =>
            changeJson(root, 'RUNTIME-PACKAGES.json', data => {
                data[0].path = '../outside';
            }),
    ],
    [
        'inventory version conflict',
        root =>
            changeJson(root, 'RUNTIME-PACKAGES.json', data => {
                data[0].version = '9.9.9';
            }),
    ],
    [
        'unlisted nested Tiptap',
        root => {
            writePackage(path.join(root, 'packages/core'), '@tiptap/core', '3.30.5', '');
        },
    ],
    [
        'unlisted installed package',
        root => {
            writePackage(root, 'unexpected', '1.0.0', '');
        },
    ],
]) {
    void test(`does not trust a forged or incomplete inventory: ${label}`, t => {
        const { runtime } = nextAdminFixture(t);
        mutate(runtime);
        sealNextAdmin(runtime, { inventory: false });
        assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
    });
}

for (const file of [
    'RUNTIME-METADATA.json',
    'packages/next-admin/package.json',
    'packages/next-admin/dist/index.html',
    'packages/next-admin/dist/assets/editor.js',
    'packages/next-admin-plugin/dist/index.js',
]) {
    void test(`rejects bytes changed after the immutable manifest was written: ${file}`, t => {
        const { runtime } = nextAdminFixture(t);
        writeFileSync(path.join(runtime, file), 'tampered');
        assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
    });
}

void test('rejects an unlisted artifact file and malformed checksum paths', t => {
    const { runtime } = nextAdminFixture(t);
    writeFileSync(path.join(runtime, 'unlisted'), 'extra');
    assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
    rmSync(path.join(runtime, 'unlisted'));
    const checksum = path.join(runtime, 'SHA256SUMS');
    writeFileSync(checksum, readFileSync(checksum, 'utf8') + `${'a'.repeat(64)}  ../outside\n`);
    assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
});

for (const directory of ['', 'packages/core', 'packages/next-admin', 'node_modules/express']) {
    void test(`detects an unexpected actual Tiptap consumer context: ${directory || 'root'}`, t => {
        const { runtime } = nextAdminFixture(t);
        writePackage(path.join(runtime, directory), '@tiptap/core', '3.30.1', 'module.exports = {};');
        sealNextAdmin(runtime);
        assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
        assert.ok(
            inspectRuntimeSecurityDependencies(runtime).checks.every(
                check => check.status !== 'NOT_APPLICABLE',
            ),
        );
    });
}

void test('rejects outside dependency fallback and never executes it for an otherwise complete Next Admin', t => {
    const { runtime, directory } = nextAdminFixture(t);
    const marker = path.join(directory, 'outside-tiptap-executed');
    writePackage(
        directory,
        '@tiptap/core',
        '3.30.5',
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad');`,
    );
    const result = inspectRuntimeSecurityDependencies(runtime);
    assert.equal(result.status, 'FAIL');
    assert.equal(existsSync(marker), false);
});

void test('rejects outside and missing symlinks and an altered symlink inventory', t => {
    const { runtime, directory } = nextAdminFixture(t);
    const link = path.join(runtime, 'extra-link');
    const outside = path.join(directory, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, link);
    sealNextAdmin(runtime);
    assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
    rmSync(link);
    symlinkSync(path.join(directory, 'missing'), link);
    sealNextAdmin(runtime);
    assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
    rmSync(link);
    symlinkSync(path.join(runtime, 'packages/next-admin'), link);
    sealNextAdmin(runtime);
    writeJson(path.join(runtime, 'RUNTIME-SYMLINKS.json'), []);
    sealNextAdmin(runtime, { inventory: false });
    assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
});

void test('continues rejecting unsafe Tiptap in a mixed legacy and Next Admin artifact', t => {
    const { runtime } = nextAdminFixture(t);
    const legacy = path.join(runtime, 'packages/dashboard');
    writeJson(path.join(legacy, 'package.json'), { name: '@vendure/dashboard', version: '3.7.2' });
    const unsafe = fixture(t, { unsafeTiptap: true });
    mkdirSync(path.join(legacy, 'node_modules/@tiptap'), { recursive: true });
    renameSync(unsafe.tiptap, path.join(legacy, 'node_modules/@tiptap/core'));
    sealNextAdmin(runtime);
    assert.deepEqual(inspectRuntimeSecurityDependencies(runtime).checks[1], {
        name: 'tiptap',
        status: 'FAIL',
        phase: 'behavior',
    });
});

void test('does not let an explicit Tiptap N/A hide a qs behavior failure', t => {
    const { runtime } = nextAdminFixture(t, { unsafeArray: true });
    const result = inspectRuntimeSecurityDependencies(runtime);
    assert.equal(result.status, 'FAIL');
    assert.deepEqual(result.checks[0], { name: 'express-qs', status: 'FAIL', phase: 'behavior' });
    assert.equal(result.checks[1].status, 'NOT_APPLICABLE');
});

void test('verifies a legitimate installed manifest larger than the separate consumer metadata limit', t => {
    const { runtime } = nextAdminFixture(t);
    writePackage(runtime, 'large-export-map', '1.0.0', 'module.exports = {};');
    changeJson(runtime, 'node_modules/large-export-map/package.json', data => {
        data.description = 'x'.repeat(199_018);
    });
    sealNextAdmin(runtime);
    assert.equal(inspectRuntimeSecurityDependencies(runtime).checks[1].status, 'NOT_APPLICABLE');
});

void test('keeps installed manifest reads bounded and checks their hashes', t => {
    const { runtime } = nextAdminFixture(t);
    writePackage(runtime, 'oversized-export-map', '1.0.0', 'module.exports = {};');
    changeJson(runtime, 'node_modules/oversized-export-map/package.json', data => {
        data.description = 'x'.repeat(1024 * 1024);
    });
    sealNextAdmin(runtime);
    assert.equal(inspectRuntimeSecurityDependencies(runtime).status, 'FAIL');
});
