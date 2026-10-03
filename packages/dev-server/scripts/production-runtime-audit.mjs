import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import semver from 'semver';

const SEVERITIES = Object.freeze(['low', 'moderate', 'high', 'critical']);
const DEFAULT_AUDIT_RETRY_DELAYS_MS = Object.freeze([15_000]);
const RETRYABLE_AUDIT_FAILURE =
    /(?:Timeout|ConnectionClosed):\s*audit request failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up/iu;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../..');

// Pinned, explicitly approved backport of upstream PR72, not a severity exemption.
export const BRACES_PATCH = Object.freeze({
    advisory: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    version: '3.0.3',
    path: 'patches/braces@3.0.3.patch',
    sha256: '78eb00165305b88c9b6df49d8915842680423482c7663c141cee211479702b6f',
    files: Object.freeze({
        'lib/compile.js': 'b651f7715e6db8942ce61d3394357b4d81c8ece88240aa31a458ea1165edd195',
        'lib/constants.js': 'f9fb688959232eee3e6ad7906a5b0e3234815db49ee857ef86983d65b917dc7c',
        'lib/expand.js': '2974d5b8763a358d81dfa5b4b804329f525239f34429c396b93a540219504809',
        'lib/parse.js': 'ef9b3851f848460daaf91ff248222a43e266f97c4f2df7010cb7858e1e39a107',
        'lib/stringify.js': '212657a28ad9a1decea8ae098e9c241cfc6a7784982be6f17df6409224f01b59',
        'index.js': '332ea07c7b006361aad12aa994ca75dc1db8e8382b884909e2f38f10b85c88a4',
        'lib/utils.js': 'b5a7596aa67730412b3c029ef09e84e6b67b8e445cffd35d1d295549c89066c7',
        'package.json': '56f08b888a4f30dc7cf8a7dbb36ffe92b737912ba36abe9d069d32167c957ac7',
    }),
});

function hashFile(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// Pinned backport of upstream PR58. Both source bytes and installed behavior must match.
export const HTTP_CACHE_PATCH = Object.freeze({
    advisory: 'https://github.com/advisories/GHSA-ch52-4w7c-c8xp',
    package: 'http-cache-semantics',
    version: '4.2.0',
    path: 'patches/http-cache-semantics@4.2.0.patch',
    sha256: 'ef5fa630ed4a64ff13eeea43113d5e137d351881afa4afd2db78249629c58db9',
    files: Object.freeze({
        'index.js': 'fc7b3f0265b7a7d0fee83bafa47186a66495720d3179801c2be3083de6d0cf76',
        'package.json': 'bee0609d5ab09a590afe0e1209d3702b0afb0a3c158492f90902a724d889d22b',
    }),
});
const VERIFIED_PATCHES = Object.freeze([BRACES_PATCH, HTTP_CACHE_PATCH]);

function installedPackagePaths(root, name) {
    const pending = [path.join(root, 'node_modules')];
    const packagesRoot = path.join(root, 'packages');
    if (existsSync(packagesRoot)) {
        for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
            if (entry.isDirectory()) pending.push(path.join(packagesRoot, entry.name, 'node_modules'));
        }
    }
    const found = new Set();
    while (pending.length) {
        const directory = pending.pop();
        if (!existsSync(directory)) continue;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            const manifestPath = path.join(target, 'package.json');
            if (existsSync(manifestPath)) {
                const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
                if (manifest.name === name) found.add(target);
            }
            // Do not follow workspace or external links while enumerating dependencies.
            if (entry.isDirectory()) pending.push(target);
        }
    }
    return [...found].sort();
}

function assertDepthGuard(braces) {
    if (JSON.stringify(braces.expand('x{1..3}')) !== JSON.stringify(['x1', 'x2', 'x3'])) {
        throw new Error('Patched braces failed ordinary range compatibility');
    }
    const reject = run => {
        try {
            run();
        } catch (error) {
            if (/exceeds max depth/u.test(error?.message ?? '')) return;
            throw error;
        }
        throw new Error('Patched braces failed depth guard');
    };
    reject(() => braces.parse('{'.repeat(101) + 'a' + '}'.repeat(101)));
    reject(() => braces.parse('('.repeat(101) + 'a' + ')'.repeat(101)));
    reject(() => braces.parse('{{a,b},c}', { maxDepth: 1 }));
    reject(() => braces.parse('{'.repeat(101) + 'a' + '}'.repeat(101), { maxDepth: 10_000 }));
    braces.parse('{'.repeat(100) + 'a' + '}'.repeat(100));
    for (const api of ['compile', 'expand', 'stringify']) {
        let ast = { type: 'text', value: 'a' };
        for (let depth = 0; depth < 101; depth++) ast = { type: 'brace', nodes: [ast] };
        reject(() => braces[api]({ type: 'root', nodes: [ast] }));
    }
}

