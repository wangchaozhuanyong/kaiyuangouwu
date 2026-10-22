import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { classifyChanges } from './ci-impact.mjs';
import {
    expectedNativeJobNames,
    hasNativePullRequestProvenance,
    isFailedNativeSource,
    loadNativeCoverage,
    parseNativeScopeLog,
} from './ci-native-coverage.mjs';

const repository = 'owner/repo';
const sourceSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const aheadSha = 'c'.repeat(40);
const sourceTree = 'd'.repeat(40);
const baseTree = 'e'.repeat(40);
const changedFile = 'packages/widget/src/example.ts';
const workflowPath = '.github/workflows/build_and_test.yml';
const workflow = readFileSync(new URL(`../${workflowPath}`, import.meta.url), 'utf8');
const codegenWorkflow = readFileSync(new URL('../.github/workflows/codegen.yml', import.meta.url), 'utf8');
const inventory = [{ directory: 'widget', name: '@example/widget', scripts: { test: 'node --test' } }];
const plan = classifyChanges([changedFile], inventory);
const run = {
    id: 42,
    run_attempt: 1,
    status: 'completed',
    conclusion: 'failure',
    event: 'pull_request',
    path: workflowPath,
    head_sha: sourceSha,
    repository: { id: 12, full_name: repository },
    head_repository: { id: 12, full_name: repository },
    pull_requests: [{ number: 7, base: { sha: baseSha }, head: { sha: sourceSha } }],
};
const digest = value => createHash('sha256').update(value).digest('hex');
const readWorkflow = path => {
    assert.equal(path, '.github/workflows/codegen.yml');
    return codegenWorkflow;
};

