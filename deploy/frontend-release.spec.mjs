import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
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

import { receiptFromInvocation, validateAcceptanceReceipt } from './acceptance-receipt.mjs';
import { artifactSourceHash, runtimeArtifactRunTrusted } from './artifact-inputs.mjs';
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
test('compiled restore finds a prior successful build after a control-only commit and rejects changed build inputs', t => {
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
    const builtSha = git(['rev-parse', 'HEAD']).toString().trim();
    mkdirSync(join(repository, 'deploy'));
    writeFileSync(join(repository, 'deploy/verify-production-release.mjs'), '// changed verifier\n');
    git(['add', 'deploy']);
    git([
        '-c',
        'user.name=Artifact Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'control',
    ]);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const fakeGh = join(bin, 'gh');
    writeFileSync(
        fakeGh,
        `#!/usr/bin/env node
const assert = require('node:assert/strict');
const { cpSync, readFileSync } = require('node:fs');
const [command, endpoint, ...args] = process.argv.slice(2);
if (command === 'api') {
    const responses = JSON.parse(readFileSync(process.env.ARTIFACT_TEST_RESPONSES));
    assert.ok(Object.hasOwn(responses, endpoint), 'Unexpected API: ' + endpoint);
    process.stdout.write(JSON.stringify(responses[endpoint]));
} else {
    assert.equal(command, 'run'); assert.equal(endpoint, 'download'); assert.equal(args[0], '301');
    cpSync(process.env.ARTIFACT_TEST_DIRECTORY, args[args.indexOf('--dir') + 1], { recursive: true });
}
`,
    );
    chmodSync(fakeGh, 0o755);
    const responses = join(root, 'responses.json');
    const metadata = JSON.parse(readFileSync(join(artifact, 'metadata.json')));
    writeFileSync(
        responses,
        JSON.stringify({
            'repos/owner/repo/actions/runs/302/artifacts?per_page=100': { artifacts: [] },
            'repos/owner/repo/actions/workflows/production_release.yml/runs?status=completed&per_page=20': {
                workflow_runs: [
                    {
                        id: 301,
                        head_sha: builtSha,
                        status: 'completed',
                        conclusion: 'failure',
                        event: 'workflow_dispatch',
                        head_branch: 'main',
                        path: '.github/workflows/production_release.yml',
                        head_repository: { full_name: 'owner/repo' },
                    },
                ],
            },
            'repos/owner/repo/actions/runs/301/jobs?per_page=100': {
                jobs: [
                    {
                        name: 'build immutable runtime / build verified linux/x64 runtime',
                        conclusion: 'success',
                    },
                ],
            },
            'repos/owner/repo/actions/runs/301/artifacts?per_page=100': {
                artifacts: [
                    { name: `compiled-inputs-${metadata.sourceHash}-${metadata.profile}`, expired: false },
                ],
            },
        }),
    );
    const restore = () =>
        execFileSync(
            process.execPath,
            [
                fileURLToPath(new URL('./build-artifact.mjs', import.meta.url)),
                'restore',
                join(root, 'restore'),
                '302',
            ],
            {
                cwd: repository,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATH: `${bin}:${process.env.PATH}`,
                    GITHUB_REPOSITORY: 'owner/repo',
                    ARTIFACT_TEST_RESPONSES: responses,
                    ARTIFACT_TEST_DIRECTORY: artifact,
                },
            },
        );
    rmSync(join(core, 'cli'), { recursive: true });
    rmSync(join(core, 'dist'), { recursive: true });
    assert.match(restore(), /compiled_source_run=301\nrestored=true/u);
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
    writeFileSync(
        join(core, 'package.json'),
        '{"name":"@vendure/core","main":"dist/index.js","version":"2"}',
    );
    git(['add', 'packages/core/package.json']);
    git([
        '-c',
        'user.name=Artifact Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-qm',
        'source',
    ]);
    assert.match(restore(), /restored=false/u);
});

test('compilation follows source inputs across release-script commits, and frontend builds are component-scoped', () => {
    const source = {
        'package.json': 'scripts',
        'bun.lock': 'lock',
        'packages/core/src/index.ts': 'core',
        'packages/storefront/src/page.tsx': 'store',
        'packages/next-admin/src/App.tsx': 'admin',
    };
    const hashFor = (changes, component) =>
        artifactSourceHash({
            component,
            inventory: [],
            reader: {
                entries: () =>
                    Object.entries({ ...source, ...changes })
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([path, metadata]) => ({ path, metadata })),
            },
        });
    for (const changes of [
        { 'deploy/verify-production-release.mjs': 'fixed cookie assertion' },
        { 'packages/dev-server/scripts/production-release-smoke.spec.mjs': 'updated fixture' },
        { '.github/workflows/production_release.yml': 'routing' },
        { 'README.md': 'docs' },
    ]) {
        assert.equal(hashFor(changes), hashFor({}));
        assert.equal(hashFor(changes, 'storefront'), hashFor({}, 'storefront'));
    }
    assert.equal(
        hashFor({ 'packages/next-admin/src/App.tsx': 'admin2' }, 'storefront'),
        hashFor({}, 'storefront'),
    );
    for (const changes of [
        { 'packages/storefront/src/page.tsx': 'store2' },
        { 'bun.lock': 'lock2' },
        { 'tsconfig.json': 'new config' },
        { 'scripts/build.ts': 'new build' },
    ]) {
        assert.notEqual(hashFor(changes), hashFor({}));
        assert.notEqual(hashFor(changes, 'storefront'), hashFor({}, 'storefront'));
    }
});