function assertCacheReuseGuard(CachePolicy) {
    const request = { url: 'https://fixture.invalid/cache', method: 'GET', headers: {} };
    const check = (headers, shared, expected) => {
        const policy = new CachePolicy(request, { status: 200, headers }, { shared });
        policy.now = () => policy._responseTime + 10_000;
        const incoming = { ...request, headers: { 'cache-control': 'max-stale=100' } };
        if (!!policy.evaluateRequest(incoming).response !== expected) {
            throw new Error('Patched http-cache-semantics failed cache reuse guard');
        }
    };
    check({ 'cache-control': 'max-age=1', 'set-cookie': 'synthetic=1' }, true, false);
    check({ 'cache-control': 'max-age=1, proxy-revalidate' }, true, false);
    check({ 'cache-control': 'max-age=1, no-cache' }, true, false);
    check({ 'cache-control': 'public, max-age=1' }, true, true);
    check({ 'cache-control': 'public, max-age=1', 'set-cookie': 'synthetic=1' }, true, true);
    check({ 'cache-control': 'max-age=1', 'set-cookie': 'synthetic=1' }, false, true);
}

function verifyInstalledPatch(
    root,
    patch,
    assertBehavior,
    { runtimePackages, requireRegistration = true } = {},
) {
    root = realpathSync(root);
    const key = `${patch.package}@${patch.version}`;
    if (requireRegistration) {
        const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (manifest.patchedDependencies?.[key] !== patch.path) {
            throw new Error(patch.package + ' patch registration is missing or changed');
        }
        if (hashFile(path.join(root, patch.path)) !== patch.sha256) {
            throw new Error(patch.package + ' patch source fingerprint mismatch');
        }
        const lock = readFileSync(path.join(root, 'bun.lock'), 'utf8');
        const lockedPatches = /"patchedDependencies":\s*\{([^}]+)\}/u.exec(lock)?.[1] ?? '';
        const entries = [...lockedPatches.matchAll(/"([^"]+)":\s*"([^"]+)"/gu)];
        if (!entries.some(entry => entry[1] === key && entry[2] === patch.path)) {
            throw new Error(patch.package + ' patch is absent from the frozen lockfile');
        }
    }
    const packagePaths = runtimePackages
        ? runtimePackages
              .filter(item => item.name === patch.package)
              .map(item => {
                  if (item.version !== patch.version) {
                      throw new Error(
                          patch.package + ' runtime inventory version does not match the approved patch',
                      );
                  }
                  return path.join(root, item.path);
              })
        : installedPackagePaths(root, patch.package);
    if (!packagePaths.length)
        throw new Error('No installed ' + patch.package + ' copy available for patch verification');
    const copies = [];
    for (const packagePath of [...new Set(packagePaths)]) {
        const resolved = realpathSync(packagePath);
        if (!resolved.startsWith(root + path.sep)) {
            throw new Error(patch.package + ' package resolves outside the audited tree');
        }
        const manifest = JSON.parse(readFileSync(path.join(resolved, 'package.json'), 'utf8'));
        if (manifest.name !== patch.package || manifest.version !== patch.version) {
            throw new Error(patch.package + ' package version does not match the approved patch');
        }
        const fingerprints = {};
        for (const [file, expected] of Object.entries(patch.files)) {
            const actual = hashFile(path.join(resolved, file));
            if (actual !== expected)
                throw new Error(patch.package + ' installed file fingerprint mismatch: ' + file);
            fingerprints[file] = actual;
        }
        const require = createRequire(path.join(resolved, 'package.json'));
        assertBehavior(require(resolved));
        copies.push({ path: path.relative(root, packagePath), files: fingerprints });
    }
    return {
        advisory: patch.advisory,
        name: patch.package,
        version: patch.version,
        state: 'VERIFIED_PATCH',
        patchSha256: patch.sha256,
        copies,
    };
}

