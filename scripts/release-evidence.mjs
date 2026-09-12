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
} from './ci-check-inputs.mjs';
import { emitPlan, inspection, isDocumentation, packageInventory } from './ci-impact.mjs';

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
const gh = endpoint => {
    if (!apiCache.has(endpoint))
        apiCache.set(
            endpoint,
            JSON.parse(
                execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }),
            ),
        );
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

function readProof(repository, artifactId) {
    const archive = execFileSync('gh', ['api', `repos/${repository}/actions/artifacts/${artifactId}/zip`], {
        maxBuffer: 2 * 1024 * 1024,
    });
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
}) {
    assert.match(targetSha, /^[a-f0-9]{40}$/u);
    const targetTree = api(`repos/${repository}/git/commits/${targetSha}`).tree.sha;
    const required = checkRequirements(plan, inventory);
    const missing = new Map(required.map(check => [check.id, check]));
    const fingerprints = new Map(
        required.map(check => [check.id, checkFingerprint(targetSha, check, inventory, reader)]),
    );
    const reused = [];
    let anchor;
    let runs = api(`repos/${repository}/actions/runs?status=success&per_page=100`).workflow_runs;
    if (includeRunId) runs = [api(`repos/${repository}/actions/runs/${includeRunId}`), ...runs];
    const seen = new Set();
    for (const run of runs) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        const current = String(run.id) === String(currentRunId);
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
        } else if (!isTrustedRun(run, repository)) continue;
        if (!hasTrustedPullRequest(run, repository, api)) continue;
        const sourceTree = api(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha;
        const matching = [];
        for (const check of missing.values()) {
            try {
                if (checkFingerprint(run.head_sha, check, inventory, reader) === fingerprints.get(check.id))
                    matching.push(check);
            } catch {
                // A missing historical object or recipe supplies no evidence. Never widen the check scope.
            }
        }
        if (!matching.length && sourceTree !== targetTree) continue;
        const artifacts = api(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`).artifacts;
        const artifact = artifacts
            .filter(item => !item.expired && item.name.startsWith(`ci-evidence-${run.id}-`))
            .sort((a, b) => b.id - a.id)[0];
        if (!artifact) continue;
        const proof = proofReader(repository, artifact.id);
        if (
            ![1, 2].includes(proof.version) ||
            proof.sourceSha !== run.head_sha ||
            proof.tree !== sourceTree ||
            String(proof.runId) !== String(run.id)
        )
            continue;
        if (sourceTree === targetTree && !anchor) anchor = { runId: run.id, artifactId: artifact.id };
        for (const check of matching) {
            if (!checkCovered(proof, check, inventory)) continue;
            missing.delete(check.id);
            reused.push({
                check: check.id,
                runId: run.id,
                artifactId: artifact.id,
                sourceSha: run.head_sha,
                inputSha256: fingerprints.get(check.id),
            });
        }
        if (!missing.size && anchor) break;
    }
    return { targetTree, anchor, reused, missing: [...missing.values()] };
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
        const plan = inspection(base, target, full);
        const coverage =
            full || !checkRequirements(plan, packageInventory()).length
                ? { missing: checkRequirements(plan, packageInventory()), reused: [] }
                : await findInputCoverage({ repository, targetSha: git('rev-parse', target), plan });
        const execution = missingPlan(plan, coverage.missing);
        execution.reusedChecks = coverage.reused;
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
        const plan = inspection(base, target);
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
        const result = await findInputCoverage({
            repository,
            targetSha: git('rev-parse', target),
            plan: inspection(base, target),
            includeRunId: runId,
            currentRunId: process.env.GITHUB_RUN_ID,
        });
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
