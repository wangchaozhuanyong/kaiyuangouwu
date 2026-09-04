import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