export function verifyBracesPatch(root, options) {
    return verifyInstalledPatch(root, BRACES_PATCH, assertDepthGuard, options);
}

export function verifyHttpCachePatch(root, options) {
    return verifyInstalledPatch(root, HTTP_CACHE_PATCH, assertCacheReuseGuard, options);
}

export function isVerifiedFinding(name, advisory, verifiedPatches) {
    return VERIFIED_PATCHES.some(
        patch =>
            name === patch.package &&
            advisory.url === patch.advisory &&
            advisory.severity === 'high' &&
            (advisory.version === undefined || advisory.version === patch.version) &&
            verifiedPatches.some(
                item =>
                    item.state === 'VERIFIED_PATCH' &&
                    item.advisory === advisory.url &&
                    item.name === name &&
                    item.version === patch.version &&
                    item.patchSha256 === patch.sha256,
            ),
    );
}

export function verifyReportPatches(auditReport, root, options) {
    const verified = [];
    for (const patch of VERIFIED_PATCHES) {
        if (options?.runtimePackages && !options.runtimePackages.some(item => item.name === patch.package))
            continue;
        const advisories = auditReport[patch.package] ?? [];
        if (!advisories.some(advisory => advisory.url === patch.advisory)) continue;
        verified.push(
            patch === BRACES_PATCH ? verifyBracesPatch(root, options) : verifyHttpCachePatch(root, options),
        );
    }
    return verified;
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function severityRank(severity) {
    const rank = SEVERITIES.indexOf(severity);
    if (rank === -1) {
        throw new Error(`Unsupported audit severity: ${severity}`);
    }
    return rank;
}

function evaluateAuditPolicy(auditReport, failOn, verifiedPatches = []) {
    if (!isRecord(auditReport)) {
        throw new Error('bun audit JSON must be an object');
    }
    const failOnRank = severityRank(failOn);
    const findings = [];
    for (const [name, advisories] of Object.entries(auditReport)) {
        if (!Array.isArray(advisories)) {
            throw new Error(`bun audit entry for ${name} must be an array`);
        }
        for (const advisory of advisories) {
            if (
                !isRecord(advisory) ||
                typeof advisory.severity !== 'string' ||
                typeof advisory.title !== 'string' ||
                typeof advisory.url !== 'string'
            ) {
                throw new Error(`bun audit advisory for ${name} is invalid`);
            }
            if (
                severityRank(advisory.severity) >= failOnRank &&
                !isVerifiedFinding(name, advisory, verifiedPatches)
            ) {
                findings.push({
                    name,
                    severity: advisory.severity,
                    title: advisory.title,
                    url: advisory.url,
                });
            }
        }
    }
    return findings.sort(
        (left, right) =>
            severityRank(right.severity) - severityRank(left.severity) ||
            left.name.localeCompare(right.name) ||
            left.title.localeCompare(right.title),
    );
}

export function matchRuntimeAdvisories(runtimePackages, auditReport) {
    if (!isRecord(auditReport)) {
        throw new Error('bun audit JSON must be an object');
    }
    const findings = [];
    for (const runtimePackage of runtimePackages) {
        const advisories = auditReport[runtimePackage.name];
        if (advisories === undefined) {
            continue;
        }
        if (!Array.isArray(advisories)) {
            throw new Error(`bun audit entry for ${runtimePackage.name} must be an array`);
        }
        if (!semver.valid(runtimePackage.version)) {
            throw new Error(
                `Runtime package has a non-semver version: ${runtimePackage.name}@${runtimePackage.version}`,
            );
        }
        for (const advisory of advisories) {
            if (
                !isRecord(advisory) ||
                (typeof advisory.id !== 'number' && typeof advisory.id !== 'string') ||
                typeof advisory.severity !== 'string' ||
                typeof advisory.title !== 'string' ||
                typeof advisory.url !== 'string' ||
                typeof advisory.vulnerable_versions !== 'string'
            ) {
                throw new Error(`bun audit advisory for ${runtimePackage.name} is invalid`);
            }
            severityRank(advisory.severity);
            if (
                semver.satisfies(runtimePackage.version, advisory.vulnerable_versions, {
                    includePrerelease: true,
                })
            ) {
                findings.push({
                    id: String(advisory.id),
                    name: runtimePackage.name,
                    path: runtimePackage.path,
                    severity: advisory.severity,
                    title: advisory.title,
                    url: advisory.url,
                    version: runtimePackage.version,
                    vulnerableVersions: advisory.vulnerable_versions,
                });
            }
        }
    }
    return findings.sort(
        (left, right) =>
            severityRank(right.severity) - severityRank(left.severity) ||
            left.name.localeCompare(right.name) ||
            left.version.localeCompare(right.version) ||
            left.path.localeCompare(right.path) ||
            left.id.localeCompare(right.id),
    );
}

export function createRuntimeAuditReport(
    runtimePackages,
    auditReport,
    { failOn = 'critical', verifiedPatches = [] } = {},
) {
    const failOnRank = severityRank(failOn);
    const findings = matchRuntimeAdvisories(runtimePackages, auditReport);
    const summary = { critical: 0, high: 0, low: 0, moderate: 0, total: findings.length };
    for (const finding of findings) {
        summary[finding.severity] += 1;
    }
    const blockedFindings = findings.filter(
        finding =>
            severityRank(finding.severity) >= failOnRank &&
            !isVerifiedFinding(finding.name, finding, verifiedPatches),
    );
    return {
        blockedFindings,
        report: {
            findings,
            generatedAt: new Date().toISOString(),
            policy: { failOn },
            summary,
            verifiedPatches,
        },
    };
}

export function parseBunAuditJson(output, source = 'bun audit') {
    try {
        return JSON.parse(output);
    } catch {
        const detail = output.trim();
        throw new Error(`Could not parse ${source} JSON${detail ? `:\n${detail}` : ''}`);
    }
}

export function parseSavedBunAuditEvidence(output, expectedLockfileSha256) {
    const evidence = parseBunAuditJson(output, 'saved bun audit evidence');
    if (
        !isRecord(evidence) ||
        evidence.format !== 1 ||
        !isRecord(evidence.report) ||
        typeof evidence.lockfileSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(evidence.lockfileSha256)
    ) {
        throw new Error('Saved bun audit evidence is invalid');
    }
    if (evidence.lockfileSha256 !== expectedLockfileSha256) {
        throw new Error('Saved bun audit evidence does not match the source lockfile');
    }
    evaluateAuditPolicy(evidence.report, 'critical');
    return evidence.report;
}

export function writeBunAuditEvidence(outputPath, lockfilePath, report) {
    evaluateAuditPolicy(report, 'critical');
    const lockfileSha256 = createHash('sha256').update(readFileSync(lockfilePath)).digest('hex');
    writeFileSync(outputPath, `${JSON.stringify({ format: 1, lockfileSha256, report })}\n`, {
        mode: 0o600,
    });
}

function bunAuditParseError(result, attempt, maxAttempts) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const attemptDetail = maxAttempts > 1 ? ` after ${attempt} of ${maxAttempts} attempts` : '';
    return {
        detail,
        error: new Error(`Could not parse bun audit JSON${attemptDetail}${detail ? `:\n${detail}` : ''}`),
    };
}

