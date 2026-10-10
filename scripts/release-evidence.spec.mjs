import yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    checkCovered,
    checkFingerprint,
    checkRequirements,
    jobRecipe,
    missingPlan,
    sharedInputFingerprint,
} from './ci-check-inputs.mjs';
import { classifyChanges } from './ci-impact.mjs';
import { frontendTestCommands, packageCommands } from './ci-run.mjs';
import {
    coversChanges,
    downloadEvidenceArtifact,
    findEvidence,
    findInputCoverage,
    frontendEvidencePlan,
    hasTrustedPullRequest,
    isTrustedRun,
    requestGitHubApi,
    validateExecutedChecks,
    waitForCompleteInputCoverage,
} from './release-evidence.mjs';

test('release evidence readers can verify merged PR CI with read-only GitHub token access', () => {
    const readWorkflow = name =>
        yaml.load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
    const release = readWorkflow('production_release');
    for (const job of ['route', 'checks', 'frontend', 'build']) {
        assert.equal(release.jobs[job].permissions['pull-requests'], 'read', job);
    }
    assert.equal(readWorkflow('build_and_test').jobs['detect-changes'].permissions['pull-requests'], 'read');
    for (const name of ['build_production_runtime', 'deploy_frontends', 'deploy_storefront_fast_lane']) {
        assert.equal(readWorkflow(name).permissions['pull-requests'], 'read', name);
    }
});

test('static evidence checks each app against its active pointer while retaining cumulative runtime safety', () => {
    const source = 'a'.repeat(40);
    const target = 'b'.repeat(40);
    const oldStore = 'packages/storefront/src/pages/search-page.tsx';
    const newStore = 'packages/storefront/src/styles/desktop-commerce.css';
    const oldAdmin = 'packages/next-admin/e2e/carousel/fixture.tsx';
    const hero = 'packages/storefront-content-plugin/src/shared/hero-scene.css';
    const controls = 'scripts/release-evidence.mjs';
    const cumulative = classifyChanges([oldStore, newStore, oldAdmin, hero, controls]);
    const scoped = frontendEvidencePlan(
        cumulative,
        { storefrontSha: source, adminSha: source, targetSha: target },
        () => [newStore, controls],
    );
    assert.deepEqual(scoped.files, [newStore, controls]);
    assert.deepEqual(scoped.frontends, ['next-admin', 'storefront']);
    assert.equal(scoped.controls, true);
    assert.equal(scoped.lane, 'frontend');
    const checks = checkRequirements(scoped, []);
    const frontend = checks.find(check => check.id === 'frontend:storefront');
    assert.deepEqual(frontend.files, [newStore]);
    assert.deepEqual(checks.find(check => check.id === 'frontend:next-admin').files, [newStore]);
    assert.ok(
        !checks.some(check => check.file === oldStore || check.file === oldAdmin || check.file === hero),
    );
    const editedAgain = frontendEvidencePlan(cumulative, { storefrontSha: source, targetSha: target }, () => [
        oldStore,
        newStore,
        hero,
    ]);
    assert.ok(editedAgain.files.includes(oldStore));
    assert.ok(editedAgain.files.includes(hero));
    assert.ok(editedAgain.files.includes(oldAdmin), 'missing app pointer keeps conservative coverage');
    for (const file of [
        'packages/core/src/api/auth.ts',
        'packages/dev-server/migrations/change.ts',
        'packages/storefront/vite.config.ts',
    ]) {
        const runtime = classifyChanges([...cumulative.files, file]);
        assert.equal(runtime.lane, 'runtime');
        assert.equal(
            frontendEvidencePlan(
                runtime,
                { storefrontSha: source, adminSha: source, targetSha: target },
                () => [],
            ),
            runtime,
        );
    }
    assert.equal(
        frontendEvidencePlan(cumulative, { storefrontSha: 'unknown', adminSha: 'unknown' }, () => []),
        cumulative,
    );
    assert.throws(() =>
        frontendEvidencePlan(cumulative, { storefrontSha: 'invalid', targetSha: target }, () => []),
    );
});

test('a current client still requires an older Admin preview to cover client CSS', () => {
    const source = 'a'.repeat(40);
    const oldAdmin = 'b'.repeat(40);
    const target = 'c'.repeat(40);
    const style = 'packages/storefront/src/styles/home-showcase.css';
    const plan = classifyChanges([style]);
    const scoped = frontendEvidencePlan(
        plan,
        { storefrontSha: source, adminSha: oldAdmin, targetSha: target },
        from => (from === source ? [] : [style]),
    );
    assert.deepEqual(scoped.frontends, ['next-admin']);
    assert.deepEqual(scoped.files, [style]);
    assert.deepEqual(
        checkRequirements(scoped, inputInventory).find(check => check.id === 'frontend:next-admin').files,
        [style],
    );
});

