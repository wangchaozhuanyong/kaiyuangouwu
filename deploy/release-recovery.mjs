import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { createInputReader } from '../scripts/ci-check-inputs.mjs';
import { hasTrustedPullRequest, isTrustedRun, readNativeJobLog } from '../scripts/release-evidence.mjs';

const recoveryFiles = new Set(['deploy/release-recovery.mjs', 'deploy/release-recovery.spec.mjs']);
const shaPattern = /^[a-f0-9]{40}$/u;
const codeError = new RegExp(
    [
        /TS\d{4}:|AssertionError|test.*failed|test failure|vulnerabilit/.source,
        /checksum.*(?:mismatch|differ)|SRI.*mismatch|not current main/.source,
        /requires a full|syntax error|migration.*(?:fail|blocked)|Permission denied|AccessDenied/.source,
    ].join('|'),
    'iu',
);
const archiveErrorPattern = new RegExp(
    '^error: (?:' +
        [
            'Integrity check failed for tarball: ',
            'IntegrityCheckFailed extracting tarball from ',
            'Fail extracting tarball (?:for |from )',
        ].join('|') +
        ')"?(@[a-z0-9._-]+/[a-z0-9._-]+|[a-z0-9._-]+)"?$',
    'u',
);
const deploymentPrefixes = [
    'deploy ',
    'build immutable runtime',
    'prove complete offsite file restore',
    'verify exact running revision',
    'verify committed store acceptance',
];
// Complete gate blocks reviewed at main 51b09. A changed recipe supplies no
// derived-failure evidence until it is independently reviewed and pinned.
const guardRecipes = new Map([
    ['ready', 'e09e08dd9d4d296c046fe5495b65163c27fd376a92141a29f77e54452516b4aa'],
    ['complete', 'e2614079b095e70ed5b70b4903b00163dd310fe89f293ef6a2aa6295e2e43216'],
    ['all-passed', '7e1e36d420cdbd6cee497f296601669135254dd32c60aec7f85cbd0c05e06305'],
]);

export function classifyFailure(logs, attempt = 1) {
    const codeFailure = codeError.test(logs);
    const transient =
        !codeFailure &&
        /ECONNRESET|ETIMEDOUT|EAI_AGAIN|TLS handshake timeout|HTTP (502|503|504)|runner.*(lost|offline)|connection.*(reset|timed out)/iu.test(
            logs,
        );
    return {
        kind: transient ? 'transient' : 'repair-required',
        retryAllowed: transient && attempt === 1,
        next:
            transient && attempt === 1
                ? 'Retry failed jobs once on this run; preserve successful stages.'
                : 'Inspect the failed step and repair its cause. Code fixes require a new SHA and affected checks. ' +
                  'Continue within the release authorization; do not dispatch empty commits or repeat unchanged failures.',
    };
}

function cleanLog(logs) {
    return logs.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '').replace(/^\uFEFF?\d{4}-\d{2}-\d{2}T\S+Z ?/gmu, '');
}

export function observeInstall(job, logs) {
    const setups = job.steps.filter(step => step.name === 'Run ./.github/actions/setup');
    assert.equal(setups.length, 1, 'Missing unique setup step');
    const setup = setups[0];
    assert.equal(job.status, 'completed');
    assert.equal(setup.status, 'completed');
    assert.ok(Number.isSafeInteger(setup.number) && setup.number > 0);
    const text = cleanLog(logs);
    const start = text.indexOf('##[group]Run ./.github/actions/setup');
    const end = text.indexOf('##[end-action id=__self.__run;', start);
    assert.ok(start >= 0 && end > start, 'Incomplete native install log');
    const body = text.slice(start, text.indexOf('\n', end));
    assert.match(body, /(?:^|\n)bun install --frozen-lockfile --linker=hoisted\n/u);
    const node = [...body.matchAll(/(?:^|\n)node: (v\d+\.\d+\.\d+)\n/gu)].map(match => match[1]);
    assert.equal(new Set(node).size, 1, 'Unknown Node version');
    const bun = /bun install v(\d+\.\d+\.\d+) \(([a-f0-9]+)\)/u.exec(body);
    const image = /##\[group\]Runner Image\nImage: ([^\n]+)\nVersion: ([^\n]+)/u.exec(text);
    const os = /##\[group\]Operating System\n([^\n]+)\n([^\n]+)/u.exec(text);
    const arch = /\/node\/[^\n]+\/(x64|arm64)(?:\n|\s)/u.exec(body);
    assert.ok(bun && image && os && arch, 'Missing native toolchain identity');
    const conclusion = /##\[end-action id=__self\.__run;outcome=(success|failure);conclusion=\1;/u.exec(body);
    assert.ok(conclusion, 'Missing native install conclusion');
    assert.equal(setup.conclusion, conclusion[1]);
    return {
        setup,
        body,
        toolchain: [node[0], bun[1], bun[2], image[1], image[2], os[1], os[2], arch[1]],
    };
}