function isRetriableAuditFailure(result, detail) {
    return result.status !== 0 && RETRYABLE_AUDIT_FAILURE.test(detail);
}

function isRetriableAuditHttpResponse(report) {
    if (!isRecord(report) || typeof report.statusCode !== 'number' || !('error' in report)) {
        return false;
    }
    return [408, 425, 429].includes(report.statusCode) || report.statusCode >= 500;
}

export async function runBunAudit(
    workingDirectory,
    {
        auditLevel,
        maxAttempts = DEFAULT_AUDIT_RETRY_DELAYS_MS.length + 1,
        onRetry = ({ attempt, delayMs }) => {
            process.stderr.write(
                `bun audit request failure on attempt ${attempt}; retrying in ${delayMs}ms\n`,
            );
        },
        retryDelaysMs = DEFAULT_AUDIT_RETRY_DELAYS_MS,
        onReport = () => undefined,
        runCommand = () =>
            spawnSync('bun', ['audit', '--json'], {
                cwd: workingDirectory,
                encoding: 'utf8',
            }),
        wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs)),
    } = {},
) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) {
        throw new Error('bun audit maxAttempts must be an integer between 1 and 2');
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const result = runCommand();
        if (result.error) {
            const detail = result.error instanceof Error ? result.error.message : String(result.error);
            if (!RETRYABLE_AUDIT_FAILURE.test(detail) || attempt === maxAttempts) {
                throw result.error;
            }
            const delayMs = retryDelaysMs[attempt - 1] ?? retryDelaysMs.at(-1) ?? 0;
            onRetry({ attempt, delayMs });
            await wait(delayMs);
            continue;
        }
        let report;
        try {
            report = JSON.parse(result.stdout);
        } catch {
            const { detail, error } = bunAuditParseError(result, attempt, maxAttempts);
            if (!isRetriableAuditFailure(result, detail) || attempt === maxAttempts) {
                throw error;
            }
            const delayMs = retryDelaysMs[attempt - 1] ?? retryDelaysMs.at(-1) ?? 0;
            onRetry({ attempt, delayMs });
            await wait(delayMs);
            continue;
        }
        if (isRetriableAuditHttpResponse(report)) {
            if (attempt === maxAttempts) {
                throw new Error(
                    `bun audit request returned HTTP ${report.statusCode} after ${attempt} of ${maxAttempts} attempts`,
                );
            }
            const delayMs = retryDelaysMs[attempt - 1] ?? retryDelaysMs.at(-1) ?? 0;
            onRetry({ attempt, delayMs });
            await wait(delayMs);
            continue;
        }
        // Preserve the complete raw report even when a patch check or policy blocks publication.
        await onReport(report);
        const verifiedPatches = verifyReportPatches(report, workingDirectory);
        const blockedFindings = evaluateAuditPolicy(report, auditLevel ?? 'critical', verifiedPatches);
        if (auditLevel && blockedFindings.length > 0) {
            const first = blockedFindings[0];
            throw new Error(
                `bun audit policy failed (${auditLevel}+): ${first.name} ${first.severity} ${first.title} (${first.url})`,
            );
        }
        if (result.status !== 0 && result.status !== 1) {
            throw new Error(`bun audit exited unexpectedly with code ${result.status ?? 'unknown'}`);
        }
        return report;
    }
    throw new Error('bun audit retry loop exited unexpectedly');
}