test('GitHub evidence reads retry transient HTTP and network failures without retrying client errors', () => {
    const delays = [];
    let calls = 0;
    const request = () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('gateway timeout'), { stderr: 'gh: HTTP 504' });
        return '{"ok":true}';
    };
    assert.deepEqual(
        requestGitHubApi('repos/owner/repo/pulls/7', request, delay => delays.push(delay)),
        {
            ok: true,
        },
    );
    assert.equal(calls, 2);
    assert.deepEqual(delays, [1000]);

    for (const stderr of ['gh: HTTP 403', 'gh: HTTP 404', 'bad JSON']) {
        let attempts = 0;
        assert.throws(() =>
            requestGitHubApi(
                'repos/owner/repo/pulls/7',
                () => {
                    attempts++;
                    throw Object.assign(new Error('request failed'), { stderr });
                },
                () => assert.fail('Client errors must not wait'),
            ),
        );
        assert.equal(attempts, 1);
    }
    let transientAttempts = 0;
    const transientDelays = [];
    assert.throws(() =>
        requestGitHubApi(
            'repos/owner/repo/pulls/7',
            () => {
                transientAttempts++;
                throw Object.assign(new Error('still unavailable'), { stderr: 'gh: HTTP 504' });
            },
            delay => transientDelays.push(delay),
        ),
    );
    assert.equal(transientAttempts, 3);
    assert.deepEqual(transientDelays, [1000, 2000]);

    let networkAttempts = 0;
    const networkDelays = [];
    assert.deepEqual(
        requestGitHubApi(
            'repos/owner/repo/actions/runs?status=completed&per_page=100',
            () => {
                networkAttempts++;
                if (networkAttempts < 3)
                    throw Object.assign(new Error('network unavailable'), {
                        stderr: 'Get "https://api.github.com": net/http: TLS handshake timeout',
                    });
                return '{"workflow_runs":[]}';
            },
            delay => networkDelays.push(delay),
        ),
        { workflow_runs: [] },
    );
    assert.equal(networkAttempts, 3);
    assert.deepEqual(networkDelays, [1000, 2000]);
});

test('evidence archives retry transient downloads and fail closed on client or persistent errors', () => {
    const delays = [];
    const archive = Buffer.from('trusted archive bytes');
    let attempts = 0;
    const result = downloadEvidenceArtifact(
        'owner/repo',
        42,
        (command, args, options) => {
            attempts++;
            assert.equal(command, 'gh');
            assert.deepEqual(args, ['api', 'repos/owner/repo/actions/artifacts/42/zip']);
            assert.equal(options.maxBuffer, 2 * 1024 * 1024);
            if (attempts < 3)
                throw Object.assign(new Error('network unavailable'), {
                    stderr: Buffer.from('Get "https://api.github.com": net/http: TLS handshake timeout'),
                });
            return archive;
        },
        delay => delays.push(delay),
    );
    assert.equal(result, archive);
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);

    for (const stderr of ['gh: HTTP 403', 'gh: HTTP 404', 'invalid archive']) {
        let calls = 0;
        assert.throws(() =>
            downloadEvidenceArtifact(
                'owner/repo',
                42,
                () => {
                    calls++;
                    throw Object.assign(new Error('download failed'), { stderr });
                },
                () => assert.fail('Client errors must not wait'),
            ),
        );
        assert.equal(calls, 1);
    }

    let persistentAttempts = 0;
    const persistentDelays = [];
    assert.throws(() =>
        downloadEvidenceArtifact(
            'owner/repo',
            42,
            () => {
                persistentAttempts++;
                throw Object.assign(new Error('still unavailable'), { stderr: 'gh: HTTP 503' });
            },
            delay => persistentDelays.push(delay),
        ),
    );
    assert.equal(persistentAttempts, 3);
    assert.deepEqual(persistentDelays, [1000, 2000]);
});

test('a previous PR does not cover additional undeployed backend changes', () => {
    const css = 'packages/storefront/src/style.css';
    const proof = { version: 1, files: [css], full: false };
    assert.equal(coversChanges(proof, [css, 'README.md']), true);
    assert.equal(coversChanges(proof, [css, 'packages/core/src/payment.ts']), false);
    assert.equal(coversChanges({ ...proof, full: true }, [css, 'packages/core/src/payment.ts']), true);
    assert.equal(coversChanges({ ...proof, version: 0 }, [css]), false);
});
test('failed, foreign, fork-triggered or unrelated workflows cannot authorize a deployment', () => {
    const run = {
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'owner/repo' },
        event: 'pull_request',
        path: '.github/workflows/build_and_test.yml',
    };
    assert.equal(isTrustedRun(run, 'owner/repo'), true);
    for (const patch of [
        { conclusion: 'failure' },
        { status: 'in_progress' },
        { event: 'pull_request_target' },
        { path: '.github/workflows/other.yml' },
    ])
        assert.equal(isTrustedRun({ ...run, ...patch }, 'owner/repo'), false);
    assert.equal(isTrustedRun(run, 'other/repo'), false);
});
test('squash and merge commit shapes can reuse the same checked tree', async () => {
    const sha = 'a'.repeat(40);
    const head = 'b'.repeat(40);
    const tree = 'c'.repeat(40);
    const result = await findEvidence({
        repository: 'owner/repo',
        targetSha: sha,
        requiredFiles: [],
        api(endpoint) {
            if (endpoint.includes('/git/commits/')) return { tree: { sha: tree } };
            if (endpoint.includes('/artifacts?'))
                return { artifacts: [{ name: 'ci-evidence-42-1', id: 8, expired: false }] };
            if (endpoint.endsWith('/pulls/7'))
                return { head: { sha: head, repo: { full_name: 'owner/repo' } } };
            return {
                workflow_runs: [
                    {
                        id: 42,
                        run_attempt: 1,
                        status: 'completed',
                        conclusion: 'success',
                        head_sha: head,
                        head_repository: { full_name: 'owner/repo' },
                        event: 'pull_request',
                        path: '.github/workflows/build_and_test.yml',
                        pull_requests: [{ number: 7 }],
                    },
                ],
            };
        },
    });
    assert.equal(result.runId, 42);
});
test('scoped backend commands do not invoke the whole repository test script', () => {
    const plan = { full: false, packages: ['catalog'] };
    const inventory = [
        { directory: 'catalog', name: '@vendure/catalog', scripts: { build: 'tsc', test: 'vitest' } },
        { directory: 'icloud', name: 'icloud', scripts: { test: 'vitest' } },
    ];
    assert.deepEqual(packageCommands(plan, 'test', inventory), [
        ['bunx', 'lerna', 'run', 'test', '--scope', '@vendure/catalog'],
    ]);
    assert.ok(packageCommands(plan, 'build', inventory)[0].includes('--include-dependencies'));
});