test('reusable compiled metadata rejects changed inputs, partial outputs, profiles and corrupted bytes', () => {
    const archive = Buffer.from('compiled');
    const expected = { sourceHash: 'a'.repeat(64), tree: 'b'.repeat(40), profile: 'linux-prod' };
    const metadata = {
        version: 2,
        ...expected,
        tree: 'c'.repeat(40),
        full: true,
        archiveSha256: sha(archive),
    };
    assert.doesNotThrow(() => validateBuildArtifact(metadata, expected, archive));
    for (const patch of [
        { sourceHash: 'd'.repeat(64) },
        { profile: 'mac' },
        { full: false },
        { archiveSha256: 'bad' },
    ])
        assert.throws(() => validateBuildArtifact({ ...metadata, ...patch }, expected, archive));
    assert.throws(() =>
        validateBuildArtifact(metadata, { tree: expected.tree, profile: expected.profile }, archive),
    );
    assert.throws(() => validateBuildArtifact(metadata, expected, archive, { tests: true }));
});

test('frontend metadata reuses a component across revisions only with identical build inputs and archive bytes', () => {
    const archive = Buffer.from('frontend');
    const expected = {
        component: 'storefront',
        sourceHash: 'a'.repeat(64),
        tree: 'b'.repeat(40),
        node: '24',
        bun: '1',
        platform: 'linux/x64',
    };
    expected.fingerprint = frontendFingerprint(expected);
    const metadata = {
        version: 2,
        ...expected,
        tree: 'c'.repeat(40),
        sourceSha: 'd'.repeat(40),
        archiveSha256: sha(archive),
    };
    assert.doesNotThrow(() => validateFrontendArtifact(metadata, expected, archive));
    for (const patch of [
        { sourceHash: 'e'.repeat(64) },
        { component: 'next-admin' },
        { fingerprint: frontendFingerprint({ ...expected, node: '25' }) },
        { archiveSha256: 'bad' },
    ])
        assert.throws(() => validateFrontendArtifact({ ...metadata, ...patch }, expected, archive));
});

test('a failed deployment may supply a successful runtime compilation but never a failed or foreign build', () => {
    const run = {
        status: 'completed',
        conclusion: 'failure',
        head_branch: 'main',
        event: 'workflow_dispatch',
        path: '.github/workflows/production_release.yml',
        head_repository: { full_name: 'owner/repo' },
    };
    const jobs = [
        { name: 'build immutable runtime / build verified linux/x64 runtime', conclusion: 'success' },
    ];
    assert.equal(runtimeArtifactRunTrusted(run, 'owner/repo', jobs), true);
    for (const patch of [
        { status: 'in_progress' },
        { head_branch: 'unreviewed' },
        { event: 'pull_request' },
        { head_repository: { full_name: 'fork/repo' } },
    ])
        assert.equal(runtimeArtifactRunTrusted({ ...run, ...patch }, 'owner/repo', jobs), false);
    assert.equal(
        runtimeArtifactRunTrusted(run, 'owner/repo', [{ ...jobs[0], conclusion: 'failure' }]),
        false,
    );
});

test('one committed server acceptance receipt replaces the repeated public smoke pass without accepting incomplete deployments', () => {
    const expected = {
        targetSha: 'a'.repeat(40),
        runId: '123',
        affectedChecks: ['all-store-basics', 'api', 'storefront-realtime'],
    };
    const receipt = { version: 1, ...expected };
    const line = `PRODUCTION_DEPLOY_RECEIPT ${JSON.stringify(receipt)}`;
    const invocation = {
        Status: 'Success',
        ResponseCode: 0,
        StandardOutputContent: `PRODUCTION_DEPLOY_OK\n${line}\n`,
    };
    assert.deepEqual(receiptFromInvocation(invocation, expected), receipt);
    const bounded = spawnSync(
        'bash',
        [
            '-c',
            'set -Eeuo pipefail; (printf "%s\\n" "$NOISY_LOG" "$COMMITTED_OUTPUT"; exit "$DEPLOY_STATUS") 2>&1 | tail -c 12000',
        ],
        {
            encoding: 'utf8',
            env: {
                ...process.env,
                NOISY_LOG: 'x'.repeat(30000),
                COMMITTED_OUTPUT: invocation.StandardOutputContent,
                DEPLOY_STATUS: '0',
            },
        },
    );
    assert.equal(bounded.status, 0);
    assert.ok(Buffer.byteLength(bounded.stdout) <= 12000);
    assert.deepEqual(
        receiptFromInvocation({ ...invocation, StandardOutputContent: bounded.stdout }, expected),
        receipt,
    );
    assert.equal(
        spawnSync('bash', ['-c', 'set -Eeuo pipefail; (echo failed; exit 7) 2>&1 | tail -c 12000']).status,
        7,
    );
    for (const patch of [
        { Status: 'Failed' },
        { ResponseCode: 1 },
        { StandardOutputContent: 'PRODUCTION_DEPLOY_OK\n' },
        { StandardOutputContent: line },
        { StandardOutputContent: `${invocation.StandardOutputContent}${line}\n` },
    ])
        assert.throws(() => receiptFromInvocation({ ...invocation, ...patch }, expected));
    for (const patch of [
        { targetSha: 'b'.repeat(40) },
        { runId: '124' },
        { affectedChecks: ['all-store-basics'] },
    ])
        assert.throws(() => validateAcceptanceReceipt({ ...receipt, ...patch }, expected));
});
