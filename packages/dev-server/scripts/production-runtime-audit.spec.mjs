import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    createRuntimeAuditReport,
    matchRuntimeAdvisories,
    runBunAudit,
} from './production-runtime-audit.mjs';

const packages = [
    { name: 'safe-package', path: 'node_modules/safe-package', version: '2.0.0' },
    { name: 'vulnerable-package', path: 'node_modules/vulnerable-package', version: '1.2.3' },
];
const audit = {
    'safe-package': [
        {
            id: 1,
            severity: 'high',
            title: 'Patched in 2.0.0',
            url: 'https://example.com/1',
            vulnerable_versions: '<2.0.0',
        },
    ],
    'vulnerable-package': [
        {
            id: 2,
            severity: 'high',
            title: 'Affected before 1.3.0',
            url: 'https://example.com/2',
            vulnerable_versions: '<1.3.0',
        },
    ],
};

void test('runtime audit matches advisory ranges against exact artifact versions', () => {
    assert.deepEqual(matchRuntimeAdvisories(packages, audit), [
        {
            id: '2',
            name: 'vulnerable-package',
            path: 'node_modules/vulnerable-package',
            severity: 'high',
            title: 'Affected before 1.3.0',
            url: 'https://example.com/2',
            version: '1.2.3',
            vulnerableVersions: '<1.3.0',
        },
    ]);
});

void test('runtime audit policy can report High findings while blocking Critical by default', () => {
    const { blockedFindings, report } = createRuntimeAuditReport(packages, audit);

    assert.equal(blockedFindings.length, 0);
    assert.deepEqual(report.summary, { critical: 0, high: 1, low: 0, moderate: 0, total: 1 });
});

void test('runtime audit policy can be tightened to block High findings', () => {
    const { blockedFindings } = createRuntimeAuditReport(packages, audit, { failOn: 'high' });

    assert.equal(blockedFindings.length, 1);
});

void test('bun audit retries an explicit transport timeout and returns the next valid report', async () => {
    const results = [
        {
            error: undefined,
            status: 1,
            stderr: 'Timeout: audit request failed',
            stdout: 'bun audit v1.3.14',
        },
        { error: undefined, status: 0, stderr: '', stdout: JSON.stringify(audit) },
    ];
    const retryEvents = [];
    const waits = [];
    let calls = 0;

    const report = await runBunAudit('/repository', {
        maxAttempts: 3,
        onRetry: event => retryEvents.push(event),
        retryDelaysMs: [15, 60],
        runCommand: () => results[calls++],
        wait: async delayMs => waits.push(delayMs),
    });

    assert.deepEqual(report, audit);
    assert.equal(calls, 2);
    assert.deepEqual(retryEvents, [{ attempt: 1, delayMs: 15 }]);
    assert.deepEqual(waits, [15]);
});

void test('bun audit fails closed after the bounded timeout retries are exhausted', async () => {
    let calls = 0;

    await assert.rejects(
        runBunAudit('/repository', {
            maxAttempts: 3,
            onRetry: () => undefined,
            retryDelaysMs: [0, 0],
            runCommand: () => {
                calls += 1;
                return {
                    error: undefined,
                    status: 1,
                    stderr: 'Timeout: audit request failed',
                    stdout: '',
                };
            },
            wait: async () => undefined,
        }),
        /Could not parse bun audit JSON after 3 of 3 attempts/u,
    );
    assert.equal(calls, 3);
});

void test('bun audit does not retry unrelated malformed output', async () => {
    let calls = 0;

    await assert.rejects(
        runBunAudit('/repository', {
            maxAttempts: 3,
            onRetry: () => undefined,
            retryDelaysMs: [0, 0],
            runCommand: () => {
                calls += 1;
                return { error: undefined, status: 1, stderr: 'unexpected response', stdout: '' };
            },
            wait: async () => undefined,
        }),
        /Could not parse bun audit JSON after 1 of 3 attempts/u,
    );
    assert.equal(calls, 1);
});

void test('bun audit gate fails immediately when valid JSON reports a policy violation', async () => {
    let calls = 0;
    const highAudit = {
        'vulnerable-package': [
            {
                severity: 'high',
                title: 'Affected before 1.3.0',
                url: 'https://example.com/2',
            },
        ],
    };

    await assert.rejects(
        runBunAudit('/repository', {
            auditLevel: 'high',
            maxAttempts: 3,
            onRetry: () => undefined,
            retryDelaysMs: [0, 0],
            runCommand: () => {
                calls += 1;
                return { error: undefined, status: 1, stderr: '', stdout: JSON.stringify(highAudit) };
            },
            wait: async () => undefined,
        }),
        /bun audit policy failed \(high\+\): vulnerable-package high Affected before 1\.3\.0/u,
    );
    assert.equal(calls, 1);
});

void test('bun audit gate accepts exit status 1 when parsed findings are below the configured level', async () => {
    const moderateAudit = {
        'moderate-package': [
            {
                severity: 'moderate',
                title: 'Moderate advisory',
                url: 'https://example.com/moderate',
            },
        ],
    };
    const report = await runBunAudit('/repository', {
        auditLevel: 'high',
        runCommand: () => ({
            error: undefined,
            status: 1,
            stderr: 'bun audit v1.3.14',
            stdout: JSON.stringify(moderateAudit),
        }),
    });

    assert.deepEqual(report, moderateAudit);
});

void test('bun audit gate rejects an unexpected non-policy exit code', async () => {
    await assert.rejects(
        runBunAudit('/repository', {
            auditLevel: 'high',
            runCommand: () => ({
                error: undefined,
                status: 2,
                stderr: '',
                stdout: JSON.stringify({}),
            }),
        }),
        /bun audit exited unexpectedly with code 2/u,
    );
});

void test('bun audit gate fails closed when parsed JSON does not contain advisory arrays', async () => {
    await assert.rejects(
        runBunAudit('/repository', {
            auditLevel: 'high',
            runCommand: () => ({
                error: undefined,
                status: 1,
                stderr: '',
                stdout: JSON.stringify({ error: 'registry unavailable' }),
            }),
        }),
        /bun audit entry for error must be an array/u,
    );
});

void test('repository and production workflows use the fail-closed retrying audit gate', async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    for (const workflowPath of [
        '.github/workflows/build_and_test.yml',
        '.github/workflows/build_production_runtime.yml',
    ]) {
        const workflow = await readFile(path.join(repositoryRoot, workflowPath), 'utf8');
        assert.match(
            workflow,
            /node packages\/dev-server\/scripts\/production-runtime-audit\.mjs --audit-level high/u,
        );
        assert.doesNotMatch(workflow, /run: bun audit --audit-level high/u);
    }
});
