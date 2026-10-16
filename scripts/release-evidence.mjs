import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const MAX_SOURCE_REFS = 32;
const MAX_SOURCE_DEPTH = 4;
const proofDigest = proof => createHash('sha256').update(JSON.stringify(proof)).digest('hex');
function checkedSourceRefs(refs = []) {
    assert.ok(Array.isArray(refs) && refs.length <= MAX_SOURCE_REFS, 'Invalid evidence source references');
    const seen = new Set();
    for (const ref of refs) {
        assert.ok(ref && typeof ref === 'object', 'Invalid evidence source reference');
        assert.ok(Number.isSafeInteger(ref.runId) && ref.runId > 0, 'Invalid evidence source run');
        assert.ok(!seen.has(ref.runId), 'Duplicate evidence source run');
        seen.add(ref.runId);
        assert.match(ref.sourceSha ?? '', /^[a-f0-9]{40}$/u, 'Invalid evidence source SHA');
        const keys = ['kind', 'runId', 'sourceSha'];
        if (ref.kind === 'artifact') {
            assert.ok(Number.isSafeInteger(ref.artifactId) && ref.artifactId > 0, 'Invalid source artifact');
            assert.match(ref.proofSha256 ?? '', /^[a-f0-9]{64}$/u, 'Invalid source proof hash');
            keys.push('artifactId', 'proofSha256');
        } else {
            assert.equal(ref.kind, 'partial-native', 'Invalid evidence source kind');
            for (const key of ['runAttempt', 'scopeJobId'])
                assert.ok(Number.isSafeInteger(ref[key]) && ref[key] > 0, 'Invalid native source ' + key);
            assert.match(ref.scopeLogSha256 ?? '', /^[a-f0-9]{64}$/u, 'Invalid native source log hash');
            keys.push('runAttempt', 'scopeJobId', 'scopeLogSha256');
        }
        assert.ok(
            Object.keys(ref).every(key => keys.includes(key)),
            'Unknown evidence source field',
        );
    }
    return refs;
}

