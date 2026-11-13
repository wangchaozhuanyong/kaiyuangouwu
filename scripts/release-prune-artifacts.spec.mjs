import assert from 'node:assert/strict';
import test from 'node:test';

import { activeArchiveKeys, applyReleasePruning, planReleasePruning } from './release-prune-artifacts.mjs';

const sha = revision => revision.toString(16).padStart(40, '0');
const runtimeDirectory = '/var/www/kaiyuangouwu-releases/';
const frontendDirectory = '/var/www/kaiyuangouwu-frontend-releases/';
const name = (revision, run = revision, attempt = 1, kind = 'runtime') =>
    (kind === 'runtime' ? '' : kind + '-') +
    `${sha(revision)}-${run}-${attempt}` +
    (kind === 'runtime' ? '-linux-x64' : '');
const archive = (revision, run, attempt, kind) =>
    `deployments/${sha(revision)}/${name(revision, run, attempt, kind)}.tar.gz`;
const row = (key, id = 'current', latest = true) => ({ Key: key, VersionId: id, Size: 42, IsLatest: latest });
const runtime = (revision, run, attempt) => {
    const key = archive(revision, run, attempt);
    return [row(key), row(key + '.sha256')];
};
const completion = 'require completed deployment and acceptance';
const runtimeJob = 'deploy the verified runtime / deploy verified runtime through AWS SSM';
const runtimeBuild = 'build immutable runtime / build verified linux/x64 runtime';
const frontendJob = 'deploy affected static apps / reuse and atomically deploy affected frontends';
const nginxJob =
    'publish only the reviewed Nginx configuration / validate and reload Nginx without stopping serving processes';
const successfulJob = ({ sha: headSha, runId }, job, runAttempt = 1) => ({
    head_sha: headSha,
    run_id: runId,
    run_attempt: runAttempt,
    workflow_name: 'Production Release',
    name: job,
    conclusion: 'success',
});
const accepted = (run, ...names) =>
    [completion, ...names, ...(names.includes(runtimeJob) ? [runtimeBuild] : [])].map(job =>
        successfulJob(run, job),
    );
const keys = rows => rows.map(({ Key }) => Key);

test('counts active runtime, independent frontends, 2FA and Nginx toward the seven revisions', () => {
    const frontend = frontendDirectory + name(2, 22, 3, 'frontends');
    const runtimeTarget = runtimeDirectory + name(1, 20, 1);
    const snapshot = {
        runtimeSha: sha(1),
        runtimeTarget,
        frontends: {
            storefront: { target: frontend + '/storefront', sourceSha: sha(2) },
            'next-admin': { target: runtimeTarget + '/packages/next-admin/dist', sourceSha: sha(1) },
            'two-factor': { target: frontend + '/storefront/.two-factor', sourceSha: sha(2) },
        },
        nginx: { sourceSha: sha(3), releaseId: name(3, 23, 1, 'nginx') },
    };
    assert.deepEqual(activeArchiveKeys(snapshot), [
        ...keys(runtime(1, 20)),
        archive(2, 22, 3, 'frontends'),
        archive(3, 23, 1, 'nginx'),
    ]);
    snapshot.frontends['two-factor'].sourceSha = sha(4);
    assert.throws(() => activeArchiveKeys(snapshot), /Unexpected release artifact key/u);
});

test('retains exactly seven distinct revisions and deletes hidden duplicates and older objects', () => {
    const oldKey = archive(2);
    const versions = Array.from({ length: 9 }, (_, index) => runtime(index + 1)).flat();
    versions.push(row(oldKey, 'old', false), row(archive(9), 'duplicate', false));
    const markers = [{ Key: oldKey, VersionId: 'superseded-marker', IsLatest: false }];
    const plan = planReleasePruning(
        { Versions: versions, DeleteMarkers: markers },
        keys(runtime(1)),
        attempt => accepted(attempt, runtimeJob),
    );
    assert.deepEqual(plan.revisions, [1, 9, 8, 7, 6, 5, 4].map(sha));
    assert.equal(plan.retained.length, 14);
    assert.deepEqual(
        plan.remove.filter(object => !object.IsLatest).map(object => object.VersionId),
        ['old', 'duplicate'],
    );
    assert.deepEqual(plan.markers, markers);
});