test('mixed frontend checks run the Node fixture separately from Vitest and exclude it from related checks', () => {
    const cwd = fileURLToPath(new URL('../packages/storefront/', import.meta.url));
    const fixture = join(cwd, 'e2e/client-loading/preview-server.spec.mjs');
    const unit = join(cwd, 'src/api/catalog.spec.ts');
    const source = join(cwd, 'e2e/client-loading/preview-server.mjs');
    assert.deepEqual(frontendTestCommands([fixture, unit], [source], cwd), [
        ['node', '--test', fixture],
        ['bunx', 'vitest', 'run', unit],
        [
            'bunx',
            'vitest',
            'related',
            '--run',
            '--passWithNoTests',
            '--exclude',
            'e2e/client-loading/preview-server.spec.mjs',
            source,
        ],
    ]);
});

test('Vitest-only frontend checks retain their existing runner', () => {
    const cwd = fileURLToPath(new URL('../packages/storefront/', import.meta.url));
    const unit = join(cwd, 'src/api/catalog.spec.ts');
    assert.deepEqual(frontendTestCommands([unit], [], cwd), [['bunx', 'vitest', 'run', unit]]);
});

test('a same-tree fork or superseded PR head cannot supply trusted release evidence', () => {
    const run = { event: 'pull_request', head_sha: 'a'.repeat(40), pull_requests: [{ number: 1 }] };
    const api = (repository, sha) => () => ({ head: { repo: { full_name: repository }, sha } });
    assert.equal(hasTrustedPullRequest(run, 'owner/repo', api('owner/repo', run.head_sha)), true);
    assert.equal(hasTrustedPullRequest(run, 'owner/repo', api('fork/repo', run.head_sha)), false);
    assert.equal(hasTrustedPullRequest(run, 'owner/repo', api('owner/repo', 'b'.repeat(40))), false);
    assert.equal(
        hasTrustedPullRequest({ ...run, pull_requests: [] }, 'owner/repo', () => []),
        false,
    );
});

test('merged PRs with empty Actions associations resolve through the exact commit without trusting forks', () => {
    const run = { event: 'pull_request', head_sha: 'a'.repeat(40), pull_requests: [] };
    const calls = [];
    const api = endpoint => {
        calls.push(endpoint);
        if (endpoint === `repos/owner/repo/commits/${run.head_sha}/pulls?per_page=100`)
            return [{ number: 1 }, { number: 2 }, { number: 3 }];
        if (endpoint.endsWith('/pulls/1'))
            return { head: { sha: run.head_sha, repo: { full_name: 'fork/repo' } } };
        if (endpoint.endsWith('/pulls/2'))
            return { head: { sha: 'b'.repeat(40), repo: { full_name: 'owner/repo' } } };
        if (endpoint.endsWith('/pulls/3'))
            return { head: { sha: run.head_sha, repo: { full_name: 'owner/repo' } } };
        assert.fail(endpoint);
    };
    assert.equal(hasTrustedPullRequest(run, 'owner/repo', api), true);
    assert.equal(calls.length, 4);
    assert.equal(
        hasTrustedPullRequest(run, 'owner/repo', endpoint =>
            endpoint.includes('/commits/')
                ? [{ number: 1 }]
                : { head: { sha: run.head_sha, repo: { full_name: 'fork/repo' } } },
        ),
        false,
    );
});

