import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
    activateStorefront,
    assertServedStorefrontAssets,
    assertStorefrontOnly,
    switchStorefront,
} from './storefront-release.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'storefront-release-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const old = join(root, 'old');
    const candidate = join(root, 'new');
    const pointer = join(root, 'current');
    for (const [dir, contents] of [
        [old, 'old version'],
        [candidate, 'new version'],
    ]) {
        mkdirSync(dir);
        writeFileSync(join(dir, 'index.html'), contents);
    }
    symlinkSync(old, pointer);
    return { old, candidate, pointer };
}

test('only frontend changes may bypass a full release', () => {
    assert.doesNotThrow(() => assertStorefrontOnly(['packages/storefront/src/App.tsx']));
    for (const path of [
        'packages/next-admin/src/App.tsx',
        'packages/icloud-relay-plugin/src/types.ts',
        'bun.lock',
        'deploy/nginx/damatong.conf',
    ]) {
        assert.throws(() => assertStorefrontOnly(['packages/storefront/src/App.tsx', path]));
    }
});
test('new release is switched as a complete directory and old files remain immutable', async t => {
    const { old, candidate, pointer } = fixture(t);
    const previous = await activateStorefront({
        candidate,
        pointer,
        verify: async () => {
            assert.equal(realpathSync(pointer), realpathSync(candidate));
            assert.equal(readFileSync(join(pointer, 'index.html'), 'utf8'), 'new version');
        },
    });
    assert.equal(previous, realpathSync(old));
    assert.equal(readFileSync(join(old, 'index.html'), 'utf8'), 'old version');
});
test('failed acceptance restores the previous frontend and retains both releases', async t => {
    const { old, candidate, pointer } = fixture(t);
    await assert.rejects(
        activateStorefront({
            candidate,
            pointer,
            verify: async () => {
                throw new Error('public bundle check failed');
            },
        }),
        /public bundle check failed/,
    );
    assert.equal(realpathSync(pointer), realpathSync(old));
    assert.equal(readFileSync(join(candidate, 'index.html'), 'utf8'), 'new version');
});
test('incomplete candidate cannot replace a healthy frontend', t => {
    const { old, candidate, pointer } = fixture(t);
    rmSync(join(candidate, 'index.html'));
    assert.throws(() => switchStorefront(candidate, pointer));
    assert.equal(realpathSync(pointer), realpathSync(old));
});
test('first full release initializes a pointer and can switch back to its previous runtime', t => {
    const { old, candidate, pointer } = fixture(t);
    rmSync(pointer);
    assert.equal(switchStorefront(candidate, pointer), null);
    switchStorefront(old, pointer);
    assert.equal(readFileSync(join(pointer, 'index.html'), 'utf8'), 'old version');
});
test('public acceptance rejects stale entry assets and permits CDN analytics markup', () => {
    const expected = '<script src="/assets/current.js"></script><link href="/assets/current.css">';
    assert.doesNotThrow(() =>
        assertServedStorefrontAssets(
            expected,
            expected + '<script src="https://analytics.example/script.js"></script>',
        ),
    );
    assert.throws(() => assertServedStorefrontAssets(expected, expected.replace('current.js', 'old.js')));
    assert.throws(() => assertServedStorefrontAssets('<html></html>', '<html></html>'));
});

test('the production archive guard rejects traversal and symlinks before extraction', t => {
    const root = mkdtempSync(join(tmpdir(), 'storefront-archive-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const script = readFileSync(new URL('./deploy-storefront-from-s3.sh', import.meta.url), 'utf8');
    const guard = script.match(
        /python3 - "\$staging_dir\/archive.tar.gz" "\$staging_dir\/dist" <<'PY'\n([\s\S]*?)\nPY/,
    )[1];
    for (const kind of ['normal', 'traversal', 'symlink']) {
        const archive = join(root, `${kind}.tar.gz`);
        execFileSync('python3', [
            '-c',
            `
import io, sys, tarfile
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    item = tarfile.TarInfo('../outside' if sys.argv[2] == 'traversal' else 'index.html')
    if sys.argv[2] == 'symlink':
        item.type = tarfile.SYMTYPE
        item.linkname = '../outside'
        archive.addfile(item)
    else:
        item.size = 8
        archive.addfile(item, io.BytesIO(b'complete'))
`,
            archive,
            kind,
        ]);
        const result = spawnSync('python3', ['-', archive, join(root, kind)], {
            input: guard,
            encoding: 'utf8',
        });
        if (kind === 'normal') {
            assert.equal(result.status, 0, result.stderr);
            assert.equal(readFileSync(join(root, kind, 'index.html'), 'utf8'), 'complete');
        } else {
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /Unsafe storefront archive member/);
        }
    }
});
