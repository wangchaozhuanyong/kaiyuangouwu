import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBunAuditEvidence } from './production-runtime-audit-evidence.mjs';
import {
    auditRuntimePackages,
    createRuntimeAuditReport,
    matchRuntimeAdvisories,
    parseSavedBunAuditEvidence,
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

void test('bun audit retries a transient request timeout and returns the next valid report', async () => {
    let attempts = 0;
    const report = await runBunAudit('/tmp/runtime-audit-fixture', {
        commandRunner: () => {
            attempts += 1;
            return attempts === 1
                ? { stderr: 'Timeout: audit request failed', stdout: '' }
                : { stderr: '', stdout: JSON.stringify(audit) };
        },
        maxAttempts: 3,
        retryDelayMs: 0,
    });

    assert.equal(attempts, 2);
    assert.deepEqual(report, audit);
});

void test('bun audit remains fail-closed after bounded transient retries', async () => {
    let attempts = 0;

    await assert.rejects(
        () =>
            runBunAudit('/tmp/runtime-audit-fixture', {
                commandRunner: () => {
                    attempts += 1;
                    return { stderr: 'Timeout: audit request failed', stdout: '' };
                },
                maxAttempts: 3,
                retryDelayMs: 0,
            }),
        /bun audit failed after 3 attempt\(s\).*Timeout: audit request failed/su,
    );
    assert.equal(attempts, 3);
});

void test('bun audit retries the ConnectionClosed response returned by the registry', async () => {
    let attempts = 0;
    const report = await runBunAudit('/tmp/runtime-audit-fixture', {
        commandRunner: (_command, commandArguments) => {
            attempts += 1;
            assert.deepEqual(commandArguments, ['audit', '--json', '--audit-level', 'high']);
            return attempts === 1
                ? { status: 1, stderr: 'ConnectionClosed: audit request failed', stdout: '' }
                : { status: 0, stderr: '', stdout: JSON.stringify(audit) };
        },
        auditLevel: 'high',
        maxAttempts: 3,
        requireSuccessfulExit: true,
        retryDelayMs: 0,
    });

    assert.equal(attempts, 2);
    assert.deepEqual(report, audit);
});

void test('bun audit does not retry a valid report that fails the requested policy', async () => {
    let attempts = 0;

    await assert.rejects(
        () =>
            runBunAudit('/tmp/runtime-audit-fixture', {
                commandRunner: () => {
                    attempts += 1;
                    return { status: 1, stderr: '', stdout: JSON.stringify(audit) };
                },
                auditLevel: 'high',
                maxAttempts: 3,
                requireSuccessfulExit: true,
                retryDelayMs: 0,
            }),
        /bun audit failed after 1 attempt\(s\): bun audit policy failed with exit code 1/u,
    );
    assert.equal(attempts, 1);
});

void test('bun audit does not retry malformed non-network output', async () => {
    let attempts = 0;

    await assert.rejects(
        () =>
            runBunAudit('/tmp/runtime-audit-fixture', {
                commandRunner: () => {
                    attempts += 1;
                    return { stderr: 'unexpected audit response', stdout: '' };
                },
                maxAttempts: 3,
                retryDelayMs: 0,
            }),
        /bun audit failed after 1 attempt\(s\).*unexpected audit response/su,
    );
    assert.equal(attempts, 1);
});

void test('runtime audit reuses saved high-severity audit evidence', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-audit-'));
    const auditReportPath = path.join(fixtureRoot, 'bun-audit.json');
    const lockfileSha256 = 'a'.repeat(64);
    try {
        await writeFile(auditReportPath, `${JSON.stringify({ format: 1, lockfileSha256, report: audit })}\n`);

        const report = await auditRuntimePackages(fixtureRoot, packages, {
            auditReportPath,
            expectedLockfileSha256: lockfileSha256,
            failOn: 'critical',
        });

        assert.deepEqual(report.summary, { critical: 0, high: 1, low: 0, moderate: 0, total: 1 });
        assert.deepEqual(
            JSON.parse(await readFile(path.join(fixtureRoot, 'RUNTIME-AUDIT.json'), 'utf8')),
            report,
        );
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('saved runtime audit evidence remains fail-closed when it is invalid', () => {
    assert.throws(() => parseSavedBunAuditEvidence('Timeout: audit request failed', 'a'.repeat(64)), {
        message: 'Could not parse saved bun audit evidence JSON:\nTimeout: audit request failed',
    });
    assert.throws(
        () =>
            parseSavedBunAuditEvidence(
                JSON.stringify({ format: 1, lockfileSha256: 'b'.repeat(64), report: audit }),
                'a'.repeat(64),
            ),
        /does not match the source lockfile/u,
    );
});

void test('audit evidence retries transient requests and binds the report to the lockfile', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-audit-evidence-'));
    const lockfilePath = path.join(fixtureRoot, 'bun.lock');
    const outputPath = path.join(fixtureRoot, 'audit-evidence.json');
    let attempts = 0;
    try {
        await writeFile(lockfilePath, 'fixture-lockfile');
        const evidence = await createBunAuditEvidence({
            auditLevel: 'high',
            commandRunner: () => {
                attempts += 1;
                return attempts === 1
                    ? { status: 1, stderr: 'ConnectionClosed: audit request failed', stdout: '' }
                    : { status: 0, stderr: '', stdout: JSON.stringify(audit) };
            },
            lockfilePath: 'bun.lock',
            maxAttempts: 3,
            outputPath,
            repositoryRoot: fixtureRoot,
            retryDelayMs: 0,
        });

        assert.equal(attempts, 2);
        assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), evidence);
        assert.equal((await stat(outputPath)).mode % 0o1000, 0o600);
        assert.equal(
            evidence.lockfileSha256,
            '28cf8bb74277e5d7e258f409525fd7937480f253caf5278c03ddbf7f1c4223a7',
        );
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});
