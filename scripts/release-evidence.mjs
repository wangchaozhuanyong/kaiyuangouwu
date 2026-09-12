import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { inspection, isDocumentation } from './ci-impact.mjs';

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
    return Boolean(
        run.pull_requests?.some(pr => {
            const current = api(`repos/${repository}/pulls/${pr.number}`);
            return current.head.repo?.full_name === repository && current.head.sha === run.head_sha;
        }),
    );
}

const gh = endpoint =>
    JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, base, target = 'HEAD'] = process.argv.slice(2);
    if (command === 'write') {
        const plan = JSON.parse(base ? readFileSync(base, 'utf8') : process.env.CI_PLAN);
        writeFileSync(
            'ci-evidence.json',
            JSON.stringify({
                ...plan,
                tree: git('rev-parse', 'HEAD^{tree}'),
                sourceSha: git('rev-parse', 'HEAD'),
                runId: process.env.GITHUB_RUN_ID,
            }) + '\n',
        );
    } else if (command === 'find') {
        const repository = process.env.GITHUB_REPOSITORY;
        assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
        const plan = inspection(base, target);
        const result = await findEvidence({
            repository,
            targetSha: git('rev-parse', target),
            requiredFiles: plan.files,
        });
        if (!result) output('run_id', '');
        else {
            const evidence = readProof(repository, result.artifactId);
            output(
                'run_id',
                evidence.tree === result.targetTree && coversChanges(evidence, plan.files)
                    ? result.runId
                    : '',
            );
        }
    } else if (command === 'verify') {
        const runId = process.argv[5];
        const repository = process.env.GITHUB_REPOSITORY;
        assert.match(runId ?? '', /^\d+$/u);
        assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
        const run = gh(`repos/${repository}/actions/runs/${runId}`);
        if (runId === process.env.GITHUB_RUN_ID) {
            const gates = gh(`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`).jobs.filter(job =>
                /(^|\/ )all-passed$/u.test(job.name),
            );
            assert.ok(
                gates.length > 0 && gates.every(job => job.conclusion === 'success'),
                'The current run has no successful applicable CI gate',
            );
        } else {
            assert.ok(isTrustedRun(run, repository), 'Untrusted or incomplete CI run');
            assert.ok(
                hasTrustedPullRequest(run, repository, gh),
                'CI evidence belongs to a fork or outdated PR head',
            );
        }
        const expectedTree = git('rev-parse', `${target}^{tree}`);
        assert.equal(
            gh(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha,
            expectedTree,
            'CI run source differs from release',
        );
        const artifacts = gh(`repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`).artifacts;
        const proof = artifacts
            .filter(artifact => !artifact.expired && artifact.name.startsWith(`ci-evidence-${runId}-`))
            .sort((a, b) => b.id - a.id)[0];
        assert.ok(proof, 'CI scope evidence is missing');
        const evidence = readProof(repository, proof.id);
        assert.equal(evidence.tree, expectedTree);
        assert.ok(
            coversChanges(evidence, inspection(base, target).files),
            'CI evidence does not cover all undeployed changes',
        );
        process.stdout.write('RELEASE_CI_VERIFIED\n');
    } else throw new Error('Expected write or find');
}
