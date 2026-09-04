import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import semver from 'semver';

const SEVERITIES = Object.freeze(['low', 'moderate', 'high', 'critical']);
const DEFAULT_AUDIT_RETRY_DELAYS_MS = Object.freeze([15_000, 60_000]);
const RETRYABLE_AUDIT_FAILURE =
    /(?:Timeout|ConnectionClosed):\s*audit request failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up/iu;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../..');

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

function evaluateAuditPolicy(auditReport, failOn) {
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
            if (severityRank(advisory.severity) >= failOnRank) {
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

export function createRuntimeAuditReport(runtimePackages, auditReport, { failOn = 'critical' } = {}) {
    const failOnRank = severityRank(failOn);
    const findings = matchRuntimeAdvisories(runtimePackages, auditReport);
    const summary = { critical: 0, high: 0, low: 0, moderate: 0, total: findings.length };
    for (const finding of findings) {
        summary[finding.severity] += 1;
    }
    const blockedFindings = findings.filter(finding => severityRank(finding.severity) >= failOnRank);
    return {
        blockedFindings,
        report: {
            findings,
            generatedAt: new Date().toISOString(),
            policy: { failOn },
            summary,
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

export async function runBunAudit(
    workingDirectory,
    {
        auditLevel,
        maxAttempts = DEFAULT_AUDIT_RETRY_DELAYS_MS.length + 1,
        onRetry = ({ attempt, delayMs }) => {
            process.stderr.write(
                `bun audit transport failure on attempt ${attempt}; retrying in ${delayMs}ms\n`,
            );
        },
        retryDelaysMs = DEFAULT_AUDIT_RETRY_DELAYS_MS,
        runCommand = () =>
            spawnSync('bun', ['audit', '--json'], {
                cwd: workingDirectory,
                encoding: 'utf8',
            }),
        wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs)),
    } = {},
) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
        throw new Error('bun audit maxAttempts must be an integer between 1 and 5');
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
        const blockedFindings = evaluateAuditPolicy(report, auditLevel ?? 'critical');
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
    const { blockedFindings, report } = createRuntimeAuditReport(runtimePackages, auditReport, { failOn });
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
    const report = await runBunAudit(repositoryRoot, { auditLevel });
    if (values['evidence-output']) {
        const lockfilePath = path.resolve(repositoryRoot, values.lockfile ?? 'bun.lock');
        writeBunAuditEvidence(path.resolve(values['evidence-output']), lockfilePath, report);
    }
    process.stdout.write(`bun audit policy passed (${auditLevel}+)\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