test('recognizes only accepted deployment jobs and keeps live artifacts across attempts for one revision', () => {
    const versions = [
        ...runtime(1, 10),
        row(archive(1, 12, 1, 'frontends')),
        row(archive(1, 12, 1, 'nginx')),
        ...runtime(2, 11),
        ...runtime(3, 13),
    ];
    const plan = planReleasePruning({ Versions: versions }, keys(runtime(1, 10)), attempt => {
        if (attempt.runId === 12)
            return accepted(attempt, 'release / ' + frontendJob, 'release / ' + nginxJob);
        if (attempt.runId === 11) return accepted(attempt, runtimeJob);
        if (attempt.runId === 13) return accepted({ ...attempt, sha: sha(4) }, runtimeJob);
        return accepted(attempt, runtimeJob);
    });
    assert.deepEqual(plan.revisions, [sha(1), sha(2)]);
    assert.deepEqual(keys(plan.remove), keys(runtime(3, 13)));
    assert.ok(keys(plan.retained).includes(archive(1, 12, 1, 'frontends')));
    assert.ok(keys(plan.retained).includes(archive(1, 12, 1, 'nginx')));
});

test('protects a live frontend from a partially successful deployment while pruning unreferenced artifacts', () => {
    const frontend = row(archive(2, 2, 1, 'frontends'));
    const failedNginx = row(archive(2, 2, 1, 'nginx'));
    const versions = [...runtime(1), frontend, failedNginx];
    const plan = planReleasePruning({ Versions: versions }, [...keys(runtime(1)), frontend.Key], attempt =>
        attempt.runId === 1 ? accepted(attempt, runtimeJob) : [successfulJob(attempt, frontendJob)],
    );
    assert.deepEqual(plan.remove, [failedNginx]);
    assert.ok(plan.retained.includes(frontend));
});

test('retains the original build after a successful deployment rerun and uses each frontend attempt', () => {
    const live = runtime(1);
    const oldBuild = runtime(2, 20, 1);
    const staleFrontend = row(archive(3, 30, 1, 'frontends'));
    const retriedFrontend = row(archive(3, 30, 2, 'frontends'));
    const versions = [...live, ...oldBuild, staleFrontend, retriedFrontend];
    const plan = planReleasePruning({ Versions: versions }, keys(live), run => {
        if (run.runId === 20) {
            return [
                successfulJob(run, runtimeBuild),
                successfulJob(run, runtimeJob, 2),
                successfulJob(run, completion, 2),
            ];
        }
        if (run.runId === 30) {
            return [
                { ...successfulJob(run, frontendJob), conclusion: 'failure' },
                successfulJob(run, frontendJob, 2),
                successfulJob(run, completion, 2),
            ];
        }
        return accepted(run, runtimeJob);
    });
    assert.deepEqual(plan.remove, [staleFrontend]);
    assert.deepEqual(plan.retained, [...live, retriedFrontend, ...oldBuild]);
});

test('fails closed on partial inventory, missing or hidden accepted artifacts, and out-of-scope data', () => {
    const live = runtime(1);
    const plan = inventory =>
        planReleasePruning(inventory, keys(live), attempt => accepted(attempt, runtimeJob));
    const liveOnly = { Versions: live };
    assert.throws(() => plan({ ...liveOnly, NextToken: 'another-page' }), /Complete S3 version/u);
    assert.throws(() => plan({ Versions: [] }), /Active release artifact unavailable/u);
    assert.throws(
        () => plan({ Versions: [...live, row('mysql/database-backup')] }),
        /Unexpected release artifact key/u,
    );
    const [missingArchive, checksum] = runtime(2);
    assert.throws(
        () =>
            plan({
                Versions: [...live, { ...missingArchive, IsLatest: false }, checksum],
                DeleteMarkers: [{ Key: missingArchive.Key, VersionId: 'marker', IsLatest: true }],
            }),
        /Accepted release artifact unavailable/u,
    );
});

test('purges exact data version IDs before markers and verifies the remaining inventory', () => {
    const live = runtime(1);
    const old = row(archive(2), 'old', false);
    const marker = { Key: old.Key, VersionId: 'marker', IsLatest: true };
    const plan = { retained: live, remove: [old], markers: [marker] };
    const calls = [];
    applyReleasePruning(
        plan,
        () => {
            calls.push('list');
            return { Versions: live, DeleteMarkers: calls.length === 2 ? [marker] : [] };
        },
        objects => {
            calls.push(objects);
            return { Deleted: objects };
        },
    );
    assert.deepEqual(calls, [
        [{ Key: old.Key, VersionId: 'old' }],
        'list',
        [{ Key: old.Key, VersionId: 'marker' }],
        'list',
    ]);
    assert.throws(
        () =>
            applyReleasePruning(
                plan,
                () => ({ Versions: [...live, old] }),
                objects => ({ Deleted: objects }),
            ),
        /Unexpected billable versions/u,
    );
    assert.throws(
        () =>
            applyReleasePruning(
                plan,
                () => assert.fail(),
                () => ({ Errors: [{ Code: 'AccessDenied' }] }),
            ),
        /S3 rejected/u,
    );
});