test('frontend runner uses the test environment and stops before build when related tests fail', t => {
    const root = mkdtempSync(join(tmpdir(), 'scoped-frontend-command-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const bin = join(root, 'bin');
    const app = join(root, 'packages', 'storefront');
    mkdirSync(bin);
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'style.css'), 'body {}');
    const log = join(root, 'commands.txt');
    const stub =
        '#!/bin/sh\nprintf "%s|%s|%s\\n" "$NODE_ENV" "$PWD" "$*" >> "$CI_COMMAND_LOG"\n' +
        'if [ "$CI_TEST_FAIL" = true ] && [ "$1" = vitest ]; then exit 1; fi\n';
    for (const command of ['bun', 'bunx']) writeFileSync(join(bin, command), stub, { mode: 0o755 });
    const environment = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CI_COMMAND_LOG: log,
        CI_PLAN: JSON.stringify({ full: false, files: ['packages/storefront/style.css'] }),
        NODE_ENV: 'production',
    };
    const run = fail =>
        spawnSync(
            process.execPath,
            [fileURLToPath(new URL('./ci-run.mjs', import.meta.url)), 'frontend', 'storefront'],
            { cwd: root, env: { ...environment, CI_TEST_FAIL: String(fail) }, encoding: 'utf8' },
        );
    assert.equal(run(false).status, 0);
    const commands = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(commands.length, 2);
    assert.match(commands[0], /^test\|.*\|vitest related --run --passWithNoTests /u);
    assert.match(commands[1], /^production\|.*\|run build$/u);
    writeFileSync(log, '');
    assert.notEqual(run(true).status, 0);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});

// Simulate the release that exposed repeated full runs: business checks pass, then only backup/CI controls change.
const inputInventory = [
    { directory: 'common', name: '@vendure/common' },
    {
        directory: 'core',
        name: '@vendure/core',
        dependencies: { '@vendure/common': '3' },
        scripts: { e2e: 'test' },
    },
    { directory: 'storefront', name: '@vendure/storefront' },
];
const sourceSha = 'a'.repeat(40);
const targetSha = 'b'.repeat(40);
const workflow = readFileSync(new URL('../.github/workflows/build_and_test.yml', import.meta.url), 'utf8');
function inputFixture(changes = {}) {
    const source = {
        'package.json': '{}',
        'bun.lock': 'lock',
        'packages/core/src/service.ts': 'business',
        'packages/common/src/index.ts': 'shared',
        'packages/storefront/src/a.ts': 'a',
        'packages/storefront/src/b.ts': 'b',
        'scripts/ci-impact.mjs': 'export function packageInventory() {\nreturn [];\n}',
        'scripts/ci-run.mjs': 'runner',
        'scripts/lint-check.mjs': 'lint',
        'deploy/systemd/backup.py': 'backup-v1',
        '.github/workflows/build_and_test.yml': workflow,
    };
    const target = { ...source, ...changes };
    const data = { [sourceSha]: source, [targetSha]: target };
    return {
        source,
        target,
        reader: {
            entries: ref =>
                Object.entries(data[ref])
                    .filter(([, text]) => text !== null)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([path, text]) => ({
                        path,
                        metadata: createHash('sha256').update(text).digest('hex'),
                    })),
            text: (ref, path) => data[ref][path],
        },
    };
}
function coverageFixture({ targetProof = true, changes, mutateRun, mutateProof, expired = false } = {}) {
    const changedFiles = ['packages/core/src/service.ts', 'deploy/systemd/backup.py'];
    const plan = classifyChanges(changedFiles, inputInventory);
    const sourcePlan = classifyChanges(changedFiles, inputInventory, { full: true });
    const narrow = classifyChanges(['deploy/systemd/backup.py'], inputInventory);
    const runs = [
        { id: 2, head_sha: targetSha },
        { id: 1, head_sha: sourceSha },
    ]
        .filter(run => targetProof || run.id !== 2)
        .map(run => ({
            ...run,
            status: 'completed',
            conclusion: 'success',
            event: 'workflow_dispatch',
            path: '.github/workflows/build_and_test.yml',
            head_repository: { full_name: 'owner/repo' },
        }));
    if (mutateRun) runs.forEach(mutateRun);
    const proofs = {
        1: { ...sourcePlan, version: 1, sourceSha, tree: 'source-tree', runId: 1 },
        2: { ...narrow, version: 2, sourceSha: targetSha, tree: 'target-tree', runId: 2 },
    };
    if (mutateProof) Object.values(proofs).forEach(mutateProof);
    const api = endpoint => {
        const workflowMatch =
            /\/actions\/workflows\/([^/]+)\/runs\?status=completed&(?:created=[^&]+&)?per_page=100$/u.exec(
                endpoint,
            );
        if (workflowMatch)
            return {
                workflow_runs: runs.filter(run => run.path.endsWith(`/${workflowMatch[1]}`)),
            };
        if (endpoint.includes('/git/commits/'))
            return { tree: { sha: endpoint.endsWith(targetSha) ? 'target-tree' : 'source-tree' } };
        const artifacts = /\/actions\/runs\/(\d+)\/artifacts/u.exec(endpoint);
        if (artifacts)
            return { artifacts: [{ id: +artifacts[1], expired, name: `ci-evidence-${artifacts[1]}-1` }] };
        assert.fail(endpoint);
    };
    return {
        repository: 'owner/repo',
        targetSha,
        plan,
        inventory: inputInventory,
        api,
        proofReader: (_, id) => proofs[id],
        reader: inputFixture({ 'deploy/systemd/backup.py': 'backup-v2', ...changes }).reader,
    };
}
test('recent workflow indexes recover exact CI proof omitted by cached historical indexes', async () => {
    const fixture = coverageFixture();
    const api = fixture.api;
    let recentReads = 0;
    fixture.api = endpoint => {
        if (endpoint.includes('/actions/workflows/') && endpoint.includes('/runs?')) {
            if (endpoint.includes('&created=')) {
                recentReads++;
                return api(endpoint);
            }
            return { workflow_runs: [] };
        }
        return api(endpoint);
    };
    const result = await findInputCoverage(fixture);
    assert.equal(recentReads, 3);
    assert.equal(result.anchor.runId, 2);
    assert.equal(result.missing.length, 0);
    assert.ok(result.reused.some(check => check.runId === 1));
});