test('release evidence bootstraps with builtins and relative control sources while external node_modules reads are denied', context => {
    const projectRoot = fileURLToPath(new URL('../', import.meta.url));
    const reports = join(projectRoot, 'reports/experience-offline-20261013-ci-recovery');
    mkdirSync(reports, { recursive: true });
    const clean = mkdtempSync(join(reports, 'clean-bootstrap-'));
    context.after(() => rmSync(clean, { recursive: true, force: true }));
    const pending = [join(projectRoot, 'scripts/release-evidence.mjs')];
    const copied = new Set();
    while (pending.length) {
        const source = pending.pop();
        if (copied.has(source)) continue;
        copied.add(source);
        const sourcePath = relative(projectRoot, source);
        assert.ok(!sourcePath.startsWith('..'), 'Control import escaped the project');
        const target = join(clean, sourcePath);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        assert.equal(
            digest(readFileSync(target)),
            digest(readFileSync(source)),
            'Clean control bytes differ',
        );
        const text = readFileSync(source, 'utf8');
        for (const match of text.matchAll(/\b(?:from|import)\s*['"]([^'"]+)['"]/gu)) {
            assert.ok(
                match[1].startsWith('.') || match[1].startsWith('node:'),
                'External bootstrap dependency',
            );
            if (match[1].startsWith('.')) pending.push(resolve(dirname(source), match[1]));
        }
    }
    copyFileSync(
        join(projectRoot, 'scripts/architecture-debt-baseline.json'),
        join(clean, 'scripts/architecture-debt-baseline.json'),
    );
    const forbiddenModule = join(projectRoot, 'node_modules/js-yaml/package.json');
    const childScript = [
        "import assert from 'node:assert/strict';",
        "import {readFileSync} from 'node:fs';",
        `const denied = ${JSON.stringify(forbiddenModule)};`,
        "assert.equal(process.permission.has('fs.read', denied), false);",
        "assert.throws(() => readFileSync(denied), {code: 'ERR_ACCESS_DENIED'});",
        `const control = await import(${JSON.stringify(pathToFileURL(join(clean, 'scripts/release-evidence.mjs')).href)});`,
        "assert.equal(typeof control.findInputCoverage, 'function');",
        "console.log('clean-bootstrap-ok ' + process.version);",
    ].join('\n');
    const result = spawnSync(
        process.execPath,
        ['--permission', `--allow-fs-read=${clean}`, '--input-type=module', '-e', childScript],
        { cwd: clean, encoding: 'utf8', env: {}, timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.match(result.stdout, /^clean-bootstrap-ok v\d+\.\d+\.\d+\s*$/u);
    context.diagnostic(result.stdout.trim());
    assert.ok(copied.has(join(projectRoot, 'scripts/ci-native-coverage.mjs')));
});

function provenanceApi({
    currentHead = sourceSha,
    association = [7],
    compare,
    currentRepository = repository,
} = {}) {
    return endpoint => {
        if (endpoint === `repos/${repository}/commits/${sourceSha}/pulls?per_page=100`)
            return association.map(number => ({ number }));
        if (endpoint === `repos/${repository}/pulls/7`)
            return { number: 7, head: { sha: currentHead, repo: { full_name: currentRepository } } };
        if (endpoint === `repos/${repository}/compare/${sourceSha}...${currentHead}`)
            return (
                compare ?? {
                    status: 'ahead',
                    ahead_by: 1,
                    base_commit: { sha: sourceSha },
                    merge_base_commit: { sha: sourceSha },
                }
            );
        assert.fail(`Unexpected provenance endpoint: ${endpoint}`);
    };
}

function nativeLog(executionPlan = plan, options = {}) {
    const lines = [
        '[command]/usr/bin/git log -1 --format=%H',
        options.checkoutSource ?? sourceSha,
        `  PR_BASE_SHA: ${options.prBaseSha ?? baseSha}`,
        `  BASE_SHA: ${options.baseSha ?? baseSha}`,
        `  FULL: ${options.full ?? executionPlan.full}`,
        JSON.stringify(executionPlan, null, 2),
    ];
    return lines
        .join('\n')
        .split('\n')
        .map(line => `${options.timestamp === false ? '' : '2026-10-13T12:00:00.0000000Z '}${line}`)
        .join('\n');
}

function nativeFixture({
    changed = changedFile,
    packages = inventory,
    executionPlan,
    extraJobs = [],
    sourceRun = run,
} = {}) {
    const expectedPlan = classifyChanges([changed], packages);
    const selectedPlan = executionPlan ?? expectedPlan;
    const successJob = (id, name) => ({
        id,
        name,
        run_id: run.id,
        run_attempt: run.run_attempt,
        head_sha: sourceSha,
        status: 'completed',
        conclusion: 'success',
    });
    const jobs = [
        successJob(100, 'detect changes'),
        successJob(101, 'build affected packages'),
        successJob(102, 'affected unit tests (22.x)'),
        { ...successJob(103, 'repository quality gates'), conclusion: 'failure' },
        { ...successJob(104, 'all-passed'), conclusion: 'failure' },
        ...extraJobs.map((name, index) => successJob(200 + index, name)),
    ];
    const state = {
        attempt: structuredClone(sourceRun),
        commit: { tree: { sha: sourceTree } },
        comparison: {
            status: 'ahead',
            base_commit: { sha: baseSha },
            merge_base_commit: { sha: baseSha },
        },
        response: { jobs, total_count: jobs.length },
        log: nativeLog(selectedPlan),
        localTree: sourceTree,
    };
    const files = {
        [workflowPath]: workflow,
        '.github/workflows/codegen.yml': codegenWorkflow,
        [changed]: 'export const value = 1;\n',
    };
    const reader = {
        tree(ref) {
            assert.ok([sourceSha, baseSha].includes(ref));
            return ref === sourceSha ? state.localTree : baseTree;
        },
        entries(ref) {
            assert.ok([sourceSha, baseSha].includes(ref));
            return Object.entries(files).map(([path, text]) => ({
                path,
                metadata: `100644 blob ${digest(path === changed && ref === baseSha ? 'old' : text)}`,
            }));
        },
        text(ref, path) {
            assert.equal(ref, sourceSha);
            assert.ok(path in files, `Missing source fixture: ${path}`);
            return files[path];
        },
    };
    const endpoints = [];
    const api = endpoint => {
        endpoints.push(endpoint);
        if (endpoint === `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`)
            return state.attempt;
        if (endpoint === `repos/${repository}/git/commits/${sourceSha}`) return state.commit;
        if (endpoint === `repos/${repository}/compare/${baseSha}...${sourceSha}`) return state.comparison;
        if (
            endpoint ===
            `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
        )
            return state.response;
        assert.fail(`Unexpected native fixture endpoint: ${endpoint}`);
    };
    const load = () =>
        loadNativeCoverage({
            run: sourceRun,
            repository,
            sourceTree,
            reader,
            inventory: packages,
            api,
            logReader: async (repo, jobId) => {
                assert.equal(repo, repository);
                assert.equal(jobId, 100);
                return state.log;
            },
        });
    return { state, reader, endpoints, expectedPlan, load };
}

test('native recovery sources require the original completed failed same-repository CI run', () => {
    assert.equal(isFailedNativeSource(run, repository), true);
    for (const patch of [
        { status: 'in_progress' },
        { conclusion: 'success' },
        { conclusion: 'cancelled' },
        { event: 'push' },
        { path: '.github/workflows/production_release.yml' },
        { path: '.github/workflows/deploy_storefront_fast_lane.yml' },
        { head_repository: { full_name: 'fork/repo' } },
        { head_repository: { id: 13, full_name: repository } },
        { repository: { id: 12, full_name: 'other/repo' } },
        { head_sha: 'invalid' },
        { id: 0 },
        { id: undefined },
        { id: '42' },
        { run_attempt: 0 },
        { run_attempt: undefined },
    ])
        assert.equal(isFailedNativeSource({ ...run, ...patch }, repository), false, JSON.stringify(patch));
});

test('native PR provenance accepts an unchanged same-repository head', () => {
    assert.equal(hasNativePullRequestProvenance(run, repository, provenanceApi()), true);
});

test('native PR provenance accepts a proved descendant while preserving the original association', () => {
    assert.equal(
        hasNativePullRequestProvenance(run, repository, provenanceApi({ currentHead: aheadSha })),
        true,
    );
});

test('native PR provenance rejects forks, missing original associations and rewritten heads', () => {
    for (const settings of [
        { currentRepository: 'fork/repo' },
        { association: [] },
        { association: [8] },
        { currentHead: aheadSha, compare: { status: 'diverged', merge_base_commit: { sha: baseSha } } },
        {
            currentHead: aheadSha,
            compare: {
                status: 'ahead',
                base_commit: { sha: baseSha },
                merge_base_commit: { sha: sourceSha },
            },
        },
        {
            currentHead: aheadSha,
            compare: {
                status: 'ahead',
                base_commit: { sha: sourceSha },
                merge_base_commit: { sha: baseSha },
            },
        },
    ])
        assert.equal(
            hasNativePullRequestProvenance(run, repository, provenanceApi(settings)),
            false,
            JSON.stringify(settings),
        );
    assert.equal(
        hasNativePullRequestProvenance(
            { ...run, pull_requests: [] },
            repository,
            provenanceApi({ association: [] }),
        ),
        false,
    );
});

test('merged PR metadata can fall back to the immutable source-commit association', () => {
    for (const currentHead of [sourceSha, aheadSha])
        assert.equal(
            hasNativePullRequestProvenance(
                { ...run, pull_requests: [] },
                repository,
                provenanceApi({ currentHead }),
            ),
            true,
        );
});

test('native job identities expand the original node, frontend, shard and reusable workflows', () => {
    assert.deepEqual(expectedNativeJobNames(workflow, 'build', plan, readWorkflow), [
        'build affected packages',
    ]);
    assert.deepEqual(expectedNativeJobNames(workflow, 'unit-tests', plan, readWorkflow), [
        'affected unit tests (22.x)',
    ]);
    assert.deepEqual(expectedNativeJobNames(workflow, 'unit-tests', { ...plan, full: true }, readWorkflow), [
        'affected unit tests (20.x)',
        'affected unit tests (22.x)',
        'affected unit tests (24.x)',
    ]);
    assert.deepEqual(
        expectedNativeJobNames(
            workflow,
            'frontend',
            { ...plan, frontends: ['next-admin', 'storefront'] },
            readWorkflow,
        ),
        ['frontend (next-admin)', 'frontend (storefront)'],
    );
    assert.deepEqual(expectedNativeJobNames(workflow, 'dashboard-e2e', plan, readWorkflow), [
        'dashboard e2e (1)',
        'dashboard e2e (2)',
        'dashboard e2e (3)',
        'dashboard e2e (4)',
    ]);
    assert.deepEqual(expectedNativeJobNames(workflow, 'codegen', plan, readWorkflow), ['codegen / codegen']);
});

test('native job identities reject unknown expressions and incomplete source recipes', () => {
    assert.throws(() => expectedNativeJobNames(workflow, 'missing-job', plan, readWorkflow));
    assert.throws(() =>
        expectedNativeJobNames(
            workflow.replace(
                'component: ${{ fromJSON(needs.detect-changes.outputs.frontends) }}',
                'component: ${{ inputs.components }}',
            ),
            'frontend',
            plan,
            readWorkflow,
        ),
    );
    assert.throws(() =>
        expectedNativeJobNames(
            workflow.replace(
                'name: frontend (${{ matrix.component }})',
                'name: frontend (${{ github.actor }})',
            ),
            'frontend',
            plan,
            readWorkflow,
        ),
    );
    assert.throws(() => expectedNativeJobNames(workflow, 'codegen', plan, () => 'jobs: {}'));
    assert.throws(() =>
        expectedNativeJobNames(
            workflow.replace(
                './.github/workflows/codegen.yml',
                'other/repo/.github/workflows/codegen.yml@main',
            ),
            'codegen',
            plan,
            readWorkflow,
        ),
    );
    assert.throws(() =>
        expectedNativeJobNames(
            'jobs:\n    example:\n        strategy:\n            matrix:\n                node: [22.x]\n                include: [{node: 24.x}]\n',
            'example',
            plan,
            readWorkflow,
        ),
    );
});

test('native matrix naming uses source key order for implicit Cartesian variants', () => {
    const source =
        'jobs:\n    example:\n        name: backend\n        strategy:\n            matrix:\n                node: [22.x, 24.x]\n                shard: [1, 2]\n';
    assert.deepEqual(expectedNativeJobNames(source, 'example', plan, readWorkflow), [
        'backend (22.x, 1)',
        'backend (22.x, 2)',
        'backend (24.x, 1)',
        'backend (24.x, 2)',
    ]);
});

test('finite native workflow parsing preserves quoted identity scalars and local reusable paths', () => {
    for (const scalar of ["'gate: # stable'", '"gate: # stable"']) {
        const text = `jobs:\n    example:\n        name: ${scalar}\n        runs-on: ubuntu-latest\n`;
        assert.deepEqual(expectedNativeJobNames(text, 'example', plan, readWorkflow), ['gate: # stable']);
    }
    for (const scalar of ["'./.github/workflows/codegen.yml'", '"./.github/workflows/codegen.yml"']) {
        const text = `jobs:\n    example:\n        name: parent\n        uses: ${scalar}\n`;
        assert.deepEqual(expectedNativeJobNames(text, 'example', plan, readWorkflow), ['parent / codegen']);
    }
});

test('finite native workflow parsing rejects inline maps, anchors, aliases and block scalar identities', () => {
    const cases = [
        'jobs: {example: {name: gate}}\n',
        'jobs:\n    example: {name: gate}\n',
        'jobs:\n    example:\n        name: gate\n        strategy:\n            matrix: {node: [22.x]}\n',
        'jobs:\n    example:\n        name: gate\n        strategy:\n            matrix:\n                node: [{value: 22.x}]\n',
        'jobs:\n    example: &gate\n        name: gate\n',
        'jobs:\n    example:\n        <<: *shared\n        name: gate\n',
        'jobs:\n    example:\n        name: &gate gate\n',
        'jobs:\n    example:\n        name: *gate\n',
        'jobs:\n    example:\n        name: |\n            gate\n',
        'jobs:\n    example:\n        name: >-\n            gate\n',
        'jobs:\n    example:\n        name: {value: gate}\n',
        'jobs:\n    example:\n        uses: &child ./.github/workflows/codegen.yml\n',
    ];
    for (const text of cases)
        assert.throws(() => expectedNativeJobNames(text, 'example', plan, readWorkflow), undefined, text);
});

test('finite native workflow parsing rejects duplicate identity mappings instead of choosing a value', () => {
    const cases = [
        'jobs:\n    example:\n        name: gate\njobs:\n    other:\n        name: gate\n',
        'jobs: {other: {name: shadow}}\njobs:\n    example:\n        name: gate\n',
        'jobs:\n    example:\n        name: gate\njobs: {other: {name: shadow}}\n',
        'jobs:\n    example:\n        name: one\n    example:\n        name: two\n',
        'jobs:\n    example:\n        name: one\n        name: two\n',
        'jobs:\n    example:\n        name: gate\n        uses: ./.github/workflows/codegen.yml\n        uses: ./.github/workflows/codegen.yml\n',
        'jobs:\n    example:\n        name: gate\n        strategy:\n            matrix:\n                node: [22.x]\n                node: [24.x]\n',
        [
            'jobs:',
            '    example:',
            '        name: gate',
            '        strategy:',
            '            matrix:',
            '                node: [22.x]',
            '            matrix:',
            '                node: [24.x]',
            '',
        ].join('\n'),
    ];
    for (const text of cases)
        assert.throws(() => expectedNativeJobNames(text, 'example', plan, readWorkflow), undefined, text);
});

test('native scope logs preserve the checked source, original base and complete unique execution plan', () => {
    for (const timestamp of [true, false]) {
        const log = nativeLog(plan, { timestamp });
        assert.deepEqual(parseNativeScopeLog(log, run, plan, inventory), {
            plan,
            baseSha,
            logSha256: digest(log),
        });
    }
});

test('native scope logs reject malformed, missing, duplicate and truncated plans', () => {
    const log = nativeLog(plan, { timestamp: false });
    for (const invalid of [
        log.replace('"version": 1', '"version": 99'),
        log.replace('"version": 1,', '"version": broken,'),
        log.slice(0, log.lastIndexOf('}')),
        log.slice(0, log.indexOf('\n{')),
        `${log}\n${JSON.stringify(plan, null, 2)}`,
        nativeLog({ ...plan, files: [changedFile, changedFile] }),
        nativeLog({ ...plan, packages: ['widget', 'widget'] }),
    ])
        assert.throws(() => parseNativeScopeLog(invalid, run, plan, inventory));
});

test('native PR scope keeps the original captured event base when live PR metadata advances', async () => {
    const advancedRun = {
        ...run,
        pull_requests: [{ number: 7, base: { sha: aheadSha }, head: { sha: aheadSha } }],
    };
    assert.equal(parseNativeScopeLog(nativeLog(), advancedRun, plan, inventory).baseSha, baseSha);
    const result = await nativeFixture({ sourceRun: advancedRun }).load();
    assert.deepEqual([...result.checks], ['backend:widget']);
});

test('native PR scope rejects missing, duplicated or inconsistent captured event bases', () => {
    const log = nativeLog(plan, { timestamp: false });
    for (const invalid of [
        log.replace(`  PR_BASE_SHA: ${baseSha}\n`, ''),
        `${log}\n  PR_BASE_SHA: ${baseSha}`,
        nativeLog(plan, { prBaseSha: aheadSha }),
    ])
        assert.throws(() => parseNativeScopeLog(invalid, run, plan, inventory), /captured PR base/u);
});

test('native PR recovery requires the checked workflow to bind the captured base to the event', async () => {
    const fixture = nativeFixture();
    const originalText = fixture.reader.text;
    fixture.reader.text = (ref, file) =>
        originalText(ref, file).replace(
            'PR_BASE_SHA: ${{ github.event.pull_request.base.sha',
            'UNBOUND_BASE: ${{ github.event.pull_request.base.sha',
        );
    await assert.rejects(fixture.load(), /Native PR base event binding/u);
});

test('native scope logs reject changed source, base, FULL and unproved larger scope', () => {
    for (const invalid of [
        nativeLog(plan, { checkoutSource: aheadSha }),
        nativeLog(plan, { baseSha: aheadSha }),
        nativeLog(plan, { full: true }),
        `${nativeLog(plan)}\n2026-10-13T12:00:01Z   BASE_SHA: ${baseSha}`,
        `${nativeLog(plan)}\n2026-10-13T12:00:01Z   FULL: false`,
        nativeLog({ ...plan, files: [...plan.files, 'packages/widget/src/unchecked.ts'] }),
    ])
        assert.throws(() => parseNativeScopeLog(invalid, run, plan, inventory));
    const mixedSources = `${nativeLog(plan, { timestamp: false })}\n[command]/usr/bin/git log -1 --format=%H\n${aheadSha}`;
    assert.throws(() => parseNativeScopeLog(mixedSources, run, plan, inventory));
});

test('every repeated native checkout observation must match the checked source', () => {
    const repeated = nativeLog() + '\n[command]/usr/bin/git log -1 --format=%H\n' + aheadSha;
    assert.throws(
        () => parseNativeScopeLog(repeated, run, plan, inventory),
        /Native checkout source mismatch/u,
    );
});

test('native coverage retains successful individual groups without converting failed CI to a source anchor', async () => {
    const fixture = nativeFixture();
    const result = await fixture.load();
    assert.deepEqual([...result.checks], ['backend:widget']);
    assert.equal(result.checks.has(`quality:${changedFile}`), false);
    assert.equal(result.anchor, undefined);
    assert.deepEqual(result.jobs.get('backend:widget'), [
        { id: 101, name: 'build affected packages' },
        { id: 102, name: 'affected unit tests (22.x)' },
    ]);
    assert.equal(result.provenance.evidenceKind, 'partial-native');
    assert.equal(result.provenance.sourceRunConclusion, 'failure');
    assert.equal(result.provenance.runAttempt, 1);
    assert.equal(result.provenance.scopeJobId, 100);
    assert.equal(result.provenance.scopeLogSha256, digest(fixture.state.log));
    assert.equal(result.provenance.baseSha, baseSha);
    assert.equal(result.provenance.sourceTree, sourceTree);
    assert.ok(fixture.endpoints.includes(`repos/${repository}/actions/runs/42/attempts/1/jobs?per_page=100`));
});

test('native coverage rejects inconsistent attempt, run, head, repository and source tree observations', async () => {
    for (const [key, value] of [
        ['id', 43],
        ['head_sha', aheadSha],
        ['run_attempt', 2],
        ['path', '.github/workflows/production_release.yml'],
        ['event', 'push'],
        ['status', 'in_progress'],
        ['conclusion', 'success'],
        ['repository', { id: 13, full_name: repository }],
        ['head_repository', { id: 13, full_name: repository }],
        ['repository', { id: 12, full_name: 'fork/repo' }],
        ['head_repository', { id: 12, full_name: 'fork/repo' }],
    ]) {
        const fixture = nativeFixture();
        fixture.state.attempt[key] = value;
        await assert.rejects(fixture.load(), undefined, key);
    }
    const remote = nativeFixture();
    remote.state.commit.tree.sha = baseTree;
    await assert.rejects(remote.load());
    const local = nativeFixture();
    local.state.localTree = baseTree;
    await assert.rejects(local.load());
});

test('native coverage requires the logged comparison base to remain a proved source ancestor', async () => {
    for (const comparison of [
        { status: 'diverged', base_commit: { sha: baseSha }, merge_base_commit: { sha: sourceSha } },
        { status: 'behind', base_commit: { sha: baseSha }, merge_base_commit: { sha: baseSha } },
        { status: 'ahead', base_commit: { sha: sourceSha }, merge_base_commit: { sha: baseSha } },
        { status: 'ahead', base_commit: { sha: baseSha }, merge_base_commit: { sha: sourceSha } },
    ]) {
        const fixture = nativeFixture();
        fixture.state.comparison = comparison;
        await assert.rejects(fixture.load(), undefined, JSON.stringify(comparison));
    }
});

test('merged PR scope remains usable only with the immutable base-to-source ancestor proof', async () => {
    const fixture = nativeFixture({ sourceRun: { ...run, pull_requests: [] } });
    assert.equal((await fixture.load()).checks.has('backend:widget'), true);
    fixture.state.comparison.merge_base_commit.sha = aheadSha;
    await assert.rejects(fixture.load());
});

test('native coverage rejects incomplete job lists and invalid detection observations', async () => {
    const incomplete = nativeFixture();
    incomplete.state.response.total_count++;
    await assert.rejects(incomplete.load());
    for (const patch of [
        { conclusion: 'failure' },
        { status: 'in_progress' },
        { run_id: 43 },
        { run_attempt: 2 },
        { head_sha: aheadSha },
        { id: 0 },
        { name: 'detect changes (unexpected)' },
    ]) {
        const fixture = nativeFixture();
        Object.assign(fixture.state.response.jobs[0], patch);
        await assert.rejects(fixture.load(), undefined, JSON.stringify(patch));
    }
    const duplicated = nativeFixture();
    duplicated.state.response.jobs.push({ ...duplicated.state.response.jobs[0], id: 999 });
    duplicated.state.response.total_count++;
    await assert.rejects(duplicated.load());
});

test('native coverage never credits absent, duplicated, failed or foreign-attempt business jobs', async () => {
    for (const patch of [
        { conclusion: 'failure' },
        { conclusion: 'cancelled' },
        { status: 'in_progress' },
        { run_id: 43 },
        { run_attempt: 2 },
        { head_sha: aheadSha },
        { id: 0 },
        { name: 'affected unit tests (20.x)' },
    ]) {
        const fixture = nativeFixture();
        Object.assign(fixture.state.response.jobs[2], patch);
        const result = await fixture.load();
        assert.equal(result.checks.has('backend:widget'), false, JSON.stringify(patch));
    }
    const absent = nativeFixture();
    absent.state.response.jobs.splice(2, 1);
    absent.state.response.total_count--;
    assert.equal((await absent.load()).checks.has('backend:widget'), false);
    const duplicated = nativeFixture();
    duplicated.state.response.jobs.push({ ...duplicated.state.response.jobs[2], id: 999 });
    duplicated.state.response.total_count++;
    assert.equal((await duplicated.load()).checks.has('backend:widget'), false);
});

test('native coverage requires every dashboard matrix shard before crediting the dashboard check', async () => {
    const options = {
        changed: 'packages/dashboard/src/example.ts',
        packages: [{ directory: 'dashboard', name: '@example/dashboard', scripts: { test: 'node --test' } }],
        extraJobs: [
            'dashboard i18n sync',
            'dashboard Storybook quality gate',
            'dashboard e2e (1)',
            'dashboard e2e (2)',
            'dashboard e2e (3)',
            'dashboard e2e (4)',
        ],
    };
    const complete = nativeFixture(options);
    assert.equal((await complete.load()).checks.has('dashboard'), true);
    const missing = nativeFixture(options);
    missing.state.response.jobs.pop();
    missing.state.response.total_count--;
    assert.equal((await missing.load()).checks.has('dashboard'), false);
});
