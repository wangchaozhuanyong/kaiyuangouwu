import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { productionSsmInstanceId } from '../deploy/frontend-ssm.mjs';

const bucket = 'yunqiao-vendure-prod-backup-098208446664-apne1';
const owner = '098208446664';
const region = 'ap-northeast-1';
const prefix = 'deployments/';
const limit = 7;
const deleteBatchSize = 250;
const shaPattern = /^[a-f0-9]{40}$/u;
const artifactPattern =
    /^deployments\/([a-f0-9]{40})\/(frontends-|nginx-)?([a-f0-9]{40})-([1-9][0-9]*)-([1-9][0-9]*)(-linux-x64)?\.tar\.gz(\.sha256)?$/u;
const components = ['storefront', 'next-admin', 'two-factor'];
const releaseWorkflows = new Set(['Production Release', 'Deploy Storefront Fast Lane']);
const completionJob = 'require completed deployment and acceptance';
const runtimeBuildJob = 'build immutable runtime / build verified linux/x64 runtime';
const deploymentJobs = {
    runtime: 'deploy the verified runtime / deploy verified runtime through AWS SSM',
    frontends: 'deploy affected static apps / reuse and atomically deploy affected frontends',
    nginx: 'publish only the reviewed Nginx configuration / validate and reload Nginx without stopping serving processes',
};

function parseArtifact(key) {
    const match = artifactPattern.exec(key);
    assert.ok(match && match[1] === match[3], `Unexpected release artifact key: ${key}`);
    const [, sha, frontendOrNginx, , run, attempt, linux, checksum] = match;
    const kind = frontendOrNginx ? frontendOrNginx.slice(0, -1) : 'runtime';
    assert.equal(Boolean(linux), kind === 'runtime', `Unexpected release artifact platform: ${key}`);
    assert.ok(!checksum || kind === 'runtime', `Unexpected release artifact checksum: ${key}`);
    const runId = Number(run);
    const runAttempt = Number(attempt);
    assert.ok(Number.isSafeInteger(runId) && Number.isSafeInteger(runAttempt), 'Invalid release attempt');
    return { sha, kind, runId, runAttempt };
}

function archiveKeys({ sha, runId, runAttempt }, kind) {
    const stem = kind === 'runtime' ? '' : kind + '-';
    const platform = kind === 'runtime' ? '-linux-x64' : '';
    const key = `${prefix}${sha}/${stem}${sha}-${runId}-${runAttempt}${platform}.tar.gz`;
    return kind === 'runtime' ? [key, key + '.sha256'] : [key];
}

export function activeArchiveKeys(snapshot) {
    assert.match(snapshot.runtimeSha, shaPattern);
    const keys = new Set();
    function pin(target, sha, suffix, directory, kind) {
        assert.match(sha, shaPattern);
        assert.ok(
            target.startsWith(directory) && target.endsWith(suffix),
            `Unrecognized active path: ${target}`,
        );
        const name = target.slice(directory.length, target.length - suffix.length);
        const artifact = parseArtifact(`${prefix}${sha}/${name}.tar.gz`);
        assert.equal(artifact.kind, kind);
        for (const key of archiveKeys(artifact, artifact.kind)) keys.add(key);
    }
    const runtimeRoot = '/var/www/kaiyuangouwu-releases/';
    const frontendRoot = '/var/www/kaiyuangouwu-frontend-releases/';
    pin(snapshot.runtimeTarget, snapshot.runtimeSha, '', runtimeRoot, 'runtime');
    for (const component of components) {
        const { target, sourceSha } = snapshot.frontends[component];
        if (target.startsWith(runtimeRoot)) {
            const suffix =
                component === 'two-factor'
                    ? '/packages/storefront/dist-two-factor'
                    : `/packages/${component}/dist`;
            pin(target, sourceSha, suffix, runtimeRoot, 'runtime');
        } else {
            const suffix = component === 'two-factor' ? '/storefront/.two-factor' : '/' + component;
            pin(target, sourceSha, suffix, frontendRoot, 'frontends');
        }
    }
    if (snapshot.nginx) {
        const { sourceSha, releaseId } = snapshot.nginx;
        const key = `${prefix}${sourceSha}/${releaseId}.tar.gz`;
        assert.equal(parseArtifact(key).kind, 'nginx');
        keys.add(key);
    }
    return [...keys];
}

