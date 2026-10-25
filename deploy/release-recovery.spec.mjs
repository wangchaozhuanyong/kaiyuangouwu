import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { classifyChanges } from '../scripts/ci-impact.mjs';

import {
    classifyFailure,
    lockedArchives,
    matchingInstallSources,
    recoverRelease,
    verifyRegistryArchive,
} from './release-recovery.mjs';
import { selectReleaseRoute } from './release-route.mjs';

const deploymentScript = readFileSync(new URL('./deploy-production-from-s3.sh', import.meta.url), 'utf8');
const shellFunction = name => {
    const start = deploymentScript.indexOf(`${name}() {`);
    assert.ok(start >= 0);
    return deploymentScript.slice(start, deploymentScript.indexOf('\n}', start) + 2);
};

test('the frozen migration backup is reverified without readonly assignment or accepting another snapshot', () => {
    const fixture = `
set -Eeuo pipefail
invocation=c7b78f2cb12a4295bdd1c7387c326c1f
snapshot=/var/backups/vendure-mysql/vendure-20261003T101136Z.sql.gz
checksum_ok=1
sudo() {
    shift
    case "$1" in
        systemctl) if [[ "$*" == *Result* ]]; then printf 'success'; else printf '%s' "$invocation"; fi ;;
        journalctl) printf 'Created verified MySQL backup: %s offsite=yes encrypted=yes\\n' "$snapshot" ;;
        test) return 0 ;;
        /usr/local/sbin/vendure-mysql-backup-manifest.py|jq) printf '2' ;;
        /bin/bash) [[ "$checksum_ok" == 1 ]] ;;
        stat) printf '100' ;;
        *) return 1 ;;
    esac
}
date() { printf '120'; }
${shellFunction('load_verified_backup')}
backup_file=""; backup_invocation_id=""; backup_age_seconds=""
load_verified_backup
readonly backup_file backup_invocation_id backup_age_seconds
load_verified_backup verify
[[ "$backup_age_seconds" == 20 ]]
invocation=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
if load_verified_backup verify; then exit 21; fi
invocation=c7b78f2cb12a4295bdd1c7387c326c1f
snapshot=/var/backups/vendure-mysql/vendure-20261003T121136Z.sql.gz
if load_verified_backup verify; then exit 22; fi
snapshot=/var/backups/vendure-mysql/vendure-20261003T101136Z.sql.gz
checksum_ok=0
if load_verified_backup verify; then exit 23; fi
printf 'FROZEN_BACKUP_REVERIFIED\\n'
`;
    const result = spawnSync('bash', ['-c', fixture], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'FROZEN_BACKUP_REVERIFIED\n');
    assert.match(deploymentScript, /load_verified_backup verify \|\| fail/u);
});

test('fatal shell errors still enter guarded recovery after writers were paused', () => {
    for (const flags of [
        'rollback_needed=1; worker_paused_early=0',
        'rollback_needed=0; worker_paused_early=1',
    ]) {
        const result = spawnSync(
            'bash',
            [
                '-c',
                `
set -Eeuo pipefail
${flags}
cleanup() { printf 'CLEANUP\\n'; }
rollback() { printf 'GUARDED_RECOVERY status=%s\\n' "$1"; exit "$1"; }
${shellFunction('handle_deploy_exit')}
trap handle_deploy_exit EXIT
readonly proof=frozen
proof=changed
`,
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 1);
        assert.match(result.stderr, /readonly variable/u);
        assert.equal(result.stdout, 'GUARDED_RECOVERY status=1\n');
    }
    const success = spawnSync(
        'bash',
        [
            '-c',
            `
set -Eeuo pipefail
rollback_needed=0; worker_paused_early=0
cleanup() { printf 'CLEANUP\\n'; }
rollback() { exit 99; }
${shellFunction('handle_deploy_exit')}
trap handle_deploy_exit EXIT
true
`,
        ],
        { encoding: 'utf8' },
    );
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stdout, 'CLEANUP\n');
});

