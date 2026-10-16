import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
    checkCovered,
    checkFingerprint,
    checkRequirements,
    createInputReader,
    missingPlan,
    requiredJobs,
    sharedInputFingerprint,
} from './ci-check-inputs.mjs';
import {
    affectedFrontendsForFile,
    emitPlan,
    inspection,
    isDocumentation,
    packageInventory,
    STATIC_APPS,
} from './ci-impact.mjs';
import {
    hasNativePullRequestProvenance,
    isFailedNativeSource,
    loadNativeCoverage,
} from './ci-native-coverage.mjs';
import { retainedFrontendPlan } from './release-preserve-frontends.mjs';

export function frontendEvidencePlan(
    plan,
    revisions,
    changedFiles = (from, to) =>
        git('diff', '--no-renames', '--name-only', from, to, '--').split('\n').filter(Boolean),
) {
    // Scope runtime safety against the backend first. Independent frontend pointers
    // only narrow check coverage after the complete diff was classified as static.
    if (plan.lane !== 'frontend' || plan.full) return plan;
    const observed = { storefront: revisions.storefrontSha, 'next-admin': revisions.adminSha };
    const pending = new Map();
    for (const component of STATIC_APPS) {
        const sha = observed[component];
        if (!sha || sha === 'unknown') continue;
        assert.match(sha, /^[a-f0-9]{40}$/u, `Invalid observed ${component} revision`);
        assert.match(revisions.targetSha, /^[a-f0-9]{40}$/u);
        pending.set(component, new Set(changedFiles(sha, revisions.targetSha)));
    }
    if (!pending.size) return plan;
    const owners = file => affectedFrontendsForFile(file);
    const isPending = (file, component) => !pending.has(component) || pending.get(component).has(file);
    const files = plan.files.filter(file =>
        owners(file).length ? owners(file).some(component => isPending(file, component)) : true,
    );
    return {
        ...plan,
        files,
        frontends: plan.frontends.filter(component =>
            files.some(file => owners(file).includes(component) && isPending(file, component)),
        ),
        ...(plan.lintFiles ? { lintFiles: plan.lintFiles.filter(file => files.includes(file)) } : {}),
    };
}

function releaseInspection(base, target, full = false) {
    const observed = inspection(base, target, full);
    const plan = process.env.RETAIN_FRONTENDS === 'true' ? retainedFrontendPlan(observed) : observed;
    return frontendEvidencePlan(
        plan,
        {
            storefrontSha: process.env.STOREFRONT_SHA,
            adminSha: process.env.ADMIN_SHA,
            targetSha: git('rev-parse', target),
        },
        (from, to) => {
            git('merge-base', '--is-ancestor', base, from);
            git('merge-base', '--is-ancestor', from, to);
            return git('diff', '--no-renames', '--name-only', from, to, '--').split('\n').filter(Boolean);
        },
    );
}

export function coversChanges(evidence, required) {
    return (
        evidence?.version === 1 &&
        (evidence.full === true ||
            required.filter(file => !isDocumentation(file)).every(file => evidence.files?.includes(file)))
    );
}

export function isTrustedRun(run, repository) {
    return (
        run.status === 'completed' &&
        run.conclusion === 'success' &&
        run.head_repository?.full_name === repository &&
        ['pull_request', 'workflow_dispatch'].includes(run.event) &&
        [
            '.github/workflows/build_and_test.yml',
            '.github/workflows/production_release.yml',
            '.github/workflows/deploy_storefront_fast_lane.yml',
        ].includes(run.path)
    );
}

export function hasTrustedPullRequest(run, repository, api) {
    if (run.event !== 'pull_request') return true;
    // Actions can omit pull_requests after a merge. Resolve the immutable commit association,
    // then apply the same repository and exact-head checks used for attached PR references.
    const references = run.pull_requests?.length
        ? run.pull_requests
        : api(`repos/${repository}/commits/${run.head_sha}/pulls?per_page=100`);
    return references.some(pr => {
        const current = api(`repos/${repository}/pulls/${pr.number}`);
        return current.head.repo?.full_name === repository && current.head.sha === run.head_sha;
    });
}

