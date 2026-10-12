import yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { checkCovered, checkRequirements, requiredJobs } from './ci-check-inputs.mjs';
import { classifyChanges } from './ci-impact.mjs';

const workflowPath = '.github/workflows/build_and_test.yml';
const sha = /^[a-f0-9]{40}$/u;
const digest = value => createHash('sha256').update(value).digest('hex');
export function isFailedNativeSource(run, repository) {
    return (
        run.status === 'completed' &&
        run.conclusion === 'failure' &&
        ['pull_request', 'workflow_dispatch'].includes(run.event) &&
        run.path === workflowPath &&
        run.repository?.full_name === repository &&
        run.head_repository?.full_name === repository &&
        Number.isSafeInteger(run.repository?.id) &&
        run.repository.id > 0 &&
        run.head_repository.id === run.repository.id &&
        sha.test(run.head_sha) &&
        Number.isSafeInteger(run.id) &&
        run.id > 0 &&
        Number.isSafeInteger(run.run_attempt) &&
        run.run_attempt > 0
    );
}

export function hasNativePullRequestProvenance(run, repository, api) {
    if (run.event !== 'pull_request') return true;
    const associated = api(`repos/${repository}/commits/${run.head_sha}/pulls?per_page=100`);
    const references = run.pull_requests?.length ? run.pull_requests : associated;
    return references.some(reference => {
        if (!associated.some(pr => pr.number === reference.number)) return false;
        const current = api(`repos/${repository}/pulls/${reference.number}`);
        if (current.head?.repo?.full_name !== repository || !sha.test(current.head.sha)) return false;
        if (current.head.sha === run.head_sha) return true;
        const comparison = api(`repos/${repository}/compare/${run.head_sha}...${current.head.sha}`);
        return (
            comparison.status === 'ahead' &&
            comparison.base_commit?.sha === run.head_sha &&
            comparison.merge_base_commit?.sha === run.head_sha
        );
    });
}

function logData(text, run) {
    assert.ok(Buffer.byteLength(text) <= 2 * 1024 * 1024, 'Oversized native scope log');
    const lines = text.split('\n').map(line => line.replace(/^\d{4}-\d\d-\d\dT\S+\s/u, '').trimEnd());
    const source = lines.flatMap((line, index) =>
        /\[command\].*git log -1 --format=%H$/u.test(line) ? [lines[index + 1]?.trim()] : [],
    );
    assert.ok(
        source.length && source.every(value => value === run.head_sha),
        'Native checkout source mismatch',
    );
    const bases = lines.map(line => /^\s*BASE_SHA: ([a-f0-9]{40})$/u.exec(line)?.[1]).filter(Boolean);
    const full = lines.map(line => /^\s*FULL: (true|false)$/u.exec(line)?.[1]).filter(Boolean);
    assert.equal(bases.length, 1, 'Native scope base is missing or ambiguous');
    assert.equal(full.length, 1, 'Native full flag is missing or ambiguous');
    if (run.event === 'pull_request' && run.pull_requests?.length)
        assert.ok(
            run.pull_requests?.some(pr => pr.base?.sha === bases[0]),
            'Native PR base mismatch',
        );
    const objects = [];
    for (let start = 0; start < lines.length; start++) {
        if (lines[start].trim() !== '{' || !/^\s*"version":/u.test(lines[start + 1] ?? '')) continue;
        const end = lines.findIndex((line, index) => index > start && line === '}');
        assert.ok(end > start, 'Truncated native execution plan');
        objects.push(JSON.parse(lines.slice(start, end + 1).join('\n')));
        start = end;
    }
    assert.equal(objects.length, 1, 'Native execution plan is missing or ambiguous');
    const plan = objects[0];
    assert.equal(plan.version, 1, 'Unknown native execution plan version');
    assert.equal(plan.full, full[0] === 'true', 'Native full flag differs from execution plan');
    return { plan, baseSha: bases[0], logSha256: digest(text) };
}