test('only a proven infrastructure fault permits one retry', () => {
    assert.equal(classifyFailure('ECONNRESET downloading artifact', 1).retryAllowed, true);
    assert.equal(classifyFailure('ECONNRESET downloading artifact', 2).retryAllowed, false);
    for (const logs of [
        'TS2345: invalid type',
        'HTTP 503 then AssertionError',
        'AccessDenied',
        '',
        'checksum mismatch',
        'migration failed',
    ])
        assert.equal(classifyFailure(logs).retryAllowed, false);
});
const old = 'a'.repeat(40);
const target = 'b'.repeat(40);
test('an active client still updates the Admin preview when its pointer is older', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css']);
    const route = selectReleaseRoute({
        plan,
        baseSha: old,
        targetSha: target,
        storefrontSha: target,
        adminSha: old,
        changedSince: (_source, _target, component) => component === 'next-admin',
    });
    assert.equal(route.lane, 'frontend');
    assert.deepEqual(route.components, ['next-admin']);
});
test('cumulative backend changes and explicit managed writes cannot use a static release', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/core/src/order.ts']);
    assert.equal(
        selectReleaseRoute({ plan, baseSha: old, targetSha: target, storefrontSha: old, adminSha: old }).lane,
        'runtime',
    );
    assert.equal(
        selectReleaseRoute({
            plan: classifyChanges(['packages/storefront/src/index.css']),
            baseSha: old,
            targetSha: target,
            storefrontSha: old,
            adminSha: old,
            managed: true,
        }).lane,
        'runtime',
    );
});
test('independent admin release requires bootstrap and includes both changed frontends', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/next-admin/src/index.css']);
    const input = {
        plan,
        baseSha: old,
        targetSha: target,
        storefrontSha: old,
        adminSha: old,
        changedSince: () => true,
    };
    assert.equal(selectReleaseRoute({ ...input, adminSha: 'unknown' }).lane, 'runtime');
    assert.deepEqual(selectReleaseRoute(input).components, ['next-admin', 'storefront']);
});

test('a later storefront release does not redeploy an unchanged active admin', () => {
    const plan = classifyChanges(['packages/storefront/src/index.css', 'packages/next-admin/src/index.css']);
    const route = selectReleaseRoute({
        plan,
        baseSha: old,
        targetSha: target,
        storefrontSha: old,
        adminSha: 'c'.repeat(40),
        changedSince: (_source, _target, component) => component === 'storefront',
    });
    assert.equal(route.lane, 'frontend');
    assert.deepEqual(route.components, ['storefront']);
});

test('an active backend with drifted frontend pointers cannot trigger an empty-diff release loop', () => {
    const input = {
        plan: classifyChanges([]),
        baseSha: target,
        targetSha: target,
        storefrontSha: target,
        adminSha: target,
    };
    assert.equal(selectReleaseRoute(input).lane, 'none');
    assert.throws(() => selectReleaseRoute({ ...input, adminSha: old }), /Frontend version drift/u);
});