const identity = ({ Key, VersionId }) => JSON.stringify([Key, VersionId]);

function versionInventory(inventory) {
    assert.ok(
        inventory &&
            !inventory.IsTruncated &&
            !inventory.NextToken &&
            !inventory.NextKeyMarker &&
            !inventory.NextVersionIdMarker,
        'Complete S3 version inventory is required',
    );
    assert.ok(!inventory.Prefix || inventory.Prefix === prefix, 'Unexpected S3 inventory prefix');
    const versions = inventory.Versions ?? [];
    const markers = inventory.DeleteMarkers ?? [];
    const current = new Map();
    const ids = new Set();
    const latest = new Set();
    for (const row of [...versions, ...markers]) {
        parseArtifact(row.Key);
        assert.ok(
            typeof row.VersionId === 'string' && row.VersionId && row.VersionId !== 'null',
            'S3 version ID required',
        );
        assert.ok(!ids.has(identity(row)), 'Duplicate S3 version');
        ids.add(identity(row));
        assert.equal(typeof row.IsLatest, 'boolean');
        if (row.IsLatest) {
            assert.ok(!latest.has(row.Key), `Multiple current versions of ${row.Key}`);
            latest.add(row.Key);
        }
    }
    for (const row of versions) {
        assert.ok(Number.isSafeInteger(row.Size) && row.Size > 0, `Invalid release object size: ${row.Key}`);
        if (row.IsLatest) current.set(row.Key, row);
    }
    return { versions, markers, current };
}

function acceptedKeys({ sha, runId }, jobs) {
    const releaseJobs = jobs
        .filter(
            job => job.head_sha === sha && job.run_id === runId && releaseWorkflows.has(job.workflow_name),
        )
        .sort((left, right) => right.run_attempt - left.run_attempt);
    const named = (job, expected) => job.name === expected || job.name.endsWith(' / ' + expected);
    const completion = releaseJobs.find(job => named(job, completionJob) && job.conclusion === 'success');
    if (!completion) return [];

    const keys = [];
    for (const [kind, name] of Object.entries(deploymentJobs)) {
        const deployment = releaseJobs.find(
            job => job.run_attempt <= completion.run_attempt && named(job, name),
        );
        if (deployment?.conclusion !== 'success') continue;
        // A failed-jobs rerun can deploy an archive from the original successful build.
        const build =
            kind === 'runtime'
                ? releaseJobs.find(
                      job => job.run_attempt <= deployment.run_attempt && named(job, runtimeBuildJob),
                  )
                : deployment;
        assert.equal(build?.conclusion, 'success', 'Accepted deployment has no verified build');
        keys.push(...archiveKeys({ sha, runId, runAttempt: build.run_attempt }, kind));
    }
    return keys;
}

export function planReleasePruning(inventory, activeKeys, readRunJobs) {
    const { versions, markers, current } = versionInventory(inventory);
    const keep = new Set(activeKeys);
    const revisions = new Set(activeKeys.map(key => parseArtifact(key).sha));
    assert.ok(
        revisions.size > 0 && revisions.size <= limit,
        'Expected one to seven active production revisions',
    );
    for (const key of keep) assert.ok(current.has(key), `Active release artifact unavailable: ${key}`);

    const releases = new Map();
    for (const { Key } of [...versions, ...markers]) {
        const { sha, runId } = parseArtifact(Key);
        releases.set(`${sha}/${runId}`, { sha, runId });
    }
    const ordered = [...releases.values()].sort((a, b) => b.runId - a.runId);
    const accepted = new Set();
    for (const release of ordered) {
        if (accepted.has(release.sha) || (revisions.size === limit && !revisions.has(release.sha))) continue;
        const keys = acceptedKeys(release, readRunJobs(release));
        if (!keys.length) continue;
        for (const key of keys) {
            assert.ok(current.has(key), `Accepted release artifact unavailable: ${key}`);
            keep.add(key);
        }
        revisions.add(release.sha);
        accepted.add(release.sha);
    }
    return {
        revisions: [...revisions],
        retained: [...keep].map(key => current.get(key)),
        remove: versions.filter(row => !row.IsLatest || !keep.has(row.Key)),
        markers,
    };
}