export function parseNativeScopeLog(text, run, expectedPlan, inventory) {
    const parsed = logData(text, run);
    const checks = checkRequirements(parsed.plan, inventory);
    for (const key of ['files', 'packages', 'frontends', 'lintFiles']) {
        const values = parsed.plan[key] ?? (key === 'lintFiles' ? parsed.plan.files : null);
        assert.ok(Array.isArray(values) && values.length <= 10000, 'Invalid native scope ' + key);
        assert.equal(new Set(values).size, values.length, 'Duplicate native scope ' + key);
    }
    for (const check of checks)
        assert.ok(
            checkCovered(expectedPlan, check, inventory),
            'Native execution scope exceeds original changes: ' + check.id,
        );
    return parsed;
}

function matrixValues(value, plan) {
    if (Array.isArray(value)) return value;
    assert.equal(typeof value, 'string', 'Unsupported native matrix');
    if (/^\$\{\{\s*fromJSON\(needs.detect-changes.outputs.frontends\)\s*\}\}$/u.test(value))
        return plan.frontends;
    const node = /^\$\{\{\s*inputs.full && fromJSON\('([^']+)'\) \|\| fromJSON\('([^']+)'\)\s*\}\}$/u.exec(
        value,
    );
    assert.ok(node, 'Unrecognized native matrix expression');
    const values = JSON.parse(node[plan.full ? 1 : 2]);
    assert.ok(Array.isArray(values), 'Invalid native matrix values');
    return values;
}

export function expectedNativeJobNames(text, jobId, plan, readWorkflow, depth = 0) {
    assert.ok(depth < 3, 'Unsupported nested native workflow');
    const job = yaml.load(text)?.jobs?.[jobId];
    assert.ok(job, 'Missing source job recipe: ' + jobId);
    let variants = [{}];
    if (job.strategy?.matrix) {
        assert.ok(
            !job.strategy.matrix.include && !job.strategy.matrix.exclude,
            'Unsupported native matrix overrides',
        );
        for (const [key, value] of Object.entries(job.strategy.matrix))
            variants = variants.flatMap(variant =>
                matrixValues(value, plan).map(item => ({ ...variant, [key]: item })),
            );
    }
    assert.ok(variants.length && variants.length <= 100, 'Invalid native job matrix size');
    const template = String(job.name ?? jobId);
    const names = variants.map(variant => {
        const rendered = template.replace(/\$\{\{\s*matrix\.([a-z]+)\s*\}\}/gu, (_, key) => {
            assert.ok(key in variant, 'Unbound native matrix job name');
            return String(variant[key]);
        });
        return job.strategy?.matrix && !template.includes('${{')
            ? rendered + ' (' + Object.values(variant).join(', ') + ')'
            : rendered;
    });
    assert.ok(
        names.every(name => !name.includes('${{')),
        'Unsupported native job name expression',
    );
    if (!job.uses) return names;
    assert.match(
        job.uses,
        /^\.\/\.github\/workflows\/[a-z_-]+\.yml$/u,
        'Unsupported native reusable workflow',
    );
    const child = readWorkflow(job.uses.slice(2));
    const childJobs = Object.keys(yaml.load(child)?.jobs ?? {});
    assert.ok(childJobs.length, 'Missing native reusable workflow jobs');
    return names.flatMap(prefix =>
        childJobs.flatMap(id =>
            expectedNativeJobNames(child, id, plan, readWorkflow, depth + 1).map(
                name => prefix + ' / ' + name,
            ),
        ),
    );
}

const successful = (job, run) =>
    job.status === 'completed' &&
    job.conclusion === 'success' &&
    job.run_id === run.id &&
    job.run_attempt === run.run_attempt &&
    job.head_sha === run.head_sha &&
    Number.isSafeInteger(job.id) &&
    job.id > 0;

