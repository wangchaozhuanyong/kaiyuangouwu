import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function classifyFailure(logs, attempt = 1) {
    const codeFailure = [
        /TS\d{4}:|AssertionError|test.*failed|test failure|vulnerabilit|checksum.*(mismatch|differ)/iu,
        /not current main|requires a full|syntax error|migration.*(fail|blocked)|Permission denied|AccessDenied/iu,
    ].some(pattern => pattern.test(logs));
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command = 'report', runId = process.env.GITHUB_RUN_ID] = process.argv.slice(2);
    const repository = process.env.GITHUB_REPOSITORY;
    assert.match(repository ?? '', /^[\w.-]+\/[\w.-]+$/u);
    assert.match(runId ?? '', /^\d+$/u);
    const api = endpoint =>
        JSON.parse(execFileSync('gh', ['api', `repos/${repository}/${endpoint}`], { encoding: 'utf8' }));
    const run = api(`actions/runs/${runId}`);
    assert.ok(
        [
            '.github/workflows/production_release.yml',
            '.github/workflows/deploy_storefront_fast_lane.yml',
        ].includes(run.path),
        'Expected a production release entry',
    );
    const jobs = api(`actions/runs/${runId}/jobs?per_page=100`).jobs.filter(
        job => job.conclusion === 'failure' && !job.name.includes('recovery'),
    );
    const decisions = jobs.map(job => {
        let logs = '';
        try {
            logs = execFileSync('gh', ['api', `repos/${repository}/actions/jobs/${job.id}/logs`], {
                encoding: 'utf8',
                maxBuffer: 16 * 1024 * 1024,
            });
        } catch {
            /* Missing logs never authorize a retry. */
        }
        return {
            job: job.name,
            failedSteps: job.steps.filter(step => step.conclusion === 'failure').map(step => step.name),
            ...classifyFailure(logs, run.run_attempt),
        };
    });
    if (command === 'retry') {
        assert.equal(run.status, 'completed');
        assert.ok(
            decisions.length && decisions.every(decision => decision.retryAllowed),
            'Only one proven transient retry is allowed',
        );
        // This command is invoked by the operator only within an explicitly authorized release.
        execFileSync('gh', ['run', 'rerun', runId, '--repo', repository, '--failed'], { stdio: 'inherit' });
    } else {
        assert.equal(command, 'report');
        const summary =
            `## Release recovery\n\nTarget: ${run.head_sha}; run: ${runId}; attempt: ${run.run_attempt}.\n\n` +
            decisions
                .map(decision => `- ${decision.job}: ${decision.failedSteps.join(', ')}. ${decision.next}`)
                .join('\n') +
            '\n\nDo not mark the release complete until target-version and affected-function acceptance pass. ' +
            'Preserve the last healthy release; use the existing compatible rollback on deployment failure.\n';
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
        process.stdout.write(summary);
    }
}