function assertRetained(inventory, retained) {
    const { versions, current } = versionInventory(inventory);
    const expected = new Set(retained.map(identity));
    assert.equal(versions.length, retained.length, 'Unexpected billable versions after pruning');
    assert.equal(current.size, retained.length, 'Expected every retained object to be current');
    assert.ok(
        versions.every(row => expected.has(identity(row))),
        'Retained version IDs changed',
    );
}

export function applyReleasePruning(plan, list, remove) {
    function batches(rows) {
        for (let offset = 0; offset < rows.length; offset += deleteBatchSize) {
            const objects = rows
                .slice(offset, offset + deleteBatchSize)
                .map(({ Key, VersionId }) => ({ Key, VersionId }));
            const expected = new Set(objects.map(identity));
            const result = remove(objects);
            assert.ok(!result.Errors?.length, 'S3 rejected one or more exact version deletions');
            assert.equal(result.Deleted?.length, objects.length, 'Incomplete S3 deletion acknowledgment');
            for (const row of result.Deleted)
                assert.ok(expected.delete(identity(row)), 'Unexpected S3 deletion acknowledgment');
        }
    }
    batches(plan.remove);
    if (plan.markers.length) {
        // Removing markers first could make a hidden archive visible again.
        const inventory = list();
        assertRetained(inventory, plan.retained);
        batches(plan.markers);
    }
    const final = list();
    assertRetained(final, plan.retained);
    assert.ok(!final.DeleteMarkers?.length, 'Unexpected delete markers after pruning');
}

const hostSnapshotCommand = String.raw`
set -eu
exec 9< /run/lock/vendure-production-deploy.lock
flock -s -w 15 9
/usr/bin/node --input-type=commonjs <<'VENDURE_RELEASE_REFS'
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, realpathSync } = require('node:fs');
const root = '/var/www/kaiyuangouwu';
const runtimeSha = readFileSync(root + '-releases/current-sha', 'utf8').trim();
assert.match(runtimeSha, /^[a-f0-9]{40}$/u);
const runtimeTarget = realpathSync(root + '-current');
const frontends = {};
for (const component of ['storefront', 'next-admin', 'two-factor']) {
    const target = realpathSync(root + '-' + component + '-current');
    const path = target + '/frontend-release.json';
    const sourceSha = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).sourceSha : runtimeSha;
    frontends[component] = { target, sourceSha };
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const liveHash = hash(readFileSync('/etc/nginx/sites-available/damatong-production'));
const runtimeConfig = execFileSync('sudo', ['-n', '-H', '-u', 'ubuntu', 'git', '-C', root, 'show', runtimeSha + ':deploy/nginx/damatong.conf']);
let nginx;
if (liveHash !== hash(runtimeConfig)) {
    const { sourceSha, configSha256, result, releaseId } = JSON.parse(
        readFileSync(root + '-nginx-releases/current.json', 'utf8'),
    );
    assert.equal(result, 'PASS');
    assert.equal(configSha256, liveHash);
    nginx = { sourceSha, releaseId };
}
console.log(JSON.stringify({ runtimeSha, runtimeTarget, frontends, nginx }));
VENDURE_RELEASE_REFS
`;

function aws(args, timeout = 40_000) {
    const response = execFileSync(
        'aws',
        [
            ...args,
            '--region',
            region,
            '--no-cli-pager',
            '--output',
            'json',
            '--cli-connect-timeout',
            '8',
            '--cli-read-timeout',
            '25',
        ],
        { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 },
    );
    return response ? JSON.parse(response) : undefined;
}