/** Persist locators for verified native proof, never a claim that reused checks executed again. */
export function reusedSourceReferences(reused) {
    const refs = new Map();
    for (const item of reused) {
        const ref =
            item.evidenceKind === 'partial-native'
                ? {
                      kind: 'partial-native',
                      runId: item.runId,
                      sourceSha: item.sourceSha,
                      runAttempt: item.runAttempt,
                      scopeJobId: item.scopeJobId,
                      scopeLogSha256: item.scopeLogSha256,
                  }
                : {
                      kind: 'artifact',
                      runId: item.runId,
                      sourceSha: item.sourceSha,
                      artifactId: item.artifactId,
                      proofSha256: item.proofSha256,
                  };
        if (refs.has(ref.runId))
            assert.deepEqual(refs.get(ref.runId), ref, 'Conflicting evidence source reference');
        refs.set(ref.runId, ref);
    }
    return checkedSourceRefs([...refs.values()]);
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
    retainOrigins = false,
}) {
    assert.match(targetSha, /^[a-f0-9]{40}$/u);
    const targetTree = api(`repos/${repository}/git/commits/${targetSha}`).tree.sha;
    const required = checkRequirements(plan, inventory);
    const missing = new Map(required.map(check => [check.id, check]));
    // A narrow PR may not require checks which a later cumulative deployment needs.
    // Keep verified, unchanged business origins as discovery hints only; never add
    // them to this plan's execution scope or claim they ran in this candidate.
    const originChecks = retainOrigins
        ? checkRequirements(
              {
                  ...plan,
                  files: [],
                  lintFiles: [],
                  packages: inventory.map(pkg => pkg.directory).filter(name => !STATIC_APPS.includes(name)),
                  frontends: [],
                  dashboard: true,
                  e2e: true,
                  databases: ['mysql'],
              },
              inventory,
          ).filter(check => ['backend', 'dashboard'].includes(check.kind) && !missing.has(check.id))
        : [];
    const originMissing = new Map(originChecks.map(check => [check.id, check]));
    const fingerprints = new Map(
        [...required, ...originChecks].map(check => [
            check.id,
            checkFingerprint(targetSha, check, inventory, reader),
        ]),
    );
    const targetSharedInputs = sharedInputFingerprint(targetSha, reader);
    const reused = [];
    const origins = [];
    const nativeRejected = [];
    let anchor;
    // Other Actions workflows can fill the repository-wide first page, or leave it stale.
    // Read only workflows that can produce trusted CI evidence.
    // Some cached workflow indexes omit newly completed runs. A rolling created
    // filter obtains the recent index; a separate bounded historical window keeps
    // verified business proof reachable after failed or cancelled follow-ups. One
    // release may finish more than twenty scoped runs without invalidating their
    // older business proof; keep a bounded full API page for that source history.
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
            ...api(`repos/${repository}/actions/workflows/${workflow}/runs?status=completed&per_page=100`)
                .workflow_runs,
        ])
        .sort((left, right) => right.id - left.id);
    if (includeRunId) runs = [api(`repos/${repository}/actions/runs/${includeRunId}`), ...runs];
    const queue = runs.map(run => ({ run, depth: 0 }));
    const linked = new Set();
    const edges = new Map();
    const reaches = (from, to, visited = new Set()) => {
        if (from === to) return true;
        if (visited.has(from)) return false;
        visited.add(from);
        return [...(edges.get(from) ?? [])].some(next => reaches(next, to, visited));
    };
    const seen = new Set();
    for (const { run, reference, depth } of queue) {
        const seenKey = reference ? JSON.stringify(reference) : run.id;
        if (seen.has(seenKey)) continue;
        seen.add(seenKey);
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
        if (reference) {
            assert.equal(run.id, reference.runId, 'Referenced run identity differs');
            assert.equal(run.head_sha, reference.sourceSha, 'Referenced source SHA differs');
            assert.ok(
                reference.kind === 'partial-native'
                    ? failedNative
                    : isTrustedRun(run, repository) || failedRelease,
                'Referenced source run is untrusted',
            );
        }
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
            try {
                sourceTree = reader.tree
                    ? reader.tree(run.head_sha)
                    : api(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha;
            } catch (error) {
                if (!reader.tree) throw error;
                // A removed PR branch can still have its checked tree reachable through a squash merge.
                sourceTree = api(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha;
                sourceRef = sourceTree;
            }
        } catch (error) {
            // A native 404 removes this old source, never its required checks or identity guards.
            if (!isMissingGitHubProof(error)) throw error;
            continue;
        }
        const matching = [];
        const fullFrontendMatches = new Map();
        let sharedInputsMatch = false;
        try {
            sharedInputsMatch = sharedInputFingerprint(sourceRef, reader) === targetSharedInputs;
        } catch {
            // Missing historical objects cannot supply reusable evidence.
        }
        for (const check of [...missing.values(), ...originMissing.values()]) {
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
        if (!matching.length && sourceTree !== targetTree && !reference) continue;
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
                if (reference && !proofMissing) throw error;
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
            if (reference)
                for (const key of ['runAttempt', 'scopeJobId', 'scopeLogSha256'])
                    assert.equal(native.provenance[key], reference[key], 'Native source reference differs');
        } else {
            const trustedPr = hasTrustedPullRequest(run, repository, api);
            if (reference) assert.ok(trustedPr, 'Referenced PR source is untrusted');
            if (!trustedPr) continue;
            try {
                const artifacts = api(
                    `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
                ).artifacts;
                if (
                    reference &&
                    artifacts.some(
                        item =>
                            item.id === reference.artifactId &&
                            item.expired === true &&
                            item.name.startsWith(`ci-evidence-${run.id}-`),
                    )
                )
                    continue;
                artifact = artifacts
                    .filter(item => !item.expired && item.name.startsWith(`ci-evidence-${run.id}-`))
                    .sort((a, b) => b.id - a.id)
                    .find(item => !reference || item.id === reference.artifactId);
                if (reference) assert.ok(artifact, 'Referenced evidence artifact is unavailable');
                if (!artifact) continue;
                proof = proofReader(repository, artifact.id);
            } catch (error) {
                // Native expiry or 404 only removes this source, never required coverage.
                if (!isMissingGitHubProof(error)) throw error;
                continue;
            }
            const bound =
                [1, 2].includes(proof.version) &&
                proof.sourceSha === run.head_sha &&
                proof.tree === sourceTree &&
                String(proof.runId) === String(run.id);
            if (reference) assert.ok(bound, 'Referenced evidence is not bound to its native run');
            if (!bound) continue;
            if (reference)
                assert.equal(proofDigest(proof), reference.proofSha256, 'Referenced proof hash differs');
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
        // References come only from a verified, run-bound artifact. Every linked source
        // is fetched natively and passes the same provenance, coverage and input checks.
        // Squashed PR heads need not be linear ancestors of the target.
        const refs = checkedSourceRefs(proof.sourceRefs);
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
            const requested = missing.has(check.id);
            (requested ? missing : originMissing).delete(check.id);
            (requested ? reused : origins).push({
                check: check.id,
                runId: run.id,
                ...(native
                    ? { ...native.provenance, nativeJobs: native.jobs.get(check.id) }
                    : { artifactId: artifact.id, proofSha256: proofDigest(proof) }),
                sourceSha: run.head_sha,
                inputSha256: inputHash,
            });
        }
        if (!missing.size && !originMissing.size && anchor) break;
        if (refs.length) assert.ok(depth < MAX_SOURCE_DEPTH, 'Evidence source reference depth exceeded');
        for (const ref of refs) {
            assert.ok(!reaches(ref.runId, run.id), 'Cyclic evidence source references');
            if (!edges.has(run.id)) edges.set(run.id, new Set());
            edges.get(run.id).add(ref.runId);
            const key = JSON.stringify(ref);
            if (linked.has(key)) continue;
            assert.ok(linked.size < MAX_SOURCE_REFS, 'Evidence source reference count exceeded');
            linked.add(key);
            let sourceRun;
            try {
                sourceRun = api(`repos/${repository}/actions/runs/${ref.runId}`);
            } catch (error) {
                if (!isMissingGitHubProof(error)) throw error;
                continue;
            }
            queue.push({
                run: sourceRun,
                reference: ref,
                depth: depth + 1,
            });
        }
    }
    return {
        targetTree,
        anchor,
        reused,
        missing: [...missing.values()],
        ...(retainOrigins ? { origins } : {}),
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

export function executedEvidence(plan, inventory, results, source) {
    checkedSourceRefs(plan.sourceRefs);
    validateExecutedChecks(plan, inventory, results);
    return { ...plan, version: 2, tree: source.tree, sourceSha: source.sourceSha, runId: source.runId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, base, target = 'HEAD'] = process.argv.slice(2);
    if (command === 'write') {
        const plan = JSON.parse(base ? readFileSync(base, 'utf8') : process.env.CI_PLAN);
        writeFileSync(
            'ci-evidence.json',
            JSON.stringify(
                executedEvidence(plan, packageInventory(), JSON.parse(process.env.CI_JOB_RESULTS ?? '{}'), {
                    tree: git('rev-parse', 'HEAD^{tree}'),
                    sourceSha: git('rev-parse', 'HEAD'),
                    runId: process.env.GITHUB_RUN_ID,
                }),
            ) + '\n',
        );
    } else if (command === 'plan') {
        const repository = process.env.GITHUB_REPOSITORY;
        assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
        const full = process.argv[5] === 'true';
        const plan = releaseInspection(base, target, full);
        const coverage =
            full || !checkRequirements(plan, packageInventory()).length
                ? { missing: checkRequirements(plan, packageInventory()), reused: [] }
                : await findInputCoverage({
                      repository,
                      targetSha: git('rev-parse', target),
                      plan,
                      retainOrigins: true,
                  });
        const execution = {
            ...missingPlan(plan, coverage.missing),
            sourceRefs: reusedSourceReferences([...coverage.reused, ...(coverage.origins ?? [])]),
        };
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