const apiCache = new Map();
const retryPause = milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const isTransientGitHubError = error =>
    /gh: (?:HTTP (?:429|5\d\d)\b|[^\r\n]*\(HTTP (?:429|5\d\d)\))|TLS handshake timeout|connection reset by peer|i\/o timeout/u.test(
        String(error?.stderr ?? ''),
    );
const isMissingGitHubProof = error =>
    /(?:^|\n)gh: (?:HTTP 404\b|[^\r\n]*\(HTTP 404\))/u.test(String(error?.stderr ?? ''));
export function requestGitHubApi(endpoint, request = execFileSync, pause = retryPause) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const body = request('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
            try {
                return JSON.parse(body);
            } catch (error) {
                // Transport data is not historical scope JSON. Keep malformed API
                // reads fatal without displaying response content in diagnostics.
                if (error instanceof SyntaxError) throw new Error('GitHub API response is not valid JSON');
                throw error;
            }
        } catch (error) {
            if (attempt === 2 || !isTransientGitHubError(error)) throw error;
            pause(1000 * (attempt + 1));
        }
    }
    throw new Error('Unreachable GitHub API retry state');
}
const gh = endpoint => {
    if (!apiCache.has(endpoint)) apiCache.set(endpoint, requestGitHubApi(endpoint));
    return apiCache.get(endpoint);
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const output = (key, value) => {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    process.stdout.write(`${key}=${value}\n`);
};

// Metadata is read as data; downloaded CI archives are never executed by this discovery step.
export async function findEvidence({ repository, targetSha, requiredFiles, api = gh }) {
    const targetTree = api(`repos/${repository}/git/commits/${targetSha}`).tree.sha;
    const runs = api(`repos/${repository}/actions/runs?status=success&per_page=100`).workflow_runs;
    for (const run of runs.filter(candidate => isTrustedRun(candidate, repository))) {
        const commit = api(`repos/${repository}/git/commits/${run.head_sha}`);
        if (commit.tree.sha !== targetTree) continue;
        // A fork PR must never supply deployable evidence, even if GitHub reports the base repo on the run.
        if (!hasTrustedPullRequest(run, repository, api)) continue;
        const artifacts = api(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts;
        const proof = artifacts
            .filter(artifact => !artifact.expired && artifact.name.startsWith(`ci-evidence-${run.id}-`))
            .sort((a, b) => b.id - a.id)[0];
        if (!proof) continue;
        // Read only the plan produced by the successful final gate, never archive code.
        return { runId: run.id, artifactId: proof.id, targetTree, requiredFiles };
    }
    return null;
}

export function downloadEvidenceArtifact(repository, artifactId, request = execFileSync, pause = retryPause) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return request('gh', ['api', `repos/${repository}/actions/artifacts/${artifactId}/zip`], {
                maxBuffer: 2 * 1024 * 1024,
            });
        } catch (error) {
            if (attempt === 2 || !isTransientGitHubError(error)) throw error;
            pause(1000 * (attempt + 1));
        }
    }
    throw new Error('Unreachable GitHub artifact retry state');
}

const nativeLogCapabilities = new WeakMap();
export function readNativeJobLog(repository, jobId, request = execFileSync, pause = retryPause) {
    assert.match(repository, /^[\w.-]+\/[\w.-]+$/u);
    assert.ok(Number.isSafeInteger(jobId) && jobId > 0, 'Invalid native job ID');
    const capture = { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] };
    if (!nativeLogCapabilities.has(request)) {
        const help = request('gh', ['api', '--help'], capture);
        nativeLogCapabilities.set(request, /^\s*--allow-escape-sequences(?:\s|$)/mu.test(help));
    }
    const args = ['api', `repos/${repository}/actions/jobs/${jobId}/logs`];
    // Actions shell annotations contain ANSI. Permit raw bytes only into this
    // captured log reader; the source/attempt/scope verifier still validates them.
    if (nativeLogCapabilities.get(request)) args.push('--allow-escape-sequences');
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return request('gh', args, capture);
        } catch (error) {
            if (attempt === 2 || !isTransientGitHubError(error)) throw error;
            pause(1000 * (attempt + 1));
        }
    }
    throw new Error('Unreachable GitHub native log retry state');
}

