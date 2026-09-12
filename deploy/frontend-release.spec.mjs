import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';

import { compiledExtractPython, validateBuildArtifact } from './build-artifact.mjs';
import { frontendFingerprint, safeExtractPython, validateFrontendArtifact } from './frontend-artifact.mjs';
import { activateFrontends, assertFrontendScope, verifyFrontend } from './frontend-release.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'frontend-release-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const releases = ['storefront', 'next-admin'].map(component => {
        const old = join(root, component + '-old');
        const candidate = join(root, component + '-new');
        const pointer = join(root, component);
        for (const path of [old, candidate]) {
            mkdirSync(path);
            writeFileSync(join(path, 'index.html'), '<script src="/dashboard/assets/current.js"></script>');
        }
        writeFileSync(join(candidate, 'frontend-release.json'), '{"sourceSha":"candidate"}\n');
        symlinkSync(old, pointer);
        return { old, candidate, pointer };
    });
    return { root, releases };
}
test('both frontend pointers roll back if the second app fails acceptance', async t => {
    const { releases } = fixture(t);
    await assert.rejects(
        activateFrontends(releases, async () => {
            for (const release of releases) assert.equal(realpathSync(release.pointer), release.candidate);
            throw new Error('admin entry missing');
        }),
        /admin entry missing/u,
    );
    for (const release of releases) assert.equal(realpathSync(release.pointer), release.old);
});
test('a missing second candidate rolls back the first switch', async t => {
    const { releases } = fixture(t);
    rmSync(join(releases[1].candidate, 'index.html'));
    await assert.rejects(
        activateFrontends(releases, async () =>
            assert.fail('Acceptance must not run without both candidates'),
        ),
    );
    for (const release of releases) assert.equal(realpathSync(release.pointer), release.old);
});
test('all cumulative frontend changes must be present in the deployment transaction', () => {
    const files = ['packages/storefront/src/index.css', 'packages/next-admin/src/index.css'];
    assert.throws(() => assertFrontendScope(files, ['storefront']));
    assert.doesNotThrow(() => assertFrontendScope(files, ['next-admin', 'storefront']));
    assert.throws(() =>
        assertFrontendScope([...files, 'packages/core/src/auth.ts'], ['next-admin', 'storefront']),
    );
    assert.throws(() => assertFrontendScope(['packages/storefront/two-factor-tool/main.ts'], ['storefront']));
});
test('public admin acceptance checks entry, marker, and real asset response types', async t => {
    const { releases } = fixture(t);
    const candidate = releases[1].candidate;
    const config = { dashboardUrl: 'https://admin.example/dashboard/', storefronts: [] };
    const fetcher = htmlAsset => async url => {
        const path = new URL(url).pathname;
        const body = path.endsWith('.json')
            ? readFileSync(join(candidate, 'frontend-release.json'), 'utf8')
            : path.endsWith('.js')
              ? 'export {}'
              : readFileSync(join(candidate, 'index.html'), 'utf8');
        return new Response(body, {
            status: 200,
            headers: {
                'content-type': path.endsWith('.js') && !htmlAsset ? 'application/javascript' : 'text/html',
            },
        });
    };
    await verifyFrontend('next-admin', candidate, 'run', { config, fetcher: fetcher(false) });
    await assert.rejects(
        verifyFrontend('next-admin', candidate, 'run', { config, fetcher: fetcher(true) }),
        /returned HTML/u,
    );
});
test('artifact identity changes with source, toolchain or build environment', () => {
    const inputs = {
        component: 'storefront',
        tree: 'a'.repeat(40),
        node: '24',
        bun: '1',
        platform: 'linux/x64',
        environment: { NODE_ENV: 'production' },
    };
    const fingerprint = frontendFingerprint(inputs);
    for (const patch of [
        { tree: 'b'.repeat(40) },
        { node: '25' },
        { environment: { NODE_ENV: 'development' } },
    ])
        assert.notEqual(frontendFingerprint({ ...inputs, ...patch }), fingerprint);
    const archive = Buffer.from('artifact');
    const metadata = {
        version: 1,
        ...inputs,
        sourceSha: 'b'.repeat(40),
        fingerprint,
        archiveSha256: sha(archive),
    };
    assert.doesNotThrow(() => validateFrontendArtifact(metadata, { ...inputs, fingerprint }, archive));
    assert.throws(() =>
        validateFrontendArtifact(metadata, { ...inputs, fingerprint }, Buffer.from('changed')),
    );
    assert.throws(
        () =>
            validateBuildArtifact(
                { version: 1, tree: inputs.tree, archiveSha256: sha(archive), full: false, profile: 'a' },
                { tree: inputs.tree, profile: 'a' },
                archive,
            ),
        /partial build/u,
    );
});
test('archive extraction rejects traversal, symlinks and compiled source overwrites', t => {
    const { root } = fixture(t);
    for (const kind of ['normal', 'traversal', 'symlink', 'source']) {
        const archive = join(root, kind + '.tar.gz');
        execFileSync('python3', [
            '-c',
            `import io,sys,tarfile
with tarfile.open(sys.argv[1],'w:gz') as a:
    p='../outside' if sys.argv[2]=='traversal' else 'packages/core/src/source.ts' if sys.argv[2]=='source' else 'packages/core/dist/index.js'
    m=tarfile.TarInfo(p)
    if sys.argv[2]=='symlink': m.type=tarfile.SYMTYPE; m.linkname='../outside'; a.addfile(m)
    else: m.size=2; a.addfile(m,io.BytesIO(b'ok'))`,
            archive,
            kind,
        ]);
        const result = spawnSync(
            'python3',
            ['-c', compiledExtractPython, archive, join(root, 'out-' + kind)],
            { encoding: 'utf8' },
        );
        assert.equal(result.status === 0, kind === 'normal', result.stderr);
        if (['symlink', 'traversal'].includes(kind))
            assert.notEqual(
                spawnSync('python3', ['-c', safeExtractPython, archive, join(root, 'static-' + kind)]).status,
                0,
            );
    }
});
test('compiled artifact round trip preserves the core CLI required by database tests', t => {
    const { root } = fixture(t);
    const repository = join(root, 'repository');
    const core = join(repository, 'packages/core');
    mkdirSync(join(core, 'cli'), { recursive: true });
    mkdirSync(join(core, 'dist'));
    writeFileSync(join(core, 'package.json'), '{"name":"@vendure/core","main":"dist/index.js"}');
    writeFileSync(join(core, 'cli/index.js'), 'module.exports = { populate: true };');
    writeFileSync(join(core, 'dist/index.js'), 'module.exports = {};');
    const git = args => execFileSync('git', args, { cwd: repository, stdio: 'pipe' });
    git(['init', '-q']);
    git(['add', 'packages/core/package.json']);
    git([
        '-c',
        'user.name=Artifact Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'fixture',
    ]);
    const artifact = join(root, 'compiled');
    execFileSync(
        process.execPath,
        [fileURLToPath(new URL('./build-artifact.mjs', import.meta.url)), 'pack', artifact],
        {
            cwd: repository,
            env: { ...process.env, CI_PLAN: '{"full":true}', COPYFILE_DISABLE: '1' },
        },
    );
    rmSync(join(core, 'cli'), { recursive: true });
    rmSync(join(core, 'dist'), { recursive: true });
    execFileSync('python3', ['-c', compiledExtractPython, join(artifact, 'compiled.tar.gz'), repository]);
    assert.equal(readFileSync(join(core, 'cli/index.js'), 'utf8'), 'module.exports = { populate: true };');
    mkdirSync(join(repository, 'node_modules/@vendure'), { recursive: true });
    symlinkSync(core, join(repository, 'node_modules/@vendure/core'));
    execFileSync(
        process.execPath,
        ['-e', "require('node:assert/strict').equal(require('@vendure/core/cli').populate, true)"],
        {
            cwd: repository,
        },
    );
});
