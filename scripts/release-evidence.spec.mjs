import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { packageCommands } from './ci-run.mjs';
import { coversChanges, findEvidence, hasTrustedPullRequest, isTrustedRun } from './release-evidence.mjs';

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
        hasTrustedPullRequest({ ...run, pull_requests: [] }, 'owner/repo', api('owner/repo', run.head_sha)),
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
