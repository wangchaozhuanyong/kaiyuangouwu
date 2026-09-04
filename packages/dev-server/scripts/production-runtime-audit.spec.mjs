import assert from 'node:assert/strict';
import test from 'node:test';

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
        { error: undefined, status: 1, stderr: 'Timeout: audit request failed', stdout: '' },
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
