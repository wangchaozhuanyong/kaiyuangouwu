import yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { earlierReleases, readReleaseRuns, staleTargetRejected } from './release-lock.mjs';

const target = 'a'.repeat(40);
const other = 'b'.repeat(40);
const run = {
    id: 1,
    head_sha: target,
    status: 'completed',
    conclusion: 'failure',
    path: '.github/workflows/production_release.yml',
};
const lock = {
    id: 2,
    head_sha: target,
    name: 'lock exact revision and reject duplicate full runs',
    conclusion: 'failure',
};
const log = `2026-10-16T09:02:35.000Z   TARGET_SHA: ${other}\n2026-10-16T09:02:35.001Z target_sha is not current main; start a new release for ${target}\n`;
test('a stale requested target is distinguished from the dispatch workflow head', () => {
    assert.equal(staleTargetRejected(run, [lock], log, target), true);
    assert.deepEqual(
        earlierReleases([run, { ...run, id: 9 }, { ...run, id: 2, head_sha: other }], target, 5),
        [run],
    );
});
test('same-target failures, active runs and missing or ambiguous native evidence stay blocked', () => {
    assert.equal(staleTargetRejected(run, [lock], log.replace(other, target), target), false);
    assert.equal(staleTargetRejected({ ...run, status: 'in_progress' }, [lock], log, target), false);
    assert.equal(staleTargetRejected(run, [], log, target), false);
    assert.equal(staleTargetRejected(run, [lock, lock], log, target), false);
    assert.equal(staleTargetRejected(run, [{ ...lock, head_sha: other }], log, target), false);
    assert.equal(staleTargetRejected(run, [lock], log + log, target), false);
    assert.equal(
        staleTargetRejected(
            run,
            [lock],
            log.replace('target_sha is not current main', 'deployment failed'),
            target,
        ),
        false,
    );
});

test('the full 100-run duplicate window is projected before buffering a large native response', () => {
    const runs = Array.from({ length: 100 }, (_, index) => ({
        ...run,
        id: index + 1,
        html_url: `https://github.com/owner/repo/actions/runs/${index + 1}`,
        head_commit: { message: 'unneeded native commit metadata '.repeat(500) },
    }));
    const nativeResponse = JSON.stringify({ total_count: 2310, workflow_runs: runs });
    assert.ok(Buffer.byteLength(nativeResponse) > 1024 * 1024);
    const result = readReleaseRuns('repos/owner/repo', (program, args, options) => {
        assert.equal(program, 'gh');
        assert.equal(args[1], 'repos/owner/repo/actions/runs?branch=main&per_page=100');
        assert.equal(args[2], '--jq');
        assert.equal(options.timeout, 30_000);
        assert.equal(options.maxBuffer, 1024 * 1024);
        // Apply the actual jq expression used by gh, retaining all 100 records.
        return execFileSync('jq', [args[3]], {
            ...options,
            stdio: ['pipe', 'pipe', 'pipe'],
            input: nativeResponse,
        });
    });
    assert.equal(result.length, 100);
    assert.equal(earlierReleases(result, target, 101).length, 100);
    assert.deepEqual(Object.keys(result[0]), ['id', 'head_sha', 'path', 'status', 'conclusion', 'html_url']);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 64 * 1024);
});

test('failed or invalid bounded native reads refuse without exposing captured response contents', () => {
    assert.throws(
        () =>
            readReleaseRuns('repos/owner/repo', () => {
                throw new Error('private captured response');
            }),
        error =>
            error.message === 'Unable to read bounded release evidence; inspect this run before retrying.' &&
            !JSON.stringify(error).includes('private captured response'),
    );
    assert.throws(
        () => readReleaseRuns('repos/owner/repo', () => 'private invalid response'),
        /Invalid projected release run inventory/u,
    );
});

test('checkout cannot duplicate the native requested-target declaration', () => {
    const workflow = yaml.load(
        readFileSync(new URL('../.github/workflows/production_release.yml', import.meta.url), 'utf8'),
    );
    const lockJob = workflow.jobs.lock;
    const declarations = lockJob.steps.flatMap(step => {
        const env = { ...workflow.env, ...lockJob.env, ...step.env };
        return env.TARGET_SHA ? [`2026-10-16T09:02:35.000Z   TARGET_SHA: ${other}\n`] : [];
    });
    const rejection = `2026-10-16T09:02:35.001Z target_sha is not current main; start a new release for ${target}\n`;
    assert.equal(declarations.length, 1, 'Only the script step needs the requested release target');
    assert.equal(staleTargetRejected(run, [lock], declarations.join('') + rejection, target), true);
    assert.equal(
        staleTargetRejected(run, [lock], declarations.join('') + declarations[0] + rejection, target),
        false,
        'Repeated native declarations remain unverified',
    );
    assert.equal(
        staleTargetRejected(
            run,
            [lock],
            declarations.join('') + declarations[0].replace(other, target) + rejection,
            target,
        ),
        false,
        'Conflicting native declarations remain unverified',
    );
});