test('backup-only follow-up combines narrow target proof with older full business proof', async () => {
    const result = await findInputCoverage(coverageFixture());
    assert.equal(result.missing.length, 0);
    assert.equal(result.anchor.runId, 2);
    assert.equal(result.reused.find(item => item.check === 'backend:core').runId, 1);
    assert.equal(result.reused.find(item => item.check === 'controls').runId, 2);
});

test('different shared lock inputs reject historical checks before expensive per-file hashing while preserving architecture reuse', async () => {
    const fixture = coverageFixture({
        targetProof: false,
        changes: { 'bun.lock': 'reviewed patched lock' },
        mutateProof: proof => {
            proof.architecture = true;
        },
    });
    fixture.plan.architecture = true;
    fixture.plan.lintFiles = Array.from({ length: 400 }, (_, index) => `scripts/check-${index}.mjs`);
    let sourceEntries = 0;
    const entries = fixture.reader.entries;
    fixture.reader.entries = ref => {
        if (ref === sourceSha) sourceEntries++;
        return entries(ref);
    };
    const result = await findInputCoverage(fixture);
    assert.ok(result.missing.some(check => check.id === 'backend:core'));
    assert.equal(result.missing.filter(check => check.kind === 'quality').length, 400);
    assert.ok(result.reused.some(check => check.check === 'architecture'));
    assert.ok(sourceEntries <= 3, `Historical tree scanned ${sourceEntries} times`);
    assert.equal(result.anchor, undefined);
});