export function installErrorPackages(body) {
    assert.ok(!codeError.test(body), 'Code, permission or checksum failure');
    const packages = new Set();
    for (const line of body.split('\n')) {
        if (!/^error:/u.test(line)) continue;
        const match = archiveErrorPattern.exec(line);
        assert.ok(match, 'Unknown installation failure');
        packages.add(match[1]);
    }
    assert.ok(packages.size > 0 && packages.size <= 10, 'Missing bounded archive failures');
    return [...packages].sort();
}

export function lockedArchives(lockfile, packages) {
    const archives = new Map();
    for (const line of lockfile.split('\n')) {
        const match = /^\s*"([^"]+)": (\[.*\]),?$/u.exec(line);
        if (!match) continue;
        const resolved = /^\["([^"]+)"/u.exec(match[2])?.[1];
        if (!resolved) continue;
        const separator = resolved.lastIndexOf('@');
        const name = resolved.slice(0, separator);
        if (!packages.includes(name)) continue;
        // Bun's JSONC metadata can contain trailing commas. Only these two
        // canonical strings are archive inputs; unrelated metadata is not parsed.
        const integrity = /,\s*"([^"]+)"\]$/u.exec(match[2])?.[1];
        const version = resolved.slice(separator + 1);
        assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u);
        assert.match(integrity ?? '', /^sha512-[A-Za-z0-9+/]{86}==$/u);
        const key = `${name}@${version}`;
        const previous = archives.get(key);
        assert.ok(!previous || previous.integrity === integrity, 'Conflicting lock integrity');
        archives.set(key, { name, version, integrity });
    }
    assert.ok(packages.every(name => [...archives.values()].some(item => item.name === name)));
    assert.ok(archives.size <= 20, 'Unbounded lock versions');
    return [...archives.values()];
}

export function matchingInstallSources(target, peer, reader) {
    const entries = ref => reader.entries(ref).filter(entry => !recoveryFiles.has(entry.path));
    assert.deepEqual(entries(target), entries(peer), 'Installation source drift');
    assert.deepEqual(JSON.parse(reader.text(target, 'package.json')).workspaces, ['packages/*']);
    // These two operator controls are never allowed to become install hooks.
    for (const entry of entries(target)) {
        if (entry.path !== 'package.json' && !/^packages\/[^/]+\/package\.json$/u.test(entry.path)) continue;
        const manifest = JSON.parse(reader.text(target, entry.path));
        for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'])
            assert.ok(!manifest.scripts?.[hook], 'Installation hooks require a separate proof');
    }
}

export function verifyRegistryArchive(expected, metadata, bytes, inspectTar = inspectArchive) {
    assert.equal(metadata.name, expected.name);
    assert.equal(metadata.version, expected.version);
    assert.equal(metadata.dist.integrity, expected.integrity, 'Registry/lock SRI mismatch');
    const url = new URL(metadata.dist.tarball);
    assert.equal(url.origin, 'https://registry.npmjs.org');
    assert.ok(!url.username && !url.password && !url.search && !url.hash);
    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 20 * 1024 * 1024);
    const sri = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    assert.equal(sri, expected.integrity, 'Tarball/lock SRI mismatch');
    assert.equal(createHash('sha1').update(bytes).digest('hex'), metadata.dist.shasum);
    const manifest = inspectTar(bytes);
    assert.equal(manifest.name, expected.name);
    assert.equal(manifest.version, expected.version);
    return { ...expected, bytes: bytes.length, tarballSha512: sri };
}