/** Native success jobs are individual observations, never a successful failed gate or a source anchor. */
export async function loadNativeCoverage({ run, repository, sourceTree, reader, inventory, api, logReader }) {
    assert.ok(isFailedNativeSource(run, repository), 'Untrusted failed native source');
    const attempt = api(`repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`);
    for (const key of ['id', 'head_sha', 'run_attempt', 'path', 'event', 'status', 'conclusion'])
        assert.equal(attempt[key], run[key], 'Native attempt metadata mismatch: ' + key);
    assert.equal(attempt.repository?.id, run.repository.id, 'Native attempt repository mismatch');
    assert.equal(attempt.head_repository?.id, run.repository.id, 'Native attempt head repository mismatch');
    assert.equal(attempt.repository?.full_name, repository, 'Native attempt repository name mismatch');
    assert.equal(
        attempt.head_repository?.full_name,
        repository,
        'Native attempt head repository name mismatch',
    );
    assert.equal(
        api(`repos/${repository}/git/commits/${run.head_sha}`).tree.sha,
        sourceTree,
        'Native source tree mismatch',
    );
    assert.equal(reader.tree(run.head_sha), sourceTree, 'Native reader tree mismatch');
    const response = api(
        `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
    );
    assert.ok(
        response.jobs?.length === response.total_count && response.total_count <= 100,
        'Incomplete native attempt jobs',
    );
    const text = reader.text(run.head_sha, workflowPath);
    const names = expectedNativeJobNames(text, 'detect-changes', { full: false }, path =>
        reader.text(run.head_sha, path),
    );
    assert.equal(names.length, 1, 'Ambiguous native detection job');
    const detection = response.jobs.filter(job => job.name === names[0]);
    assert.equal(detection.length, 1, 'Missing or duplicated native detection job');
    assert.ok(
        successful(detection[0], run),
        'Native detection job did not pass on the declared source and attempt',
    );
    const log = await logReader(repository, detection[0].id);
    const raw = logData(log, run);
    const ancestry = api(`repos/${repository}/compare/${raw.baseSha}...${run.head_sha}`);
    assert.ok(
        ['ahead', 'identical'].includes(ancestry.status) &&
            ancestry.base_commit?.sha === raw.baseSha &&
            ancestry.merge_base_commit?.sha === raw.baseSha,
        'Native logged base is not an ancestor of checked source',
    );
    const base = new Map(reader.entries(raw.baseSha).map(entry => [entry.path, entry.metadata]));
    const source = new Map(reader.entries(run.head_sha).map(entry => [entry.path, entry.metadata]));
    const files = [...new Set([...base.keys(), ...source.keys()])].filter(
        path => base.get(path) !== source.get(path),
    );
    const expected = classifyChanges(files, inventory, { full: raw.plan.full });
    const scope = parseNativeScopeLog(log, run, expected, inventory);
    const checks = new Set();
    const jobs = new Map();
    for (const check of checkRequirements(scope.plan, inventory)) {
        const needed = requiredJobs(check, scope.plan.full).flatMap(id =>
            expectedNativeJobNames(text, id, scope.plan, path => reader.text(run.head_sha, path)),
        );
        const selected = needed.flatMap(name => response.jobs.filter(job => job.name === name));
        if (
            needed.length !== new Set(needed).size ||
            selected.length !== needed.length ||
            needed.some(name => selected.filter(job => job.name === name).length !== 1) ||
            selected.some(job => !successful(job, run))
        )
            continue;
        checks.add(check.id);
        jobs.set(
            check.id,
            selected.map(job => ({ id: job.id, name: job.name })),
        );
    }
    return {
        plan: scope.plan,
        checks,
        jobs,
        provenance: {
            evidenceKind: 'partial-native',
            sourceRunConclusion: 'failure',
            runAttempt: run.run_attempt,
            scopeJobId: detection[0].id,
            scopeLogSha256: scope.logSha256,
            baseSha: scope.baseSha,
            sourceTree,
        },
    };
}
