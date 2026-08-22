import { spawnSync } from 'node:child_process';
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

function runBunAudit(repositoryRoot) {
    const result = spawnSync('bun', ['audit', '--json'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    if (result.error) {
        throw result.error;
    }
    try {
        return JSON.parse(result.stdout);
    } catch {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        throw new Error(`Could not parse bun audit JSON${detail ? `:\n${detail}` : ''}`);
    }
}

export async function auditRuntimePackages(artifactRoot, runtimePackages, { failOn = 'critical' } = {}) {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const { blockedFindings, report } = createRuntimeAuditReport(
        runtimePackages,
        runBunAudit(repositoryRoot),
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