function inspectArchive(bytes) {
    const options = {
        input: gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }),
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 15_000,
        env: { ...process.env, TAR_OPTIONS: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
    };
    execFileSync('tar', ['-tf', '-'], options);
    return JSON.parse(execFileSync('tar', ['-xOf', '-', 'package/package.json'], options));
}

export function assessInstallArchiveFailure({ repository, run, job, mainSha, failed, peer, archives }) {
    assert.equal(run.status, 'completed');
    assert.equal(run.conclusion, 'failure');
    assert.equal(run.run_attempt, 1, 'A second attempt is never permitted');
    assert.match(run.head_sha, shaPattern);
    assert.equal(mainSha, run.head_sha, 'Release is no longer current main');
    assert.equal(run.head_repository?.full_name, repository);
    assert.equal(job.run_id, run.id);
    assert.equal(job.head_sha, run.head_sha);
    assert.equal(job.conclusion, 'failure');
    assert.equal(failed.setup.conclusion, 'failure');
    assert.deepEqual(
        job.steps.filter(step => step.conclusion === 'failure').map(step => step.name),
        ['Run ./.github/actions/setup'],
    );
    assert.ok(
        job.steps.every(
            step =>
                Number.isSafeInteger(step.number) &&
                step.number > 0 &&
                step.status === 'completed' &&
                (step.number <= failed.setup.number ||
                    /^(Post |Complete job$)/u.test(step.name) ||
                    step.conclusion === 'skipped'),
        ),
        'Business checks have already started',
    );
    assert.equal(peer.job.conclusion, 'success');
    assert.equal(peer.install.setup.conclusion, 'success');
    assert.equal(peer.job.run_id, peer.run.id);
    assert.equal(peer.job.head_sha, peer.run.head_sha);
    assert.ok(isTrustedRun(peer.run, repository), 'Untrusted native peer');
    assert.deepEqual(failed.toolchain, peer.install.toolchain, 'Peer toolchain drift');
    assert.ok(archives.length > 0);
    return {
        kind: 'runner-install-archive',
        retryAllowed: true,
        next:
            'A bounded failed-job retry is eligible only while this exact run/head remains current main. ' +
            'The underlying runner archive failure is unknown; integrity checks remain enabled.',
        peerRunId: peer.run.id,
        peerJobId: peer.job.id,
        peerSourceSha: peer.run.head_sha,
        archives,
    };
}