function inspectHost() {
    const instanceId = productionSsmInstanceId;
    const submitted = aws([
        'ssm',
        'send-command',
        '--document-name',
        'AWS-RunShellScript',
        '--instance-ids',
        instanceId,
        '--comment',
        'Read live Vendure release artifact references',
        '--timeout-seconds',
        '45',
        '--parameters',
        JSON.stringify({ commands: [hostSnapshotCommand], executionTimeout: ['40'] }),
    ]);
    const commandId = submitted.Command.CommandId;
    assert.match(commandId, /^[a-f0-9-]{36}$/u);
    const invocation = ['--command-id', commandId, '--instance-id', instanceId];
    aws(['ssm', 'wait', 'command-executed', ...invocation], 105_000);
    const result = aws(['ssm', 'get-command-invocation', ...invocation]);
    assert.equal(result.Status, 'Success', `Could not verify active release references: ${commandId}`);
    // A canceled Actions run can leave a submitted deployment command in SSM.
    for (const status of ['Pending', 'InProgress', 'Delayed']) {
        const pending = aws([
            'ssm',
            'list-command-invocations',
            '--instance-id',
            instanceId,
            '--filters',
            `key=Status,value=${status}`,
            '--query',
            'CommandInvocations[].Comment',
        ]);
        assert.ok(Array.isArray(pending), 'Incomplete SSM deployment inventory');
        assert.ok(
            !pending.some(comment =>
                /^(GitHub production deploy |Frontend release |Nginx release )/u.test(comment),
            ),
            'A production release command is still active',
        );
    }
    const snapshot = JSON.parse(result.StandardOutputContent);
    activeArchiveKeys(snapshot);
    process.stdout.write(JSON.stringify(snapshot) + '\n');
}

function main() {
    const [mode, referencesFile] = process.argv.slice(2);
    if (mode === 'inspect-host') return inspectHost();
    assert.ok(
        ['plan', 'apply'].includes(mode) && referencesFile,
        'Use inspect-host, plan <references.json>, or apply <references.json>',
    );
    assert.equal(process.env.GITHUB_REPOSITORY, 'wangchaozhuanyong/kaiyuangouwu');
    if (mode === 'apply') assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
    const active = activeArchiveKeys(JSON.parse(readFileSync(referencesFile, 'utf8')));
    const scope = ['--bucket', bucket, '--expected-bucket-owner', owner];
    const list = () => aws(['s3api', 'list-object-versions', ...scope, '--prefix', prefix]);
    const readRunJobs = ({ runId }) => {
        const path = `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}/jobs?filter=all&per_page=100`;
        const { total_count: count, jobs } = JSON.parse(
            execFileSync('gh', ['api', path], {
                encoding: 'utf8',
                timeout: 25_000,
                maxBuffer: 2 * 1024 * 1024,
            }),
        );
        assert.equal(jobs.length, count, 'Incomplete release job evidence');
        assert.ok(
            jobs.every(job => Number.isSafeInteger(job.run_attempt) && job.run_attempt > 0),
            'Invalid release job attempt',
        );
        return jobs;
    };
    const plan = planReleasePruning(list(), active, readRunJobs);
    if (mode === 'apply') {
        applyReleasePruning(plan, list, objects =>
            aws([
                's3api',
                'delete-objects',
                ...scope,
                '--delete',
                JSON.stringify({ Objects: objects, Quiet: false }),
            ]),
        );
    }
    const bytes = plan.remove.reduce((total, row) => total + row.Size, 0);
    const summary =
        `Release artifact retention (${mode}): ${plan.revisions.length}/${limit} revisions, ` +
        `${plan.retained.length} current files, ${plan.remove.length} object versions, ${plan.markers.length} delete markers, ${bytes} bytes ` +
        (mode === 'apply' ? 'removed and verified.' : 'selected for removal.');
    process.stdout.write(summary + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