test('shared input prefilter includes additions, deletions and modes but leaves unrelated code to the full fingerprint', () => {
    for (const changes of [
        { 'bun.lock': 'new lock' },
        { 'patches/pkg.patch': 'reviewed patch' },
        { 'package.json': null },
        { '.github/actions/setup/action.yml': 'different setup' },
    ]) {
        const { reader: changedReader } = inputFixture(changes);
        assert.notEqual(
            sharedInputFingerprint(sourceSha, changedReader),
            sharedInputFingerprint(targetSha, changedReader),
        );
    }
    const { reader } = inputFixture({ 'packages/core/src/service.ts': 'changed business code' });
    assert.equal(sharedInputFingerprint(sourceSha, reader), sharedInputFingerprint(targetSha, reader));
    const check = { id: 'backend:core', kind: 'backend', packages: ['core'], flags: [], databases: [] };
    assert.notEqual(
        checkFingerprint(sourceSha, check, inputInventory, reader),
        checkFingerprint(targetSha, check, inputInventory, reader),
    );
    const entries = reader.entries;
    reader.entries = ref =>
        entries(ref).map(entry =>
            entry.path === 'package.json' && ref === targetSha
                ? { ...entry, metadata: `mode-changed:${entry.metadata}` }
                : entry,
        );
    assert.notEqual(sharedInputFingerprint(sourceSha, reader), sharedInputFingerprint(targetSha, reader));
});
test('without target proof only missing control and file checks run; business and MySQL are reused', async () => {
    const fixture = coverageFixture({ targetProof: false });
    const result = await findInputCoverage(fixture);
    const execution = missingPlan(fixture.plan, result.missing);
    assert.deepEqual(execution.packages, []);
    assert.deepEqual(execution.databases, []);
    assert.equal(execution.full, false);
    assert.equal(execution.controls, true);
    assert.deepEqual(execution.lintFiles, ['deploy/systemd/backup.py']);
    assert.deepEqual(execution.files, []);
    assert.deepEqual(execution.changedPackages, []);
    assert.equal(result.anchor, undefined);
});
test('missing plan transports only files consumed by missing checks', () => {
    const cumulative = classifyChanges(
        [
            'packages/core/src/service.ts',
            'packages/storefront/src/a.ts',
            'packages/storefront/src/b.ts',
            'deploy/systemd/backup.py',
        ],
        inputInventory,
    );
    const required = checkRequirements(cumulative, inputInventory);
    const execution = missingPlan(cumulative, [
        required.find(check => check.id === 'frontend:storefront'),
        required.find(check => check.id === 'quality:deploy/systemd/backup.py'),
        required.find(check => check.id === 'controls'),
    ]);

    assert.deepEqual(execution.files, ['packages/storefront/src/a.ts', 'packages/storefront/src/b.ts']);
    assert.deepEqual(execution.lintFiles, ['deploy/systemd/backup.py']);
    assert.deepEqual(execution.packages, []);
    assert.deepEqual(execution.frontends, ['storefront']);
    assert.deepEqual(execution.changedPackages, ['storefront']);
    assert.deepEqual(
        checkRequirements(execution, inputInventory).map(check => check.id),
        ['frontend:storefront', 'controls', 'quality:deploy/systemd/backup.py'],
    );
});
test('shared dependency, lockfile, test commands, global environment and deleted source invalidate affected checks', () => {
    const check = checkRequirements(
        classifyChanges(['packages/core/src/service.ts'], inputInventory),
        inputInventory,
    ).find(item => item.id === 'backend:core');
    for (const changes of [
        { 'packages/common/src/index.ts': 'shared-v2' },
        { 'bun.lock': 'new-lock' },
        { 'scripts/ci-run.mjs': 'new-runner' },
        { 'packages/core/src/service.ts': null },
        { '.github/workflows/build_and_test.yml': workflow.replace('CI: true', 'CI: false') },
        {
            '.github/workflows/build_and_test.yml': workflow.replace(
                'node scripts/ci-run.mjs build',
                'node scripts/ci-run.mjs test',
            ),
        },
    ]) {
        const { reader } = inputFixture(changes);
        assert.notEqual(
            checkFingerprint(sourceSha, check, inputInventory, reader),
            checkFingerprint(targetSha, check, inputInventory, reader),
            JSON.stringify(Object.keys(changes)),
        );
    }
});
test('architecture proof depends on budgeted files rather than every unrelated package edit', () => {
    const check = checkRequirements(
        classifyChanges(['packages/storefront/src/styles.css'], inputInventory),
        inputInventory,
    ).find(item => item.id === 'architecture');
    assert.ok(check);
    const unrelated = inputFixture({ 'packages/core/src/service.ts': 'new business code' }).reader;
    assert.equal(
        checkFingerprint(sourceSha, check, inputInventory, unrelated),
        checkFingerprint(targetSha, check, inputInventory, unrelated),
    );
    const budgeted = inputFixture({ 'packages/storefront/src/styles.css': 'new budgeted style' }).reader;
    assert.notEqual(
        checkFingerprint(sourceSha, check, inputInventory, budgeted),
        checkFingerprint(targetSha, check, inputInventory, budgeted),
    );
});
test('routing and job conditions alone do not invalidate unchanged business checks', () => {
    const routed = workflow.replace("if: needs.detect-changes.outputs.e2e_mysql == 'true'", 'if: false');
    assert.equal(jobRecipe(workflow, 'e2e-mysql'), jobRecipe(routed, 'e2e-mysql'));
    const { reader } = inputFixture({ '.github/workflows/build_and_test.yml': routed });
    const check = checkRequirements(
        classifyChanges(['packages/core/src/service.ts'], inputInventory),
        inputInventory,
    )[0];
    assert.equal(
        checkFingerprint(sourceSha, check, inputInventory, reader),
        checkFingerprint(targetSha, check, inputInventory, reader),
    );
});
test('failed, foreign, expired and mismatched proof cannot supply reused checks', async () => {
    for (const options of [
        {
            mutateRun: run => {
                run.conclusion = 'failure';
            },
        },
        {
            mutateRun: run => {
                run.head_repository.full_name = 'fork/repo';
            },
        },
        { expired: true },
        {
            mutateProof: proof => {
                proof.sourceSha = 'c'.repeat(40);
            },
        },
        {
            mutateProof: proof => {
                proof.runId = 99;
            },
        },
        {
            mutateProof: proof => {
                proof.tree = 'wrong';
            },
        },
    ]) {
        const result = await findInputCoverage(coverageFixture(options));
        assert.ok(result.missing.some(item => item.id === 'backend:core'));
        assert.equal(result.anchor, undefined);
    }
});
test('related frontend tests do not claim coverage of another undeployed file or a whole-package request', () => {
    const plan = classifyChanges(['packages/storefront/src/a.ts'], inputInventory);
    const proof = { ...plan, version: 2 };
    const other = checkRequirements(
        classifyChanges(['packages/storefront/src/b.ts'], inputInventory),
        inputInventory,
    )[0];
    assert.equal(checkCovered(proof, other, inputInventory), false);
    assert.equal(
        checkCovered(proof, { ...other, files: plan.files, wholePackage: true }, inputInventory),
        false,
    );
    assert.equal(checkCovered({ ...proof, full: true }, other, inputInventory), true);
});
test('the evidence writer rejects a skipped required job and never calls reused checks freshly passed', () => {
    const plan = classifyChanges(['packages/core/src/service.ts'], inputInventory);
    const results = {
        build: { result: 'success' },
        'unit-tests': { result: 'success' },
        'e2e-mysql': { result: 'skipped' },
        'quality-gates': { result: 'success' },
    };
    assert.throws(() => validateExecutedChecks(plan, inputInventory, results), /e2e-mysql did not pass/u);
    results['e2e-mysql'].result = 'success';
    assert.doesNotThrow(() => validateExecutedChecks(plan, inputInventory, results));
    const reused = missingPlan(plan, []);
    assert.deepEqual(checkRequirements(reused, inputInventory), []);
    assert.doesNotThrow(() => validateExecutedChecks(reused, inputInventory, {}));
});