async function registryBytes(url, limit) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://registry.npmjs.org');
    assert.ok(!parsed.username && !parsed.password && !parsed.search && !parsed.hash);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45_000) });
    assert.equal(response.status, 200);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        assert.ok(size <= limit, 'Registry response is too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

const defaultApi = endpoint =>
    JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
const defaultLogs = (repository, id) =>
    readNativeJobLog(repository, id, (command, args, options) =>
        execFileSync(command, args, { ...options, maxBuffer: 16 * 1024 * 1024 }),
    );

function allJobs(api, repository, runId) {
    const result = api(`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`);
    assert.ok(Number.isInteger(result.total_count) && result.total_count <= 100);
    assert.equal(result.jobs.length, result.total_count, 'Incomplete job inventory');
    assert.equal(new Set(result.jobs.map(job => job.id)).size, result.total_count);
    assert.ok(
        result.jobs.every(job => job.run_id === Number(runId)),
        'Foreign job inventory',
    );
    return result.jobs;
}

export async function proveInstallArchiveFailure(
    repository,
    run,
    job,
    logs,
    {
        api = defaultApi,
        logReader = defaultLogs,
        reader = createInputReader(),
        download = registryBytes,
        inspectTar = inspectArchive,
        jobInventory,
    } = {},
) {
    const mainSha = api(`repos/${repository}/git/ref/heads/main`).object.sha;
    assert.equal(mainSha, run.head_sha, 'Release is no longer current main');
    assert.equal(run.status, 'completed');
    assert.equal(run.conclusion, 'failure');
    assert.equal(run.run_attempt, 1);
    assert.ok(
        (jobInventory ?? allJobs(api, repository, run.id)).every(
            item =>
                item.status === 'completed' && ['success', 'skipped', 'failure'].includes(item.conclusion),
        ),
        'Incomplete or cancelled job state',
    );
    const failed = observeInstall(job, logs);
    assert.ok(!codeError.test(cleanLog(logs)), 'Code or checksum failure cannot use archive recovery');
    const packages = installErrorPackages(failed.body);
    const expected = lockedArchives(reader.text(run.head_sha, 'bun.lock'), packages);
    const runs = api(
        `repos/${repository}/actions/workflows/build_and_test.yml/runs?status=success&per_page=20`,
    ).workflow_runs;
    let peer;
    for (const candidate of runs) {
        if (!isTrustedRun(candidate, repository) || !hasTrustedPullRequest(candidate, repository, api))
            continue;
        try {
            matchingInstallSources(run.head_sha, candidate.head_sha, reader);
        } catch {
            continue;
        }
        const jobs = allJobs(api, repository, candidate.id).sort(
            (left, right) =>
                Number(right.name === job.name.split(' / ').at(-1)) -
                Number(left.name === job.name.split(' / ').at(-1)),
        );
        for (const candidateJob of jobs) {
            if (
                candidateJob.conclusion !== 'success' ||
                !candidateJob.steps.some(
                    step => step.name === 'Run ./.github/actions/setup' && step.conclusion === 'success',
                )
            )
                continue;
            try {
                const install = observeInstall(candidateJob, logReader(repository, candidateJob.id));
                assert.deepEqual(failed.toolchain, install.toolchain);
                peer = { run: candidate, job: candidateJob, install };
                break;
            } catch {
                /* Missing or differing native logs supply no install evidence. */
            }
        }
        if (peer) break;
    }
    assert.ok(peer, 'No independently successful matching install peer');
    const archives = [];
    for (const item of expected) {
        const metadata = JSON.parse(
            await download(
                `https://registry.npmjs.org/${encodeURIComponent(item.name)}/${item.version}`,
                1024 * 1024,
            ),
        );
        const bytes = await download(metadata.dist.tarball, 20 * 1024 * 1024);
        archives.push(verifyRegistryArchive(item, metadata, bytes, inspectTar));
    }
    return assessInstallArchiveFailure({ repository, run, job, mainSha, failed, peer, archives });
}

const dependentGuards = new Map([
    ['validate missing checks once / all-passed', 'Run exit 1'],
    ['confirm applicable checks passed', 'Validate reused or newly completed checks'],
    ['require completed deployment and acceptance', 'Reject a green release with missing deployment stages'],
]);

function workflowJob(reader, sha, path, id) {
    const source = reader.text(sha, path);
    const start = source.indexOf(`\n    ${id}:\n`);
    assert.ok(start >= 0, 'Missing immutable guard recipe');
    const block = source.slice(start + 1).split(/\n(?=    [\w-]+:\n)/u)[0];
    assert.equal(
        createHash('sha256').update(block).digest('hex'),
        guardRecipes.get(id),
        'Unreviewed guard recipe',
    );
    return block;
}

function isDependentGuard(job, logs, run, jobs, reader) {
    const guard = dependentGuards.get(job.name);
    const failures = job.steps.filter(step => step.conclusion === 'failure');
    const text = cleanLog(logs);
    const errors = text.split('\n').filter(line => line.includes('##[error]'));
    const message = new Map([
        ['validate missing checks once / all-passed', /##\[group\]Run exit 1\nexit 1/u],
        ['confirm applicable checks passed', /CHECKS_RESULT: failure/u],
        ['require completed deployment and acceptance', /Release routing or checks did not complete/u],
    ]).get(job.name);
    const observed =
        guard &&
        job.head_sha === run.head_sha &&
        job.status === 'completed' &&
        failures.length === 1 &&
        failures[0].name === guard &&
        failures[0].status === 'completed' &&
        !codeError.test(text) &&
        message.test(text) &&
        errors.length === 1 &&
        errors[0] === '##[error]Process completed with exit code 1.';
    if (!observed) return false;
    try {
        assert.equal(run.path, '.github/workflows/production_release.yml');
        const route = jobs.find(item => item.name === 'select affected release and reusable checks');
        const ready = jobs.find(item => item.name === 'confirm applicable checks passed');
        const checkJobs = jobs.filter(
            item => item.name.startsWith('validate missing checks once / ') && item !== job,
        );
        assert.ok(checkJobs.some(item => item.conclusion === 'failure'));
        assert.ok(
            checkJobs.every(
                item =>
                    item.status === 'completed' &&
                    ['success', 'skipped', 'failure'].includes(item.conclusion),
            ),
        );
        if (job.name === 'validate missing checks once / all-passed') {
            const source = workflowJob(
                reader,
                run.head_sha,
                '.github/workflows/build_and_test.yml',
                'all-passed',
            );
            assert.ok(
                source.includes("contains(needs.*.result, 'failure')") &&
                    source.includes("contains(needs.*.result, 'cancelled')"),
            );
            assert.ok(
                source.includes('needs:') &&
                    source.includes('- unit-tests') &&
                    source.includes('- run: exit ${{'),
            );
        } else {
            assert.equal(route?.conclusion, 'success');
            assert.equal(route?.status, 'completed');
            const id = job.name === 'confirm applicable checks passed' ? 'ready' : 'complete';
            const source = workflowJob(reader, run.head_sha, run.path, id);
            if (id === 'ready') {
                assert.ok(
                    source.includes('needs: [route, checks]') &&
                        source.includes(
                            '[[ "$LANE" == none || -n "$REUSED" || "$CHECKS_RESULT" == success ]]',
                        ),
                );
                assert.match(text, /^  LANE: (runtime|frontend)$/mu);
                assert.match(text, /^  REUSED: *$/mu);
                assert.match(text, /^  CHECKS_RESULT: failure$/mu);
            } else {
                assert.equal(ready?.conclusion, 'failure');
                assert.equal(ready?.status, 'completed');
                assert.ok(
                    source.includes('"$ROUTE_RESULT" == success && "$READY_RESULT" == success') &&
                        source.includes("echo 'Release routing or checks did not complete' >&2; exit 1;"),
                );
                assert.match(text, /^  ROUTE_RESULT: success$/mu);
                assert.match(text, /^  READY_RESULT: failure$/mu);
                assert.match(text, /^Release routing or checks did not complete$/mu);
                assert.ok(
                    jobs
                        .filter(item => deploymentPrefixes.some(prefix => item.name.startsWith(prefix)))
                        .every(item => item.conclusion === 'skipped'),
                );
            }
        }
        return true;
    } catch {
        return false;
    }
}

export async function recoverRelease(
    command,
    repository,
    runId,
    {
        api = defaultApi,
        logReader = defaultLogs,
        rerun = id =>
            execFileSync('gh', ['run', 'rerun', id, '--repo', repository, '--failed'], { stdio: 'inherit' }),
        ...proofOptions
    } = {},
) {
    assert.ok(['report', 'retry'].includes(command));
    assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
    assert.match(runId ?? '', /^\d+$/u);
    const run = structuredClone(api(`repos/${repository}/actions/runs/${runId}`));
    assert.equal(run.id, Number(runId));
    assert.equal(run.head_repository?.full_name, repository);
    assert.equal(run.event, 'workflow_dispatch');
    assert.match(run.head_sha, shaPattern);
    assert.ok(
        [
            '.github/workflows/production_release.yml',
            '.github/workflows/deploy_storefront_fast_lane.yml',
        ].includes(run.path),
    );
    const jobs = structuredClone(allJobs(api, repository, runId));
    const reader = proofOptions.reader ?? createInputReader();
    const failedJobs = jobs.filter(
        job => job.conclusion === 'failure' && job.name !== 'explain release failure and bounded recovery',
    );
    const decisions = [];
    const verifiedGuards = [];
    for (const job of failedJobs) {
        let logs = '';
        try {
            logs = logReader(repository, job.id);
        } catch {
            /* Missing logs never authorize a retry. */
        }
        if (isDependentGuard(job, logs, run, jobs, reader)) {
            verifiedGuards.push(job);
            continue;
        }
        const archiveError =
            /IntegrityCheckFailed|Integrity check failed for tarball|Fail extracting tarball/u.test(logs);
        let decision = classifyFailure(archiveError ? '' : logs, run.run_attempt);
        if (!decision.retryAllowed) {
            try {
                decision = await proveInstallArchiveFailure(repository, run, job, logs, {
                    api,
                    logReader,
                    ...proofOptions,
                    reader,
                    jobInventory: jobs,
                });
            } catch {
                /* Unproven archive failures keep the conservative classification. */
            }
        }
        decisions.push({
            job: job.name,
            jobId: job.id,
            failedSteps: job.steps.filter(step => step.conclusion === 'failure').map(step => step.name),
            ...decision,
        });
    }
    const eligible = decisions.length > 0 && decisions.every(decision => decision.retryAllowed);
    for (const job of verifiedGuards)
        decisions.push({
            job: job.name,
            jobId: job.id,
            failedSteps: job.steps.filter(step => step.conclusion === 'failure').map(step => step.name),
            kind: 'dependent-guard',
            retryAllowed: eligible,
            next: 'This guard remains failed until the independently verified root failure is resolved.',
        });
    if (command === 'retry') {
        assert.equal(run.status, 'completed');
        assert.equal(run.conclusion, 'failure');
        assert.ok(
            jobs.every(
                item =>
                    item.status === 'completed' &&
                    ['success', 'skipped', 'failure'].includes(item.conclusion),
            ),
        );
        assert.ok(eligible, 'Only one independently proven failed-job retry is allowed');
        const fresh = api(`repos/${repository}/actions/runs/${runId}`);
        assert.equal(fresh.status, 'completed');
        assert.equal(fresh.run_attempt, 1);
        assert.equal(fresh.head_sha, run.head_sha);
        assert.equal(fresh.id, run.id);
        assert.equal(fresh.path, run.path);
        assert.equal(fresh.event, run.event);
        assert.equal(fresh.head_repository?.full_name, repository);
        assert.equal(
            api(`repos/${repository}/git/ref/heads/main`).object.sha,
            run.head_sha,
            'Release is no longer current main',
        );
        assert.deepEqual(allJobs(api, repository, runId), jobs, 'Job state changed during verification');
        rerun(runId);
    }
    return { run, decisions };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    assert.ok(process.argv.slice(2).length <= 2, 'No external proof arguments are accepted');
    const [command = 'report', runId = process.env.GITHUB_RUN_ID] = process.argv.slice(2);
    const repository = process.env.GITHUB_REPOSITORY;
    const { run, decisions } = await recoverRelease(command, repository, runId);
    if (command === 'report') {
        const summary =
            `## Release recovery\n\nTarget: ${run.head_sha}; run: ${runId}; attempt: ${run.run_attempt}.\n\n` +
            decisions
                .map(decision =>
                    [
                        `- ${decision.job}: ${decision.failedSteps.join(', ')}.`,
                        `Kind: ${decision.kind}; retry eligible: ${decision.retryAllowed};`,
                        `peer run: ${decision.peerRunId ?? 'none'}. ${decision.next}`,
                    ].join(' '),
                )
                .join('\n') +
            '\n\nDo not mark the release complete until target-version and affected-function acceptance pass. ' +
            'Preserve the last healthy release. This command does not authorize a production rollback.\n';
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
        process.stdout.write(summary);
    }
}
