import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    auditRuntimePackages,
    createRuntimeAuditReport,
    matchRuntimeAdvisories,
    parseSavedBunAuditEvidence,
    runBunAudit,
    writeBunAuditEvidence,
} from './production-runtime-audit.mjs';
void test('cache backport verifies aliases and runtime bytes without hiding raw high findings', async () => {
    const { cp, mkdir, symlink } = await import('node:fs/promises');
    const { HTTP_CACHE_PATCH, BRACES_PATCH, verifyHttpCachePatch } =
        await import('./production-runtime-audit.mjs');
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-cache-patch-'));
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const installed = path.join(repositoryRoot, 'node_modules/http-cache-semantics');
    const localCopy = path.join(root, 'node_modules/http-cache-semantics');
    const nestedCopy = path.join(root, 'packages/fixture/node_modules/cache-alias');
    const registration = JSON.stringify({
        patchedDependencies: { 'http-cache-semantics@4.2.0': HTTP_CACHE_PATCH.path },
    });
    const cacheReport = {
        'http-cache-semantics': [
            {
                id: 1,
                severity: 'high',
                title: 'max-stale must not bypass reuse restrictions',
                url: HTTP_CACHE_PATCH.advisory,
                vulnerable_versions: '<=4.2.0',
            },
        ],
        // A build-only advisory must not require a missing package in the runtime artifact.
        braces: [
            {
                id: 2,
                severity: 'high',
                title: 'build-only braces',
                url: BRACES_PATCH.advisory,
                vulnerable_versions: '<=3.0.3',
            },
        ],
    };
    const inventory = [
        {
            name: HTTP_CACHE_PATCH.package,
            version: HTTP_CACHE_PATCH.version,
            path: 'node_modules/http-cache-semantics',
        },
    ];
    const onlyCache = { 'http-cache-semantics': cacheReport['http-cache-semantics'] };
    const run = report =>
        runBunAudit(root, {
            auditLevel: 'high',
            runCommand: () => ({ status: 1, stdout: JSON.stringify(report), stderr: '' }),
        });
    try {
        await mkdir(path.join(root, 'patches'), { recursive: true });
        await cp(path.join(repositoryRoot, HTTP_CACHE_PATCH.path), path.join(root, HTTP_CACHE_PATCH.path));
        await writeFile(path.join(root, 'package.json'), registration);
        await writeFile(path.join(root, 'bun.lock'), registration);
        await cp(installed, localCopy, { recursive: true });
        await cp(installed, nestedCopy, { recursive: true });
        const verified = verifyHttpCachePatch(root);
        assert.equal(verified.copies.length, 2);
        assert.deepEqual(await run(onlyCache), onlyCache);
        const saved = path.join(root, 'saved-audit.json');
        writeBunAuditEvidence(saved, path.join(root, 'bun.lock'), cacheReport);
        const lockSha = createHash('sha256').update(registration).digest('hex');
        const runtime = await auditRuntimePackages(root, inventory, {
            auditReportPath: saved,
            expectedLockfileSha256: lockSha,
            failOn: 'high',
        });
        assert.equal(runtime.summary.high, 1);
        assert.equal(runtime.findings[0].url, HTTP_CACHE_PATCH.advisory);
        assert.equal(runtime.verifiedPatches[0].patchSha256, HTTP_CACHE_PATCH.sha256);
        assert.throws(
            () =>
                verifyHttpCachePatch(root, {
                    runtimePackages: [{ ...inventory[0], version: '4.1.0' }],
                    requireRegistration: false,
                }),
            /inventory version does not match/u,
        );
        const critical = {
            'http-cache-semantics': [{ ...onlyCache['http-cache-semantics'][0], severity: 'critical' }],
        };
        await assert.rejects(run(critical), /policy failed/u);
        const unknown = {
            'http-cache-semantics': [
                { ...onlyCache['http-cache-semantics'][0], url: 'https://example.com/another-high' },
            ],
        };
        await assert.rejects(run(unknown), /policy failed/u);
        const spoofed = createRuntimeAuditReport([{ ...inventory[0], version: '4.1.0' }], onlyCache, {
            failOn: 'high',
            verifiedPatches: [verified],
        });
        assert.equal(spoofed.blockedFindings.length, 1);
        await writeFile(path.join(nestedCopy, 'index.js'), '// unpatched alias');
        assert.throws(() => verifyHttpCachePatch(root), /fingerprint mismatch/u);
        await cp(path.join(installed, 'index.js'), path.join(nestedCopy, 'index.js'));
        await writeFile(path.join(localCopy, 'index.js'), '// changed runtime cache');
        await assert.rejects(
            auditRuntimePackages(root, inventory, {
                auditReportPath: saved,
                expectedLockfileSha256: lockSha,
                failOn: 'high',
            }),
            /fingerprint mismatch/u,
        );
        await cp(path.join(installed, 'index.js'), path.join(localCopy, 'index.js'));
        const manifest = await readFile(path.join(nestedCopy, 'package.json'), 'utf8');
        await writeFile(path.join(nestedCopy, 'package.json'), manifest.replace('"4.2.0"', '"4.1.0"'));
        assert.throws(() => verifyHttpCachePatch(root), /version does not match/u);
        await writeFile(path.join(nestedCopy, 'package.json'), manifest);
        await rm(path.join(nestedCopy, 'index.js'));
        assert.throws(() => verifyHttpCachePatch(root), /ENOENT/u);
        await cp(path.join(installed, 'index.js'), path.join(nestedCopy, 'index.js'));
        await writeFile(path.join(root, HTTP_CACHE_PATCH.path), '// altered patch source');
        assert.throws(() => verifyHttpCachePatch(root), /source fingerprint mismatch/u);
        await cp(path.join(repositoryRoot, HTTP_CACHE_PATCH.path), path.join(root, HTTP_CACHE_PATCH.path));
        await writeFile(path.join(root, 'bun.lock'), '{}');
        assert.throws(() => verifyHttpCachePatch(root), /frozen lockfile/u);
        await writeFile(path.join(root, 'bun.lock'), registration);
        await writeFile(path.join(root, 'package.json'), '{}');
        assert.throws(() => verifyHttpCachePatch(root), /registration/u);
        await writeFile(path.join(root, 'package.json'), registration);
        const external = path.join(root, 'node_modules/external-cache');
        await symlink(installed, external);
        assert.throws(() => verifyHttpCachePatch(root), /outside the audited tree/u);
        await rm(external);
        await rm(path.join(root, 'node_modules'), { recursive: true });
        await rm(path.join(root, 'packages'), { recursive: true });
        assert.throws(() => verifyHttpCachePatch(root), /No installed/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

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

void test('bun audit retries an explicit timeout and returns the next valid report', async () => {
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
        maxAttempts: 2,
        onRetry: event => retryEvents.push(event),
        retryDelaysMs: [15],
        runCommand: () => results[calls++],
        wait: async delayMs => waits.push(delayMs),
    });

    assert.deepEqual(report, audit);
    assert.equal(calls, 2);
    assert.deepEqual(retryEvents, [{ attempt: 1, delayMs: 15 }]);
    assert.deepEqual(waits, [15]);
});

void test('bun audit retries the observed ConnectionClosed transport failure', async () => {
    const results = [
        {
            error: undefined,
            status: 1,
            stderr: 'ConnectionClosed: audit request failed',
            stdout: 'bun audit v1.3.14',
        },
        { error: undefined, status: 0, stderr: '', stdout: JSON.stringify({}) },
    ];
    let calls = 0;

    const report = await runBunAudit('/repository', {
        maxAttempts: 2,
        onRetry: () => undefined,
        retryDelaysMs: [0],
        runCommand: () => results[calls++],
        wait: async () => undefined,
    });

    assert.deepEqual(report, {});
    assert.equal(calls, 2);
});

void test('bun audit fails closed after bounded transport retries are exhausted', async () => {
    let calls = 0;

    await assert.rejects(
        runBunAudit('/repository', {
            maxAttempts: 2,
            onRetry: () => undefined,
            retryDelaysMs: [0],
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
        /Could not parse bun audit JSON after 2 of 2 attempts/u,
    );
    assert.equal(calls, 2);
});

void test('bun audit does not retry unrelated malformed output', async () => {
    let calls = 0;

    await assert.rejects(
        runBunAudit('/repository', {
            maxAttempts: 2,
            onRetry: () => undefined,
            retryDelaysMs: [0],
            runCommand: () => {
                calls += 1;
                return { error: undefined, status: 1, stderr: 'unexpected response', stdout: '' };
            },
            wait: async () => undefined,
        }),
        /Could not parse bun audit JSON after 1 of 2 attempts/u,
    );
    assert.equal(calls, 1);
});

void test('bun audit retries a transient registry HTTP response and returns the next valid report', async () => {
    const results = [
        {
            error: undefined,
            status: 1,
            stderr: '',
            stdout: JSON.stringify({ error: 'Service Unavailable', statusCode: 503 }),
        },
        { error: undefined, status: 0, stderr: '', stdout: JSON.stringify({}) },
    ];
    const retryEvents = [];
    let calls = 0;

    const report = await runBunAudit('/repository', {
        maxAttempts: 2,
        onRetry: event => retryEvents.push(event),
        retryDelaysMs: [0],
        runCommand: () => results[calls++],
        wait: async () => undefined,
    });

    assert.deepEqual(report, {});
    assert.equal(calls, 2);
    assert.deepEqual(retryEvents, [{ attempt: 1, delayMs: 0 }]);
});

void test('bun audit does not retry a non-transient HTTP error response', async () => {
    let calls = 0;

    await assert.rejects(
        runBunAudit('/repository', {
            maxAttempts: 2,
            onRetry: () => undefined,
            retryDelaysMs: [0],
            runCommand: () => {
                calls += 1;
                return {
                    error: undefined,
                    status: 1,
                    stderr: '',
                    stdout: JSON.stringify({ error: 'Bad Request', statusCode: 400 }),
                };
            },
            wait: async () => undefined,
        }),
        /bun audit entry for error must be an array/u,
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
            maxAttempts: 2,
            onRetry: () => undefined,
            retryDelaysMs: [0],
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

void test('blocked audit preserves every raw advisory before rejecting the policy', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-blocked-audit-'));
    try {
        const lock = path.join(root, 'bun.lock');
        const evidence = path.join(root, 'bun-audit.json');
        await writeFile(lock, 'blocked audit fixture lock');
        await assert.rejects(
            runBunAudit(root, {
                auditLevel: 'high',
                onReport: report => writeBunAuditEvidence(evidence, lock, report),
                runCommand: () => ({ status: 1, stdout: JSON.stringify(audit), stderr: '' }),
            }),
            /bun audit policy failed/u,
        );
        const lockSha = createHash('sha256')
            .update(await readFile(lock))
            .digest('hex');
        assert.deepEqual(parseSavedBunAuditEvidence(await readFile(evidence, 'utf8'), lockSha), audit);
        await assert.rejects(
            runBunAudit(root, {
                auditLevel: 'high',
                onReport: () => {
                    throw new Error('Could not retain audit evidence');
                },
                runCommand: () => ({ status: 1, stdout: JSON.stringify({}), stderr: '' }),
            }),
            /Could not retain audit evidence/u,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
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

void test('runtime audit writes and reuses lockfile-bound audit evidence', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-audit-'));
    const auditReportPath = path.join(fixtureRoot, 'bun-audit.json');
    const lockfilePath = path.join(fixtureRoot, 'bun.lock');
    try {
        await writeFile(lockfilePath, 'fixture lockfile');
        writeBunAuditEvidence(auditReportPath, lockfilePath, audit);
        const lockfileSha256 = createHash('sha256').update('fixture lockfile').digest('hex');

        assert.deepEqual(
            parseSavedBunAuditEvidence(await readFile(auditReportPath, 'utf8'), lockfileSha256),
            audit,
        );
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

void test('repository and production workflows use the fail-closed retrying audit gate', async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const repositoryWorkflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/build_and_test.yml'),
        'utf8',
    );
    const productionWorkflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/build_production_runtime.yml'),
        'utf8',
    );

    assert.match(
        repositoryWorkflow,
        /node packages\/dev-server\/scripts\/production-runtime-audit\.mjs --audit-level high/u,
    );
    assert.match(repositoryWorkflow, /dependencies: \$\{\{ steps\.check\.outputs\.dependencies \}\}/u);
    assert.match(repositoryWorkflow, /e2e: \$\{\{ steps\.check\.outputs\.e2e \}\}/u);
    assert.match(repositoryWorkflow, /dependency-audit:/u);
    assert.match(repositoryWorkflow, /needs\.detect-changes\.outputs\.dependencies == 'true'/u);
    assert.match(
        repositoryWorkflow,
        /inputs\.full && fromJSON\('\["20\.x", "22\.x", "24\.x"\]'\) \|\| fromJSON\('\["22\.x"\]'\)/u,
    );
    assert.match(
        repositoryWorkflow,
        new RegExp(
            'Build translation acceptance harness and local plugins[\\s\\S]+' +
                "needs\\.detect-changes\\.outputs\\.translation == 'true'[\\s\\S]+" +
                'bun run --cwd packages/testing build[\\s\\S]+' +
                'bun run --cwd packages/dev-server build:local-plugins',
            'u',
        ),
    );
    assert.match(
        repositoryWorkflow,
        new RegExp(
            'Build missing test prerequisites[\\s\\S]+' +
                "steps\\.compiled\\.outputs\\.restored != 'true' \\|\\| " +
                "needs\\.detect-changes\\.outputs\\.translation == 'true'[\\s\\S]+" +
                'node scripts/ci-run\\.mjs prepare-tests',
            'u',
        ),
    );
    assert.match(
        repositoryWorkflow,
        new RegExp(
            'Build storefront integration acceptance harness[\\s\\S]+' +
                "needs\\.detect-changes\\.outputs\\.storefrontIntegration == 'true'[\\s\\S]+" +
                'bun run --cwd packages/testing build[\\s\\S]+' +
                'Install browser for storefront configuration acceptance',
            'u',
        ),
    );
    assert.doesNotMatch(repositoryWorkflow, /if: needs\.detect-changes\.outputs\.e2e == 'true'/u);
    for (const database of ['mysql', 'sqljs', 'postgres', 'mariadb']) {
        assert.ok(
            repositoryWorkflow.includes(`e2e_${database}: \${{ steps.check.outputs.e2e_${database} }}`),
        );
        assert.ok(repositoryWorkflow.includes(`if: needs.detect-changes.outputs.e2e_${database} == 'true'`));
    }
    assert.match(
        productionWorkflow,
        /node packages\/dev-server\/scripts\/production-runtime-audit\.mjs[\s\\]+--audit-level high[\s\\]+--evidence-output/u,
    );
    assert.match(productionWorkflow, /--audit-report "\$BUN_AUDIT_REPORT"/u);
    assert.match(
        productionWorkflow,
        /Production build changed tracked or untracked source files[\s\S]+printf '%s\\n' "\$SOURCE_STATUS"[\s\S]+git diff --stat/u,
    );
    assert.doesNotMatch(repositoryWorkflow, /run: bun audit/u);
    assert.doesNotMatch(productionWorkflow, /bun audit --json/u);
});

void test('approved braces backport verifies all installed copies and preserves the original advisory', async () => {
    const { cp, mkdir } = await import('node:fs/promises');
    const { BRACES_PATCH, verifyBracesPatch } = await import('./production-runtime-audit.mjs');
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-braces-patch-'));
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    // A frozen approved patch and its exact expected installation are independent fixtures.
    await mkdir(path.join(root, 'patches'), { recursive: true });
    await cp(path.join(repositoryRoot, BRACES_PATCH.path), path.join(root, BRACES_PATCH.path));
    await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({
            patchedDependencies: { 'braces@3.0.3': BRACES_PATCH.path },
        }),
    );
    await writeFile(
        path.join(root, 'bun.lock'),
        JSON.stringify({
            patchedDependencies: { 'braces@3.0.3': BRACES_PATCH.path },
        }),
    );
    const installed = path.join(repositoryRoot, 'node_modules/braces');
    const localCopy = path.join(root, 'node_modules/braces');
    await cp(installed, localCopy, { recursive: true });
    // Keep the existing range dependency available without installing anything in the test.
    await cp(
        path.join(repositoryRoot, 'node_modules/fill-range'),
        path.join(root, 'node_modules/fill-range'),
        { recursive: true },
    );
    await cp(
        path.join(repositoryRoot, 'node_modules/to-regex-range'),
        path.join(root, 'node_modules/to-regex-range'),
        { recursive: true },
    );
    await cp(path.join(repositoryRoot, 'node_modules/is-number'), path.join(root, 'node_modules/is-number'), {
        recursive: true,
    });
    const nestedCopy = path.join(root, 'node_modules/dependent/node_modules/braces');
    await cp(installed, nestedCopy, { recursive: true });
    await cp(installed, path.join(root, 'node_modules/braces-alias'), { recursive: true });
    const braceReport = {
        braces: [
            {
                id: 1,
                severity: 'high',
                title: 'Stack exhaustion through deeply nested patterns',
                url: BRACES_PATCH.advisory,
                vulnerable_versions: '<=3.0.3',
            },
        ],
    };
    try {
        const verified = verifyBracesPatch(root);
        assert.equal(verified.state, 'VERIFIED_PATCH');
        assert.equal(verified.copies.length, 3);
        const raw = await runBunAudit(root, {
            auditLevel: 'high',
            runCommand: () => ({ status: 1, stdout: JSON.stringify(braceReport), stderr: '' }),
        });
        assert.deepEqual(raw, braceReport);
        const runtimeInventory = [{ name: 'braces', version: '3.0.3', path: 'node_modules/braces' }];
        const lockSha = createHash('sha256')
            .update(await readFile(path.join(root, 'bun.lock')))
            .digest('hex');
        const saved = path.join(root, 'saved-audit.json');
        writeBunAuditEvidence(saved, path.join(root, 'bun.lock'), raw);
        const runtime = await auditRuntimePackages(root, runtimeInventory, {
            auditReportPath: saved,
            expectedLockfileSha256: lockSha,
            failOn: 'high',
        });
        assert.equal(runtime.summary.high, 1);
        assert.equal(runtime.findings[0].url, BRACES_PATCH.advisory);
        assert.equal(runtime.verifiedPatches[0].state, 'VERIFIED_PATCH');

        await writeFile(path.join(nestedCopy, 'lib/parse.js'), '// unpatched or corrupted copy');
        assert.throws(() => verifyBracesPatch(root), /fingerprint mismatch/u);
        await cp(path.join(installed, 'lib/parse.js'), path.join(nestedCopy, 'lib/parse.js'));
        await writeFile(path.join(localCopy, 'index.js'), '// bypass patched walkers');
        assert.throws(() => verifyBracesPatch(root), /fingerprint mismatch/u);
        await cp(path.join(installed, 'index.js'), path.join(localCopy, 'index.js'));
        const packageSource = await readFile(path.join(nestedCopy, 'package.json'), 'utf8');
        await writeFile(path.join(nestedCopy, 'package.json'), packageSource.replace('"3.0.3"', '"3.0.2"'));
        assert.throws(() => verifyBracesPatch(root), /version does not match/u);
        await writeFile(path.join(nestedCopy, 'package.json'), packageSource);
        await rm(path.join(nestedCopy, 'lib/parse.js'));
        assert.throws(() => verifyBracesPatch(root), /ENOENT/u);
        await cp(path.join(installed, 'lib/parse.js'), path.join(nestedCopy, 'lib/parse.js'));
        await writeFile(path.join(root, BRACES_PATCH.path), '// modified patch');
        assert.throws(() => verifyBracesPatch(root), /source fingerprint mismatch/u);
        await cp(path.join(repositoryRoot, BRACES_PATCH.path), path.join(root, BRACES_PATCH.path));
        await writeFile(path.join(root, 'bun.lock'), '{}');
        assert.throws(() => verifyBracesPatch(root), /frozen lockfile/u);
        await writeFile(
            path.join(root, 'bun.lock'),
            JSON.stringify({
                patchedDependencies: { 'braces@3.0.3': BRACES_PATCH.path },
            }),
        );
        await writeFile(path.join(root, 'package.json'), '{}');
        assert.throws(() => verifyBracesPatch(root), /registration/u);
        await writeFile(
            path.join(root, 'package.json'),
            JSON.stringify({
                patchedDependencies: { 'braces@3.0.3': BRACES_PATCH.path },
            }),
        );
        const unrelated = {
            ...braceReport,
            another: [
                {
                    id: 2,
                    severity: 'high',
                    title: 'Unrelated high advisory',
                    url: 'https://example.com/high',
                },
            ],
        };
        await assert.rejects(
            runBunAudit(root, {
                auditLevel: 'high',
                runCommand: () => ({ status: 1, stdout: JSON.stringify(unrelated), stderr: '' }),
            }),
            /policy failed \(high\+\): another/u,
        );
        const escalated = { braces: [{ ...braceReport.braces[0], severity: 'critical' }] };
        await assert.rejects(
            runBunAudit(root, {
                auditLevel: 'high',
                runCommand: () => ({ status: 1, stdout: JSON.stringify(escalated), stderr: '' }),
            }),
            /policy failed \(high\+\): braces critical/u,
        );
        await rm(path.join(root, 'node_modules'), { recursive: true });
        assert.throws(() => verifyBracesPatch(root), /No installed braces/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
