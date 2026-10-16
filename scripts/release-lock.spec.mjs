import assert from 'node:assert/strict';
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

test('history transport projects large native API records before buffering and keeps all lock fields', () => {
    const rows = [
        {
            id: 12,
            head_sha: target,
            path: run.path,
            status: 'completed',
            conclusion: 'failure',
            html_url: 'https://example.invalid/run/12',
        },
    ];
    const execute = (command, args, options) => {
        assert.equal(command, 'gh');
        assert.match(args[1], /per_page=100$/u);
        assert.equal(args[2], '--jq');
        for (const field of Object.keys(rows[0])) assert.ok(args[3].includes(field));
        assert.equal(options.maxBuffer, 4 * 1024 * 1024);
        return JSON.stringify({ workflow_runs: rows });
    };
    assert.deepEqual(readReleaseRuns('owner/repo', execute), rows);
});