function readProof(repository, artifactId) {
    const archive = downloadEvidenceArtifact(repository, artifactId);
    const json = execFileSync(
        'python3',
        [
            '-c',
            'import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); ' +
                'info=z.getinfo("ci-evidence.json"); assert info.file_size < 1000000; sys.stdout.buffer.write(z.read(info))',
        ],
        { input: archive, maxBuffer: 2 * 1024 * 1024 },
    );
    return JSON.parse(json);
}

export async function findInputCoverage({
    repository,
    targetSha,
    plan,
    inventory = packageInventory(),
    reader = createInputReader(),
    api = gh,
    proofReader = readProof,
    includeRunId,
    currentRunId,
    nativeLogReader = readNativeJobLog,
}) {
    assert.match(targetSha, /^[a-f0-9]{40}$/u);
    const targetTree = api(`repos/${repository}/git/commits/${targetSha}`).tree.sha;
    const required = checkRequirements(plan, inventory);
    const missing = new Map(required.map(check => [check.id, check]));
    const fingerprints = new Map(
        required.map(check => [check.id, checkFingerprint(targetSha, check, inventory, reader)]),
    );
    const targetSharedInputs = sharedInputFingerprint(targetSha, reader);
    const reused = [];
    const nativeRejected = [];
    let anchor;
    // Other Actions workflows can fill the repository-wide first page, or leave it stale.
    // Read only workflows that can produce trusted CI evidence.
    // Some cached workflow indexes omit newly completed runs. A rolling created
    // filter obtains the recent index; a separate bounded historical window keeps
    // verified business proof reachable after several failed or cancelled follow-ups.
    const recentSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/u, 'Z');
    const recentFilter = encodeURIComponent(`>=${recentSince}`);
    let runs = ['build_and_test.yml', 'production_release.yml', 'deploy_storefront_fast_lane.yml']
        .flatMap(workflow => [
            ...api(
                // Missing older evidence only reduces reuse; required checks still run.
                `repos/${repository}/actions/workflows/${workflow}/runs?status=completed&created=${recentFilter}&per_page=5`,
            ).workflow_runs,
            ...api(`repos/${repository}/actions/workflows/${workflow}/runs?status=completed&per_page=20`)
                .workflow_runs,
        ])
        .sort((left, right) => right.id - left.id);
    if (includeRunId) runs = [api(`repos/${repository}/actions/runs/${includeRunId}`), ...runs];
    const seen = new Set();
    for (const run of runs) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        const current = String(run.id) === String(currentRunId);
        const failedRelease =
            run.status === 'completed' &&
            ['failure', 'cancelled'].includes(run.conclusion) &&
            run.head_repository?.full_name === repository &&
            run.event === 'workflow_dispatch' &&
            [
                '.github/workflows/production_release.yml',
                '.github/workflows/deploy_storefront_fast_lane.yml',
            ].includes(run.path);
        const failedNative = isFailedNativeSource(run, repository);
        if (current) {
            assert.equal(run.head_repository?.full_name, repository);
            assert.ok(['workflow_dispatch', 'pull_request'].includes(run.event));
            assert.ok(
                [
                    '.github/workflows/build_and_test.yml',
                    '.github/workflows/production_release.yml',
                    '.github/workflows/deploy_storefront_fast_lane.yml',
                ].includes(run.path),
            );
            const gates = api(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`).jobs.filter(
                job => /(^|\/ )all-passed$/u.test(job.name),
            );
            assert.ok(
                gates.length && gates.every(job => job.conclusion === 'success'),
                'The current run has no successful applicable CI gate',
            );
        } else if (!isTrustedRun(run, repository) && !failedRelease && !failedNative) continue;
        let sourceTree;
        let sourceRef = run.head_sha;
        try {
            sourceTree = reader.tree
                ? reader.tree(run.head_sha)
                : api(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha;
        } catch {
            // A removed PR branch can still have its checked tree reachable through a squash merge.
            sourceTree = api(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha;
            sourceRef = sourceTree;
        }
        const matching = [];
        const fullFrontendMatches = new Map();
        let sharedInputsMatch = false;
        try {
            sharedInputsMatch = sharedInputFingerprint(sourceRef, reader) === targetSharedInputs;
        } catch {
            // Missing historical objects cannot supply reusable evidence.
        }
        for (const check of missing.values()) {
            if (!sharedInputsMatch && check.kind !== 'architecture') continue;
            try {
                if (checkFingerprint(sourceRef, check, inventory, reader) === fingerprints.get(check.id))
                    matching.push(check);
                if (check.kind === 'frontend') {
                    const fullInput = checkFingerprint(targetSha, check, inventory, reader, true);
                    if (checkFingerprint(sourceRef, check, inventory, reader, true) === fullInput) {
                        fullFrontendMatches.set(check.id, fullInput);
                        if (!matching.includes(check)) matching.push(check);
                    }
                }
            } catch {
                // A missing historical object or recipe supplies no evidence. Never widen the check scope.
            }
        }
        if (!matching.length && sourceTree !== targetTree) continue;
        let artifact;
        let native;
        let proof;
        if (failedNative) {
            try {
                if (!hasNativePullRequestProvenance(run, repository, api)) continue;
                native = await loadNativeCoverage({
                    run,
                    repository,
                    sourceTree,
                    reader,
                    inventory,
                    api,
                    logReader: nativeLogReader,
                });
            } catch (error) {
                const proofMissing = isMissingGitHubProof(error);
                const malformed = error instanceof assert.AssertionError || error instanceof SyntaxError;
                // Reader/protection/permission failures must stop planning, never widen execution.
                if (!proofMissing && !malformed) throw error;
                // Known missing or malformed old proof supplies no coverage; independent proof remains usable.
                nativeRejected.push({
                    runId: run.id,
                    reason: proofMissing
                        ? 'Native proof is unavailable (404)'
                        : 'Native proof structure is invalid',
                });
                continue;
            }
            proof = native.plan;
        } else {
            if (!hasTrustedPullRequest(run, repository, api)) continue;
            const artifacts = api(
                `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
            ).artifacts;
            artifact = artifacts
                .filter(item => !item.expired && item.name.startsWith(`ci-evidence-${run.id}-`))
                .sort((a, b) => b.id - a.id)[0];
            if (!artifact) continue;
            proof = proofReader(repository, artifact.id);
            if (
                ![1, 2].includes(proof.version) ||
                proof.sourceSha !== run.head_sha ||
                proof.tree !== sourceTree ||
                String(proof.runId) !== String(run.id)
            )
                continue;
        }
        if (failedRelease) {
            if (proof.version !== 2) continue;
            const gates = api(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`).jobs.filter(
                job => /(^|\/ )all-passed$/u.test(job.name),
            );
            if (!gates.length || gates.some(job => job.conclusion !== 'success')) continue;
        }
        if (!native && sourceTree === targetTree && !anchor)
            anchor = { runId: run.id, artifactId: artifact.id };
        for (const check of matching) {
            if (!checkCovered(proof, check, inventory)) continue;
            if (native && !native.checks.has(check.id)) continue;
            // A full source run executes the root build/test jobs, not the related-frontend job.
            const inputHash =
                check.kind === 'frontend' && proof.full === true
                    ? fullFrontendMatches.get(check.id)
                    : fingerprints.get(check.id);
            if (
                !inputHash ||
                checkFingerprint(
                    sourceRef,
                    check,
                    inventory,
                    reader,
                    check.kind === 'frontend' && proof.full === true,
                ) !== inputHash
            )
                continue;
            missing.delete(check.id);
            reused.push({
                check: check.id,
                runId: run.id,
                ...(native
                    ? { ...native.provenance, nativeJobs: native.jobs.get(check.id) }
                    : { artifactId: artifact.id }),
                sourceSha: run.head_sha,
                inputSha256: inputHash,
            });
        }
        if (!missing.size && anchor) break;
    }
    return {
        targetTree,
        anchor,
        reused,
        missing: [...missing.values()],
        ...(nativeRejected.length ? { nativeRejected } : {}),
    };
}

export async function waitForCompleteInputCoverage(
    loadCoverage,
    {
        delays = [5_000, 15_000, 30_000],
        pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
        refresh = () => apiCache.clear(),
    } = {},
) {
    let result = await loadCoverage();
    for (const delay of delays) {
        if (result.anchor && result.missing.length === 0) return result;
        await pause(delay);
        // GitHub can briefly serve an incomplete run or artifact list after the CI gate succeeds.
        // Revalidate every proof from a fresh API snapshot; never treat the prior plan as approval.
        refresh();
        result = await loadCoverage();
    }
    return result;
}

export function validateExecutedChecks(plan, inventory, results) {
    for (const check of checkRequirements(plan, inventory)) {
        for (const job of requiredJobs(check, plan.full))
            assert.equal(
                results[job]?.result,
                'success',
                `Required CI job ${job} did not pass for ${check.id}`,
            );
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, base, target = 'HEAD'] = process.argv.slice(2);
    if (command === 'write') {
        const plan = JSON.parse(base ? readFileSync(base, 'utf8') : process.env.CI_PLAN);
        validateExecutedChecks(plan, packageInventory(), JSON.parse(process.env.CI_JOB_RESULTS ?? '{}'));
        writeFileSync(
            'ci-evidence.json',
            JSON.stringify({
                ...plan,
                version: 2,
                tree: git('rev-parse', 'HEAD^{tree}'),
                sourceSha: git('rev-parse', 'HEAD'),
                runId: process.env.GITHUB_RUN_ID,
            }) + '\n',
        );
    } else if (command === 'plan') {
        const repository = process.env.GITHUB_REPOSITORY;
        assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
        const full = process.argv[5] === 'true';
        const plan = releaseInspection(base, target, full);
        const coverage =
            full || !checkRequirements(plan, packageInventory()).length
                ? { missing: checkRequirements(plan, packageInventory()), reused: [] }
                : await findInputCoverage({ repository, targetSha: git('rev-parse', target), plan });
        const execution = missingPlan(plan, coverage.missing);
        if (process.env.GITHUB_STEP_SUMMARY)
            appendFileSync(
                process.env.GITHUB_STEP_SUMMARY,
                `## Reused checks\n\n${coverage.reused.map(item => `- ${item.check}: run ${item.runId}`).join('\n') || 'No matching valid evidence.'}\n\n` +
                    `Missing: ${coverage.missing.map(item => item.id).join(', ') || 'none'}.\n`,
            );
        emitPlan(execution);
    } else if (command === 'find') {
        const repository = process.env.GITHUB_REPOSITORY;
        assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
        const plan = releaseInspection(base, target);
        const result = await findInputCoverage({ repository, targetSha: git('rev-parse', target), plan });
        output('run_id', !result.missing.length && result.anchor ? result.anchor.runId : '');
    } else if (command === 'verify') {
        const runId = process.argv[5];
        const repository = process.env.GITHUB_REPOSITORY;
        assert.match(runId ?? '', /^\d+$/u);
        assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
        const run = gh(`repos/${repository}/actions/runs/${runId}`);
        const expectedTree = git('rev-parse', `${target}^{tree}`);
        assert.equal(
            gh(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha,
            expectedTree,
            'CI run source differs from release',
        );
        const result = await waitForCompleteInputCoverage(() =>
            findInputCoverage({
                repository,
                targetSha: git('rev-parse', target),
                plan: releaseInspection(base, target),
                includeRunId: runId,
                currentRunId: process.env.GITHUB_RUN_ID,
            }),
        );
        assert.ok(
            result.anchor && String(result.anchor.runId) === runId,
            'CI source anchor is missing or untrusted',
        );
        assert.equal(
            result.missing.length,
            0,
            `Required checks have no matching valid input proof: ${result.missing.map(item => item.id).join(', ')}`,
        );
        process.stdout.write('RELEASE_CI_VERIFIED\n');
    } else throw new Error('Expected plan, write, find or verify');
}