export async function auditRuntimePackages(
    artifactRoot,
    runtimePackages,
    { auditReportPath, expectedLockfileSha256, failOn = 'critical' } = {},
) {
    if (auditReportPath && !expectedLockfileSha256) {
        throw new Error('Saved bun audit evidence requires the source lockfile SHA-256');
    }
    const auditReport = auditReportPath
        ? parseSavedBunAuditEvidence(
              readFileSync(path.resolve(auditReportPath), 'utf8'),
              expectedLockfileSha256,
          )
        : await runBunAudit(repositoryRoot);
    const verifiedPatches = verifyReportPatches(auditReport, artifactRoot, {
        runtimePackages,
        requireRegistration: false,
    });
    const { blockedFindings, report } = createRuntimeAuditReport(runtimePackages, auditReport, {
        failOn,
        verifiedPatches,
    });
    await writeFile(path.join(artifactRoot, 'RUNTIME-AUDIT.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (blockedFindings.length > 0) {
        const first = blockedFindings[0];
        throw new Error(
            `Runtime audit policy failed (${failOn}+): ${first.name}@${first.version} ${first.title}`,
        );
    }
    return report;
}

async function main() {
    const { values } = parseArgs({
        options: {
            'audit-level': { type: 'string' },
            'evidence-output': { type: 'string' },
            lockfile: { type: 'string' },
        },
        strict: true,
    });
    const auditLevel = values['audit-level'] ?? 'high';
    severityRank(auditLevel);
    const report = await runBunAudit(repositoryRoot, {
        auditLevel,
        onReport: rawReport => {
            if (values['evidence-output']) {
                const lockfilePath = path.resolve(repositoryRoot, values.lockfile ?? 'bun.lock');
                writeBunAuditEvidence(path.resolve(values['evidence-output']), lockfilePath, rawReport);
            }
        },
    });
    const verifiedPatches = verifyReportPatches(report, repositoryRoot);
    process.stdout.write(
        `bun audit policy passed (${auditLevel}+); verified patches: ${verifiedPatches.length}\n`,
    );
    if (verifiedPatches.length) process.stdout.write(`${JSON.stringify({ verifiedPatches })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