function packageArchive(name, version) {
    const contents = Buffer.from(JSON.stringify({ name, version }));
    const header = Buffer.alloc(512);
    header.write('package/package.json');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${contents.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    return gzipSync(
        Buffer.concat([
            header,
            contents,
            Buffer.alloc((512 - (contents.length % 512)) % 512),
            Buffer.alloc(1024),
        ]),
    );
}

function archiveFixture() {
    const repository = 'example/project';
    const source = 'b'.repeat(40);
    const peerSource = 'c'.repeat(40);
    const run = {
        id: 10,
        head_sha: source,
        run_attempt: 1,
        status: 'completed',
        conclusion: 'failure',
        event: 'workflow_dispatch',
        head_repository: { full_name: repository },
        path: '.github/workflows/production_release.yml',
    };
    const peerRun = {
        id: 20,
        head_sha: peerSource,
        status: 'completed',
        conclusion: 'success',
        event: 'workflow_dispatch',
        head_repository: { full_name: repository },
        path: '.github/workflows/build_and_test.yml',
    };
    const setup = conclusion => ({
        name: 'Run ./.github/actions/setup',
        number: 3,
        status: 'completed',
        conclusion,
    });
    const job = {
        id: 101,
        run_id: 10,
        head_sha: source,
        status: 'completed',
        name: 'validate missing checks once / affected unit tests (22.x)',
        conclusion: 'failure',
        steps: [
            setup('failure'),
            { name: 'Unit tests', number: 4, status: 'completed', conclusion: 'skipped' },
        ],
    };
    const peerJob = {
        id: 201,
        run_id: 20,
        head_sha: peerSource,
        status: 'completed',
        name: 'affected unit tests (22.x)',
        conclusion: 'success',
        steps: [setup('success')],
    };
    const log = (conclusion, errors = '') => `##[group]Operating System
Ubuntu
24.04.5
##[endgroup]
##[group]Runner Image
Image: ubuntu-24.04
Version: 20261004.327.1
##[endgroup]
##[group]Run ./.github/actions/setup
Found in cache @ /opt/hostedtoolcache/node/22.23.3/x64
node: v22.23.3
##[group]Run bun install --frozen-lockfile --linker=hoisted
bun install --frozen-lockfile --linker=hoisted
bun install v1.3.14 (0d9b296a)
${errors}##[end-action id=__self.__run;outcome=${conclusion};conclusion=${conclusion};duration_ms=100]
`;
    const logs = new Map([
        [
            101,
            log(
                'failure',
                'error: Integrity check failed for tarball: @tanstack/router-core\nerror: Fail extracting tarball for "@img/sharp-libvips-linux-x64"\n',
            ),
        ],
        [201, log('success')],
    ]);
    const archives = [
        ['@tanstack/router-core', '1.168.1'],
        ['@tanstack/router-core', '1.171.25'],
        ['@img/sharp-libvips-linux-x64', '1.3.4'],
    ].map(([name, version]) => {
        const bytes = packageArchive(name, version);
        const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
        const url = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
        return {
            name,
            version,
            integrity,
            bytes,
            metadata: {
                name,
                version,
                dist: { integrity, shasum: createHash('sha1').update(bytes).digest('hex'), tarball: url },
            },
        };
    });
    let lockfile = archives
        .map(
            item =>
                `"${item.name}/${item.version}": ["${item.name}@${item.version}", "", {}, "${item.integrity}"],`,
        )
        .join('\n');
    const reader = {
        entries: ref => [
            { path: 'package.json', metadata: 'manifest' },
            { path: 'bun.lock', metadata: 'lock' },
            { path: '.github/actions/setup/action.yml', metadata: 'recipe' },
            { path: 'deploy/release-recovery.mjs', metadata: ref },
            { path: 'deploy/release-recovery.spec.mjs', metadata: ref },
        ],
        text: (_ref, path) =>
            path === 'bun.lock'
                ? lockfile
                : path.startsWith('.github/workflows/')
                  ? readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
                  : '{"workspaces":["packages/*"]}',
    };
    let mainSha = source;
    let totalCount;
    let freshRun;
    const jobs = [job];
    const api = endpoint => {
        if (endpoint.endsWith('/git/ref/heads/main')) return { object: { sha: mainSha } };
        if (endpoint.endsWith('/actions/runs/10')) return freshRun ?? run;
        if (endpoint.includes('/actions/runs/10/jobs'))
            return { total_count: totalCount ?? jobs.length, jobs };
        if (endpoint.includes('/actions/runs/20/jobs')) return { total_count: 1, jobs: [peerJob] };
        if (endpoint.includes('/actions/workflows/build_and_test.yml/runs'))
            return { workflow_runs: [peerRun] };
        assert.fail(`Unexpected native API ${endpoint}`);
    };
    const downloaded = [];
    const reruns = [];
    const dependencies = {
        api,
        reader,
        logReader: (_repo, id) => {
            assert.ok(logs.has(id));
            return logs.get(id);
        },
        download: async url => {
            downloaded.push(url);
            const item = archives.find(
                value =>
                    url === value.metadata.dist.tarball ||
                    url === `https://registry.npmjs.org/${encodeURIComponent(value.name)}/${value.version}`,
            );
            assert.ok(item);
            return url.endsWith('.tgz') ? item.bytes : Buffer.from(JSON.stringify(item.metadata));
        },
        rerun: id => reruns.push(id),
    };
    return {
        repository,
        source,
        peerSource,
        run,
        peerRun,
        job,
        peerJob,
        reader,
        archives,
        logs,
        jobs,
        dependencies,
        downloaded,
        reruns,
        setMain: value => {
            mainSha = value;
        },
        setCount: value => {
            totalCount = value;
        },
        setFresh: value => {
            freshRun = value;
        },
        setLock: value => {
            lockfile = value;
        },
    };
}

test('native install archive evidence uses an independent matching peer and every locked version', async () => {
    const f = archiveFixture();
    const result = await recoverRelease('report', f.repository, '10', f.dependencies);
    assert.equal(result.decisions[0].kind, 'runner-install-archive');
    assert.equal(result.decisions[0].retryAllowed, true);
    assert.equal(result.decisions[0].peerRunId, 20);
    assert.equal(result.decisions[0].peerSourceSha, f.peerSource);
    assert.equal(result.decisions[0].archives.length, 3);
    assert.equal(f.downloaded.length, 6);
    assert.deepEqual(f.reruns, []);
    await recoverRelease('retry', f.repository, '10', f.dependencies);
    assert.deepEqual(f.reruns, ['10']);
});

for (const [label, alter] of [
    [
        'attempt two',
        f => {
            f.run.run_attempt = 2;
        },
    ],
    ['old main', f => f.setMain('a'.repeat(40))],
    [
        'foreign failed head',
        f => {
            f.job.head_sha = 'a'.repeat(40);
        },
    ],
    [
        'foreign failed run',
        f => {
            f.job.run_id = 99;
        },
    ],
    [
        'test already started',
        f => {
            f.job.steps[1].conclusion = 'success';
        },
    ],
    [
        'unknown test state',
        f => {
            f.job.steps[1].conclusion = null;
        },
    ],
    [
        'missing step state',
        f => {
            delete f.job.steps[1].status;
        },
    ],
    [
        'missing step number',
        f => {
            delete f.job.steps[1].number;
        },
    ],
    [
        'incomplete job',
        f => {
            f.job.status = 'in_progress';
        },
    ],
    [
        'different failed stage',
        f => {
            f.job.steps[0].name = 'Unit tests';
        },
    ],
    ['missing native logs', f => f.logs.delete(101)],
    [
        'untrusted peer',
        f => {
            f.peerRun.head_repository.full_name = 'other/project';
        },
    ],
    [
        'peer failed',
        f => {
            f.peerRun.conclusion = 'failure';
        },
    ],
    ['peer Node drift', f => f.logs.set(201, f.logs.get(201).replaceAll('22.23.3', '24.19.0'))],
    ['peer Bun drift', f => f.logs.set(201, f.logs.get(201).replace('1.3.14', '1.3.15'))],
    ['peer image drift', f => f.logs.set(201, f.logs.get(201).replace('20261004.327.1', '20261005.1'))],
    ['peer OS drift', f => f.logs.set(201, f.logs.get(201).replace('24.04.5', '24.04.4'))],
    [
        'source drift',
        f => {
            f.reader.entries = ref => [{ path: 'bun.lock', metadata: ref }];
        },
    ],
    [
        'root install hook',
        f => {
            f.reader.text = (_ref, path) =>
                path === 'package.json'
                    ? '{"workspaces":["packages/*"],"scripts":{"postinstall":"node deploy/release-recovery.mjs"}}'
                    : 'unused';
        },
    ],
    ['missing lock versions', f => f.setLock('')],
    [
        'metadata SRI mismatch',
        f => {
            f.archives[0].metadata.dist.integrity = 'invalid';
        },
    ],
    [
        'archive SRI mismatch',
        f => {
            f.archives[0].bytes = Buffer.from('corrupt');
        },
    ],
    [
        'unknown install error',
        f =>
            f.logs.set(
                101,
                f.logs
                    .get(101)
                    .replace(
                        'Integrity check failed for tarball: @tanstack/router-core',
                        'Unknown script error',
                    ),
            ),
    ],
    [
        'code error with network text',
        f =>
            f.logs.set(
                101,
                f.logs.get(101).replace('##[end-action', 'TS2345: invalid type HTTP 503\n##[end-action'),
            ),
    ],
    [
        'checksum error with network text',
        f =>
            f.logs.set(
                101,
                f.logs.get(101).replace('##[end-action', 'checksum mismatch HTTP 503\n##[end-action'),
            ),
    ],
    ...['test failed', 'test failure', 'syntax error', 'not current main', 'requires a full'].map(error => [
        error,
        f => f.logs.set(101, f.logs.get(101).replace('##[end-action', `${error} HTTP 503\n##[end-action`)),
    ]),
])
    test(`archive recovery refuses ${label} without a mutating request`, async () => {
        const f = archiveFixture();
        alter(f);
        const report = await recoverRelease('report', f.repository, '10', f.dependencies).catch(() => null);
        if (report) assert.equal(report.decisions[0].retryAllowed, false);
        await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
        assert.deepEqual(f.reruns, []);
    });

test('retry rechecks main and attempt after registry evidence was read', async () => {
    for (const change of [
        f => f.setMain('a'.repeat(40)),
        f => f.setFresh({ ...f.run, run_attempt: 2 }),
        f => f.setFresh({ ...f.run, head_sha: 'a'.repeat(40) }),
    ]) {
        const f = archiveFixture();
        const download = f.dependencies.download;
        f.dependencies.download = async (...args) => {
            const result = await download(...args);
            if (f.downloaded.length === 6) change(f);
            return result;
        };
        await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
        assert.deepEqual(f.reruns, []);
    }
});

test('complete job inventory and every unknown failed job remain mandatory', async () => {
    for (const alter of [
        f => f.setCount(101),
        f => f.setCount(2),
        f =>
            f.jobs.push({
                ...f.job,
                id: 102,
                name: 'unknown recovery failure',
                steps: [{ name: 'Unknown stage', number: 3, conclusion: 'failure' }],
            }),
    ]) {
        const f = archiveFixture();
        alter(f);
        await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
        assert.deepEqual(f.reruns, []);
    }
});

test('known dependent guards follow proven setup failure without bypassing them', async () => {
    const f = archiveFixture();
    f.jobs.push({
        ...f.job,
        id: 102,
        name: 'validate missing checks once / all-passed',
        steps: [{ name: 'Run exit 1', number: 3, status: 'completed', conclusion: 'failure' }],
    });
    f.logs.set(102, '##[group]Run exit 1\nexit 1\n##[error]Process completed with exit code 1.\n');
    const result = await recoverRelease('report', f.repository, '10', f.dependencies);
    assert.equal(result.decisions[1].kind, 'dependent-guard');
    assert.equal(result.decisions[1].retryAllowed, true);
    f.logs.delete(101);
    await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
    assert.deepEqual(f.reruns, []);
});

for (const error of ['AccessDenied', 'checksum mismatch', 'syntax error', 'unknown guard failure', ''])
    test(`a dependent guard with independent or missing error evidence rejects ${error || 'empty logs'}`, async () => {
        const f = archiveFixture();
        f.jobs.push({
            ...f.job,
            id: 102,
            name: 'validate missing checks once / all-passed',
            steps: [{ name: 'Run exit 1', number: 3, status: 'completed', conclusion: 'failure' }],
        });
        f.logs.set(102, error);
        await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
        assert.deepEqual(f.reruns, []);
    });

test('registry evidence rejects nonofficial tarball URLs and invalid gzip despite valid hashes', () => {
    const f = archiveFixture();
    const item = f.archives[0];
    item.metadata.dist.tarball = 'https://other.example/archive.tgz';
    assert.throws(() => verifyRegistryArchive(item, item.metadata, item.bytes));
    item.metadata.dist.tarball = 'https://registry.npmjs.org/archive.tgz';
    const bytes = Buffer.from('not gzip');
    item.integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    item.metadata.dist.integrity = item.integrity;
    item.metadata.dist.shasum = createHash('sha1').update(bytes).digest('hex');
    assert.throws(() => verifyRegistryArchive(item, item.metadata, bytes));
    assert.throws(() => lockedArchives('', ['@tanstack/router-core']));
    assert.throws(() =>
        matchingInstallSources(f.source, f.peerSource, {
            ...f.reader,
            entries: ref => [{ path: 'deploy/other.mjs', metadata: ref }],
        }),
    );
});

test('Bun JSONC rows outside the failed packages cannot prevent exact locked-version verification', () => {
    const f = archiveFixture();
    const item = f.archives[0];
    const lock = `"fsevents": ["fsevents@2.0.0", "", {"os":["darwin",]}, "ignored"],
"${item.name}": ["${item.name}@${item.version}", "", {"example":["linux",]}, "${item.integrity}"],`;
    assert.deepEqual(lockedArchives(lock, [item.name]), [
        { name: item.name, version: item.version, integrity: item.integrity },
    ]);
});

for (const conclusion of ['cancelled', 'timed_out', null])
    test(`unrelated ${conclusion ?? 'unknown'} job state denies archive recovery`, async () => {
        const f = archiveFixture();
        f.jobs.push({ ...f.job, id: 102, name: 'unrelated job', conclusion, steps: [] });
        await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
        assert.deepEqual(f.reruns, []);
    });

test('cancelled parent runs never permit an archive retry', async () => {
    const f = archiveFixture();
    f.run.conclusion = 'cancelled';
    await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
    assert.deepEqual(f.reruns, []);
});

test('all three real gate recipes must agree with native upstream state', async () => {
    const make = () => {
        const f = archiveFixture();
        const add = (id, name, conclusion, step, log = '') => {
            f.jobs.push({
                ...f.job,
                id,
                name,
                conclusion,
                steps: step ? [{ name: step, number: 3, status: 'completed', conclusion }] : [],
            });
            f.logs.set(id, log);
        };
        add(102, 'select affected release and reusable checks', 'success');
        add(
            103,
            'validate missing checks once / all-passed',
            'failure',
            'Run exit 1',
            '##[group]Run exit 1\nexit 1\n##[error]Process completed with exit code 1.\n',
        );
        add(
            104,
            'confirm applicable checks passed',
            'failure',
            'Validate reused or newly completed checks',
            '  LANE: runtime\n  REUSED: \n  CHECKS_RESULT: failure\n##[error]Process completed with exit code 1.\n',
        );
        add(
            105,
            'require completed deployment and acceptance',
            'failure',
            'Reject a green release with missing deployment stages',
            '  ROUTE_RESULT: success\n  READY_RESULT: failure\nRelease routing or checks did not complete\n##[error]Process completed with exit code 1.\n',
        );
        add(106, 'deploy the verified runtime', 'skipped');
        return f;
    };
    const valid = make();
    const result = await recoverRelease('report', valid.repository, '10', valid.dependencies);
    assert.equal(result.decisions.length, 4);
    assert.ok(result.decisions.every(item => item.retryAllowed));
    for (const alter of [
        f => {
            f.jobs.find(item => item.id === 102).conclusion = 'failure';
        },
        f => f.logs.set(104, f.logs.get(104).replace('REUSED: ', 'REUSED: 99')),
        f => {
            f.jobs.find(item => item.id === 106).conclusion = 'success';
        },
        f => {
            const job = f.jobs.find(item => item.id === 106);
            job.name =
                'publish only the reviewed Nginx configuration / validate and reload Nginx without stopping serving processes';
            job.conclusion = 'success';
        },
        f => f.logs.set(105, f.logs.get(105).replace('ROUTE_RESULT: success', 'ROUTE_RESULT: failure')),
        f =>
            f.logs.set(
                105,
                f.logs
                    .get(105)
                    .replace(
                        'Release routing or checks did not complete\n',
                        "echo 'Release routing or checks did not complete'\n",
                    ),
            ),
        f => {
            const text = f.reader.text;
            f.reader.text = (ref, path) =>
                path.endsWith('build_and_test.yml') ? 'unrecognized workflow' : text(ref, path);
        },
        f => {
            const text = f.reader.text;
            f.reader.text = (ref, path) =>
                path.endsWith('build_and_test.yml')
                    ? text(ref, path).replace(
                          '- run: exit ${{',
                          '- run: unknown-preflight\n            - run: exit ${{',
                      )
                    : text(ref, path);
        },
    ]) {
        const f = make();
        alter(f);
        await assert.rejects(recoverRelease('retry', f.repository, '10', f.dependencies));
        assert.deepEqual(f.reruns, []);
    }
});

test('the actual CLI rejects supplied proof arguments before making any request', () => {
    const result = spawnSync(
        process.execPath,
        [
            fileURLToPath(new URL('./release-recovery.mjs', import.meta.url)),
            'retry',
            '10',
            'self-declared-proof.json',
        ],
        { encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'example/project' } },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No external proof arguments are accepted/u);
});

test('post-switch public checks bind the preserved storefront version during a backend-only release', () => {
    const start = deploymentScript.indexOf('storefront_verification_sha="${target_sha}"');
    assert.ok(start >= 0);
    const command = deploymentScript.slice(start, deploymentScript.indexOf('\nif jq ', start));
    const backend = 'a'.repeat(40);
    const frontend = 'b'.repeat(40);
    for (const retained of ['true', 'false']) {
        const result = spawnSync(
            'bash',
            [
                '-c',
                `
set -Eeuo pipefail
repository=/synthetic
target_sha=${backend}
expected_storefront_sha=${frontend}
retain_frontends=${retained}
node() { printf '%s\\n' "$@"; }
${command}
`,
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.stdout.trim().split('\n'), [
            '/synthetic/deploy/verify-production-storefronts.mjs',
            '--mode',
            'release',
            '--release-id',
            retained === 'true' ? frontend : backend,
        ]);
    }
});