test('historical input mismatches are rejected locally without per-run PR or artifact API lookups', async () => {
    const fixture = coverageFixture({
        targetProof: false,
        changes: { 'packages/core/src/service.ts': 'business-v2' },
        mutateRun: run => {
            run.event = 'pull_request';
            run.pull_requests = [{ number: 1 }];
        },
    });
    fixture.reader.tree = () => 'source-tree';
    const api = fixture.api;
    const calls = [];
    fixture.api = endpoint => {
        calls.push(endpoint);
        return api(endpoint);
    };
    const result = await findInputCoverage(fixture);
    assert.equal(result.reused.length, 0);
    assert.equal(calls.length, 7);
    assert.ok(calls.every(endpoint => !endpoint.includes('/pulls/') && !endpoint.includes('/artifacts')));
});

test('deployment control test changes do not invalidate dev-server business checks', () => {
    const { reader } = inputFixture({
        'packages/dev-server/scripts/production-runtime-audit.spec.mjs': 'updated scope assertions',
    });
    const check = {
        id: 'backend:dev-server',
        kind: 'backend',
        packages: ['dev-server'],
        databases: [],
        flags: [],
    };
    assert.equal(
        checkFingerprint(sourceSha, check, inputInventory, reader),
        checkFingerprint(targetSha, check, inputInventory, reader),
    );
    const controls = { id: 'controls', kind: 'controls', packages: [] };
    assert.notEqual(
        checkFingerprint(sourceSha, controls, inputInventory, reader),
        checkFingerprint(targetSha, controls, inputInventory, reader),
    );
});

test('runtime packaging repairs retain business proofs and invalidate every actual packaging gate', () => {
    const inventory = [...inputInventory, { directory: 'dev-server', name: 'dev-server' }];
    const businessChecks = [
        { id: 'backend:dev-server', kind: 'backend', packages: ['dev-server'], databases: [], flags: [] },
        { id: 'backend:translation', kind: 'backend', packages: [], databases: [], flags: ['translation'] },
        {
            id: 'backend:storefront',
            kind: 'backend',
            packages: [],
            databases: [],
            flags: ['storefrontIntegration'],
        },
        {
            id: 'quality:config',
            kind: 'quality',
            packages: ['dev-server'],
            file: 'packages/dev-server/dev-config.ts',
        },
    ];
    const controls = { id: 'controls', kind: 'controls', packages: [] };
    const dependencies = { id: 'dependencies', kind: 'dependencies', packages: [] };
    const changed = (check, reader) =>
        checkFingerprint(sourceSha, check, inventory, reader) !==
        checkFingerprint(targetSha, check, inventory, reader);
    for (const name of ['artifact', 'audit', 'verify']) {
        const file = `packages/dev-server/scripts/production-runtime-${name}.mjs`;
        const { reader } = inputFixture({ [file]: 'actual production packaging repair' });
        for (const check of businessChecks) assert.equal(changed(check, reader), false, check.id);
        assert.equal(changed(controls, reader), true, file);
        const lint = { id: `quality:${file}`, kind: 'quality', packages: ['dev-server'], file };
        assert.equal(changed(lint, reader), true, file);
        assert.equal(changed(dependencies, reader), name === 'audit', file);
    }
    for (const file of ['packages/dev-server/dev-config.ts', 'packages/dev-server/migrations/new.ts']) {
        const { reader } = inputFixture({ [file]: 'actual business dependency change' });
        for (const check of businessChecks) assert.equal(changed(check, reader), true, check.id);
    }
    for (const file of ['bun.lock', 'patches/braces@3.0.3.patch']) {
        const { reader } = inputFixture({ [file]: 'changed production dependency' });
        for (const check of businessChecks) assert.equal(changed(check, reader), true, check.id);
        assert.equal(changed(dependencies, reader), true, file);
        assert.equal(changed(controls, reader), true, file);
    }
});

test('promotion verifier fixture changes reuse codegen and typed business lint but still check the fixture', () => {
    const file = 'packages/dev-server/scripts/production-release-smoke.spec.mjs';
    const { reader } = inputFixture({ [file]: 'public entry needs no cookie' });
    for (const check of [
        { id: 'codegen', kind: 'codegen', packages: [] },
        {
            id: 'quality:service',
            kind: 'quality',
            packages: ['dev-server'],
            file: 'packages/dev-server/catalog-asset-access-strategy.ts',
        },
    ])
        assert.equal(
            checkFingerprint(sourceSha, check, inputInventory, reader),
            checkFingerprint(targetSha, check, inputInventory, reader),
            check.id,
        );
    const fixture = { id: `quality:${file}`, kind: 'quality', packages: ['dev-server'], file };
    assert.notEqual(
        checkFingerprint(sourceSha, fixture, inputInventory, reader),
        checkFingerprint(targetSha, fixture, inputInventory, reader),
    );
});

test('codegen invalidates its real schema, bootstrap, documents, generator and toolchain inputs', () => {
    const check = { id: 'codegen', kind: 'codegen', packages: [] };
    for (const file of [
        'packages/core/src/api/schema/admin-api/catalog.graphql',
        'packages/common/src/index.ts',
        'packages/admin-ui/src/lib/core/src/data/definitions/products.ts',
        'packages/admin-ui-plugin/src/plugin.ts',
        'scripts/codegen/download-introspection-schema.ts',
        '.github/workflows/codegen.yml',
        'bun.lock',
    ]) {
        const { reader } = inputFixture({ [file]: 'changed' });
        assert.notEqual(
            checkFingerprint(sourceSha, check, inputInventory, reader),
            checkFingerprint(targetSha, check, inputInventory, reader),
            file,
        );
    }
});

