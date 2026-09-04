import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const SEVERITIES = Object.freeze(['low', 'moderate', 'high', 'critical']);

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

const RETRYABLE_AUDIT_FAILURE =
    /Timeout: audit request failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up/iu;

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
    return evidence.report;
}

function parseBunAuditResult(result) {
    if (result.error) {
        throw result.error;
    }
    const output = result.stdout.trim()
        ? result.stdout
        : [result.stdout, result.stderr].filter(Boolean).join('\n');
    return parseBunAuditJson(output);
}

/**
 * @param {string} repositoryRoot
 * @param {{ commandRunner?: typeof spawnSync, maxAttempts?: number, retryDelayMs?: number }} [options]
 */
export async function runBunAudit(
    repositoryRoot,
    { commandRunner = spawnSync, maxAttempts = 3, retryDelayMs = 2_000 } = {},
) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
        throw new Error('bun audit maxAttempts must be an integer between 1 and 5');
    }
    if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) {
        throw new Error('bun audit retryDelayMs must be an integer between 0 and 30000');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return parseBunAuditResult(
                commandRunner('bun', ['audit', '--json'], {
                    cwd: repositoryRoot,
                    encoding: 'utf8',
                }),
            );
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            if (!RETRYABLE_AUDIT_FAILURE.test(detail) || attempt === maxAttempts) {
                throw new Error(`bun audit failed after ${attempt} attempt(s): ${detail}`, {
                    cause: error,
                });
            }
            process.stderr.write(
                `Transient bun audit request failure (${attempt}/${maxAttempts}); retrying in ${retryDelayMs}ms\n`,
            );
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }

    throw new Error('bun audit failed without producing a result');
}

export async function auditRuntimePackages(
    artifactRoot,
    runtimePackages,
    { auditReportPath, expectedLockfileSha256, failOn = 'critical' } = {},
) {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
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
