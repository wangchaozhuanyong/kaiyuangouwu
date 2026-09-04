import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const SEVERITIES = Object.freeze(['low', 'moderate', 'high', 'critical']);
const DEFAULT_AUDIT_RETRY_DELAYS_MS = Object.freeze([15_000, 60_000]);

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

function bunAuditParseError(result, attempt, maxAttempts) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const attemptDetail = maxAttempts > 1 ? ` after ${attempt} of ${maxAttempts} attempts` : '';
    return {
        detail,
        error: new Error(`Could not parse bun audit JSON${attemptDetail}${detail ? `:\n${detail}` : ''}`),
    };
}

function isRetriableAuditTimeout(result, detail) {
    return result.status !== 0 && /Timeout:\s*audit request failed/u.test(detail);
}

export async function runBunAudit(
    repositoryRoot,
    {
        maxAttempts = DEFAULT_AUDIT_RETRY_DELAYS_MS.length + 1,
        onRetry = ({ attempt, delayMs }) => {
            process.stderr.write(
                `bun audit transport timeout on attempt ${attempt}; retrying in ${delayMs}ms\n`,
            );
        },
        retryDelaysMs = DEFAULT_AUDIT_RETRY_DELAYS_MS,
        runCommand = () =>
            spawnSync('bun', ['audit', '--json'], {
                cwd: repositoryRoot,
                encoding: 'utf8',
            }),
        wait = delayMs => new Promise(resolve => setTimeout(resolve, delayMs)),
    } = {},
) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        throw new Error('bun audit maxAttempts must be a positive integer');
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const result = runCommand();
        if (result.error) {
            throw result.error;
        }
        try {
            return JSON.parse(result.stdout);
        } catch {
            const { detail, error } = bunAuditParseError(result, attempt, maxAttempts);
            if (!isRetriableAuditTimeout(result, detail) || attempt === maxAttempts) {
                throw error;
            }
            const delayMs = retryDelaysMs[attempt - 1] ?? retryDelaysMs.at(-1) ?? 0;
            onRetry({ attempt, delayMs });
            await wait(delayMs);
        }
    }
    throw new Error('bun audit retry loop exited unexpectedly');
}

export async function auditRuntimePackages(artifactRoot, runtimePackages, { failOn = 'critical' } = {}) {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const { blockedFindings, report } = createRuntimeAuditReport(
        runtimePackages,
        await runBunAudit(repositoryRoot),
        { failOn },
    );
    await writeFile(path.join(artifactRoot, 'RUNTIME-AUDIT.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (blockedFindings.length > 0) {
        const first = blockedFindings[0];
        throw new Error(
            `Runtime audit policy failed (${failOn}+): ${first.name}@${first.version} ${first.title}`,
        );
    }
    return report;
}
