import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { checkCovered, checkRequirements, requiredJobs } from './ci-check-inputs.mjs';
import { classifyChanges } from './ci-impact.mjs';

const workflowPath = '.github/workflows/build_and_test.yml';
const sha = /^[a-f0-9]{40}$/u;
const digest = value => createHash('sha256').update(value).digest('hex');

// Detection runs before dependency installation. This deliberately reads only the
// checked workflow's explicit job identities; unsupported YAML cannot grant reuse.
function sourceJobs(text) {
    const lines = text.replace(/\r\n/gu, '\n').split('\n');
    const roots = lines.filter(line => line && !/^[\s#]/u.test(line));
    assert.ok(
        roots.every(line => /^(name|on|env|concurrency|permissions|defaults|jobs|run-name):/u.test(line)),
        'Unsupported native workflow root',
    );
    const headers = roots.filter(line => /^jobs:/u.test(line));
    assert.ok(headers.length === 1 && headers[0] === 'jobs:', 'Missing or ambiguous native jobs block');
    const start = lines.indexOf('jobs:') + 1;
    const jobs = new Map();
    let current;
    for (const line of lines.slice(start)) {
        if (line && !/^\s|#/u.test(line)) break;
        if (!line.trim() || /^\s*#/u.test(line)) continue;
        assert.ok(!line.startsWith('\t'), 'Unsupported native indentation');
        if (/^ {4}\S/u.test(line)) {
            const match = /^ {4}([a-zA-Z_][\w-]*):\s*$/u.exec(line);
            assert.ok(match && !jobs.has(match[1]), 'Unsupported or duplicated native job');
            current = [];
            jobs.set(match[1], current);
        } else {
            assert.ok(current && /^ {8}/u.test(line), 'Unsupported native job indentation');
            current.push(line);
        }
    }
    assert.ok(jobs.size, 'Missing native workflow jobs');
    return jobs;
}

function sourceScalar(raw) {
    const value = raw.trim();
    assert.ok(value && !/^[&*!>|{[]/u.test(value), 'Unsupported native scalar');
    if (value.startsWith('"')) {
        const parsed = JSON.parse(value);
        assert.equal(typeof parsed, 'string', 'Invalid native quoted scalar');
        return parsed;
    }
    if (value.startsWith("'")) {
        assert.match(value, /^'(?:[^']|'')*'$/u, 'Invalid native quoted scalar');
        return value.slice(1, -1).replace(/''/gu, "'");
    }
    assert.ok(!/\s#|\t/u.test(value), 'Unsupported native scalar comment or indentation');
    return value;
}

function sourceList(raw) {
    assert.match(raw, /^\[.*\]$/u, 'Unsupported native matrix list');
    const parts = raw.slice(1, -1).match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/gu) ?? [];
    assert.equal(
        parts.join(',').replace(/\s/gu, ''),
        raw.slice(1, -1).replace(/\s/gu, ''),
        'Invalid native matrix separator',
    );
    assert.ok(parts.length && parts.length <= 100, 'Invalid native matrix values');
    return parts.map(part => {
        const value = sourceScalar(part);
        if (/^-?\d+$/u.test(value)) return Number(value);
        assert.ok(!/[:\[\]{},]/u.test(value), 'Unsupported native matrix object');
        return value;
    });
}

function sourceJob(text, jobId) {
    const lines = sourceJobs(text).get(jobId);
    assert.ok(lines, 'Missing source job recipe: ' + jobId);
    const job = {};
    let inStrategy = false;
    let inMatrix = false;
    for (const line of lines) {
        if (/^ {8}\S/u.test(line)) {
            inStrategy = false;
            inMatrix = false;
            assert.ok(!/^ {8}<</u.test(line), 'Unsupported native job merge');
            const field = /^ {8}(name|uses|strategy):\s*(.*)$/u.exec(line);
            if (!field) continue;
            assert.ok(!(field[1] in job), 'Duplicate native job metadata');
            if (field[1] === 'strategy') {
                assert.equal(field[2], '', 'Unsupported native strategy shape');
                job.strategy = {};
                inStrategy = true;
            } else job[field[1]] = sourceScalar(field[2]);
        } else if (inStrategy && /^ {12}\S/u.test(line)) {
            inMatrix = false;
            assert.ok(!/^ {12}<</u.test(line), 'Unsupported native strategy merge');
            const field = /^ {12}matrix:\s*(.*)$/u.exec(line);
            if (!field) continue;
            assert.ok(!job.strategy.matrix, 'Duplicate native matrix');
            assert.equal(field[1], '', 'Unsupported native matrix shape');
            job.strategy.matrix = {};
            inMatrix = true;
        } else if (inMatrix) {
            const axis = /^ {16}([a-zA-Z_][\w-]*):\s*(\S.*)$/u.exec(line);
            assert.ok(
                axis && !['include', 'exclude'].includes(axis[1]),
                'Unsupported native matrix structure',
            );
            assert.ok(!(axis[1] in job.strategy.matrix), 'Duplicate native matrix axis');
            job.strategy.matrix[axis[1]] = axis[2].startsWith('[')
                ? sourceList(axis[2])
                : sourceScalar(axis[2]);
        }
    }
    return job;
}
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
    const job = sourceJob(text, jobId);
    let variants = [{}];
    if (job.strategy?.matrix) {
        assert.ok(
            !job.strategy.matrix.include && !job.strategy.matrix.exclude,
            'Unsupported native matrix overrides',
        );
        for (const [key, value] of Object.entries(job.strategy.matrix)) {
            const values = matrixValues(value, plan);
            assert.ok(variants.length * values.length <= 100, 'Oversized native matrix');
            variants = variants.flatMap(variant => values.map(item => ({ ...variant, [key]: item })));
        }
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
    const childJobs = [...sourceJobs(child).keys()];
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
