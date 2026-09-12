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
} from './ci-check-inputs.mjs';
import { classifyChanges } from './ci-impact.mjs';
import { packageCommands } from './ci-run.mjs';
import {
    coversChanges,
    findEvidence,
    findInputCoverage,
    hasTrustedPullRequest,
    isTrustedRun,
    validateExecutedChecks,
} from './release-evidence.mjs';

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
        if (endpoint.endsWith('/actions/runs?status=completed&per_page=100')) return { workflow_runs: runs };
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
test('backup-only follow-up combines narrow target proof with older full business proof', async () => {
    const result = await findInputCoverage(coverageFixture());
    assert.equal(result.missing.length, 0);
    assert.equal(result.anchor.runId, 2);
    assert.equal(result.reused.find(item => item.check === 'backend:core').runId, 1);
    assert.equal(result.reused.find(item => item.check === 'controls').runId, 2);
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
    assert.equal(result.anchor, undefined);
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
    assert.equal(calls.length, 2);
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
