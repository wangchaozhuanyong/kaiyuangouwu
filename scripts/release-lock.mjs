import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const releasePaths = new Set([
    '.github/workflows/production_release.yml',
    '.github/workflows/deploy_storefront_fast_lane.yml',
]);

export function staleTargetRejected(run, jobs, jobLog, target) {
    if (run.status !== 'completed' || run.conclusion !== 'failure') return false;
    const locks = jobs.filter(job => job.name === 'lock exact revision and reject duplicate full runs');
    if (locks.length !== 1 || locks[0].conclusion !== 'failure' || locks[0].head_sha !== run.head_sha)
        return false;
    const declared = [...jobLog.matchAll(/^\d{4}-\d\d-\d\dT\S+ +TARGET_SHA: ([a-f0-9]{40})\r?$/gmu)];
    return (
        declared.length === 1 &&
        declared[0][1] !== target &&
        jobLog.includes(`target_sha is not current main; start a new release for ${target}`)
    );
}

export function earlierReleases(runs, target, current) {
    return runs
        .filter(run => run.head_sha === target && run.id < current && releasePaths.has(run.path))
        .sort((left, right) => left.id - right.id);
}

export function readReleaseRuns(repository, execute = execFileSync) {
    const projection = '{workflow_runs: [.workflow_runs[] | {id,head_sha,path,status,conclusion,html_url}]}';
    const raw = execute(
        'gh',
        ['api', `repos/${repository}/actions/runs?branch=main&per_page=100`, '--jq', projection],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(raw).workflow_runs;
}

function main() {
    const env = process.env;
    const target = env.TARGET_SHA;
    assert.equal(env.GITHUB_REF, 'refs/heads/main');
    assert.match(target, /^[a-f0-9]{40}$/u);
    assert.match(env.GITHUB_RUN_ID, /^[1-9][0-9]*$/u);
    const prefix = `repos/${env.GITHUB_REPOSITORY}`;
    const api = path => execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const json = path => JSON.parse(api(path));
    const latest = json(`${prefix}/git/ref/heads/main`).object.sha;
    assert.equal(latest, target, `target_sha is not current main; start a new release for ${latest}`);
    const runs = readReleaseRuns(env.GITHUB_REPOSITORY);
    for (const run of earlierReleases(runs, target, Number(env.GITHUB_RUN_ID))) {
        if (run.status === 'completed' && run.conclusion === 'failure') {
            const jobs = json(`${prefix}/actions/runs/${run.id}/jobs?per_page=100`).jobs;
            const lock = jobs.filter(
                job => job.name === 'lock exact revision and reject duplicate full runs',
            );
            if (lock.length === 1 && lock[0].conclusion === 'failure') {
                const log = api(`${prefix}/actions/jobs/${lock[0].id}/logs`);
                if (staleTargetRejected(run, jobs, log, target)) {
                    process.stdout.write(
                        `Ignored stale-target rejection ${run.id}; no production stage ran.\n`,
                    );
                    continue;
                }
            }
        }
        assert.equal(
            run.status === 'completed' && run.conclusion === 'success',
            true,
            `Release ${target} already has run ${run.id}. Diagnose that fixed run: node deploy/release-recovery.mjs report ${run.id}; do not redispatch.`,
        );
        process.stdout.write(
            `Previous successful release: ${run.html_url}; verify live component versions before deciding to deploy.\n`,
        );
    }
    if (env.GITHUB_STEP_SUMMARY)
        appendFileSync(
            env.GITHUB_STEP_SUMMARY,
            `## Locked production release\n\n- Target SHA: ${target}\n- Workflow run: ${env.GITHUB_RUN_ID}\n`,
        );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