test('typed lint retains type dependencies while untyped mjs lint only follows its file and lint configuration', () => {
    const typed = {
        id: 'quality:typed',
        kind: 'quality',
        file: 'packages/core/src/service.ts',
        packages: ['core'],
    };
    const untyped = {
        id: 'quality:script',
        kind: 'quality',
        file: 'packages/core/scripts/check.mjs',
        packages: ['core'],
    };
    const { reader } = inputFixture({ 'packages/common/src/index.ts': 'changed type' });
    assert.notEqual(
        checkFingerprint(sourceSha, typed, inputInventory, reader),
        checkFingerprint(targetSha, typed, inputInventory, reader),
    );
    assert.equal(
        checkFingerprint(sourceSha, untyped, inputInventory, reader),
        checkFingerprint(targetSha, untyped, inputInventory, reader),
    );
    for (const path of ['.eslintrc.js', '.prettierrc', 'scripts/lint-check.mjs', untyped.file]) {
        const { reader: changedReader } = inputFixture({ [path]: 'changed' });
        assert.notEqual(
            checkFingerprint(sourceSha, untyped, inputInventory, changedReader),
            checkFingerprint(targetSha, untyped, inputInventory, changedReader),
            path,
        );
    }
});

test('a full frontend proof matches the build and unit jobs it actually executed', async () => {
    const fixture = coverageFixture({
        targetProof: false,
        changes: {
            '.github/workflows/build_and_test.yml': workflow.replace(
                'name: Check and build the affected frontend',
                'name: Updated related frontend route',
            ),
        },
    });
    fixture.plan = classifyChanges([...fixture.plan.files, 'packages/storefront/src/a.ts'], inputInventory);
    const result = await findInputCoverage(fixture);
    assert.ok(result.reused.some(check => check.check === 'frontend:storefront'));
    const narrow = coverageFixture({
        targetProof: false,
        changes: {
            '.github/workflows/build_and_test.yml': workflow.replace(
                'name: Check and build the affected frontend',
                'name: Updated related frontend route',
            ),
        },
        mutateProof: proof => {
            proof.full = false;
            proof.files.push('packages/storefront/src/a.ts');
        },
    });
    narrow.plan = fixture.plan;
    assert.ok((await findInputCoverage(narrow)).missing.some(check => check.id === 'frontend:storefront'));
});
test('a later deployment failure preserves v2 successful CI-stage evidence, never a failed CI gate', async () => {
    for (const conclusion of ['success', 'failure', 'skipped']) {
        const fixture = coverageFixture({
            mutateRun: run => {
                run.conclusion = 'failure';
                run.path = '.github/workflows/production_release.yml';
            },
            mutateProof: proof => {
                proof.version = 2;
            },
        });
        const api = fixture.api;
        fixture.api = endpoint =>
            endpoint.includes('/jobs?')
                ? { jobs: [{ name: 'validate missing checks once / all-passed', conclusion }] }
                : api(endpoint);
        const result = await findInputCoverage(fixture);
        assert.equal(result.missing.length === 0, conclusion === 'success');
    }
});

test('verification refreshes temporarily incomplete proof lists and still rejects persistent gaps', async () => {
    const missing = { anchor: { runId: 7 }, missing: [{ id: 'backend:dev-server' }] };
    const complete = { anchor: { runId: 7 }, missing: [] };
    const events = [];
    let reads = 0;
    const recovered = await waitForCompleteInputCoverage(
        () => {
            events.push('read');
            return ++reads === 1 ? missing : complete;
        },
        {
            delays: [1],
            pause: async delay => events.push(`pause:${delay}`),
            refresh: () => events.push('refresh'),
        },
    );
    assert.equal(recovered, complete);
    assert.deepEqual(events, ['read', 'pause:1', 'refresh', 'read']);

    let persistentReads = 0;
    const persistent = await waitForCompleteInputCoverage(
        () => {
            persistentReads++;
            return missing;
        },
        { delays: [1, 2], pause: async () => undefined, refresh: () => undefined },
    );
    assert.equal(persistent, missing);
    assert.equal(persistentReads, 3);
});

test('client styles invalidate both client and Admin preview input fingerprints', () => {
    const css = 'packages/storefront-content-plugin/src/shared/hero-scene.css';
    const { reader } = inputFixture({ [css]: 'marketing-cover' });
    const checks = checkRequirements(
        classifyChanges(['packages/storefront/src/a.ts'], inputInventory),
        inputInventory,
    );
    for (const component of ['storefront', 'next-admin']) {
        const check = checks.find(candidate => candidate.id === `frontend:${component}`);
        assert.notEqual(
            checkFingerprint(sourceSha, check, inputInventory, reader),
            checkFingerprint(targetSha, check, inputInventory, reader),
            component,
        );
    }
});
