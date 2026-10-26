import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import semver from 'semver';

import { SECURITY_VENDORS } from './security-vendor-definitions.mjs';

export { SECURITY_VENDORS };

const hashFile = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export function securityVendorForPackage(name) {
    return SECURITY_VENDORS.find(vendor => vendor.package === name);
}

export function verifySecurityVendors(
    root,
    { installedPackagePaths, behaviors, runtimePackages, requireRegistration = true },
) {
    if (!existsSync(root)) {
        assert.ok(
            !runtimePackages?.some(pkg => securityVendorForPackage(pkg.name)),
            'Missing audited replacement tree',
        );
        return [];
    }
    root = realpathSync(root);
    const manifestPath = path.join(root, 'package.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
    const verified = [];
    for (const vendor of SECURITY_VENDORS) {
        const configured =
            requireRegistration && manifest.overrides?.[vendor.original] === 'file:' + vendor.path;
        const copies = runtimePackages
            ? runtimePackages.filter(pkg => pkg.name === vendor.package).map(pkg => path.join(root, pkg.path))
            : installedPackagePaths(root, vendor.package);
        if (!configured && !copies.length) continue;
        if (requireRegistration) {
            assert.ok(configured, 'Security replacement registration is missing: ' + vendor.original);
            const lock = readFileSync(path.join(root, 'bun.lock'), 'utf8');
            assert.ok(
                lock.includes(JSON.stringify('file:' + vendor.path)),
                'Security replacement lock registration missing',
            );
            for (const [file, expected] of Object.entries(vendor.files)) {
                assert.equal(
                    hashFile(path.join(root, vendor.path, file)),
                    expected,
                    'Security replacement source fingerprint mismatch: ' + file,
                );
            }
        }
        assert.ok(copies.length, 'Security replacement has no installed copy: ' + vendor.original);
        const originals = runtimePackages
            ? runtimePackages.filter(pkg => pkg.name === vendor.original)
            : installedPackagePaths(root, vendor.original);
        assert.equal(
            originals.length,
            0,
            'Retired original dependency remains installed: ' + vendor.original,
        );
        const results = [];
        for (const copy of [...new Set(copies)]) {
            const resolved = realpathSync(copy);
            assert.ok(
                resolved.startsWith(root + path.sep),
                'Security replacement resolves outside audited tree',
            );
            const pkg = JSON.parse(readFileSync(path.join(resolved, 'package.json'), 'utf8'));
            assert.equal(pkg.name, vendor.package, 'Security replacement package identity mismatch');
            assert.equal(pkg.version, vendor.version, 'Security replacement package version mismatch');
            for (const [file, expected] of Object.entries(vendor.files)) {
                assert.equal(
                    hashFile(path.join(resolved, file)),
                    expected,
                    'Security replacement installed fingerprint mismatch: ' + file,
                );
            }
            behaviors[vendor.original](createRequire(path.join(resolved, 'package.json'))(resolved));
            results.push({ path: path.relative(root, copy), files: vendor.files });
        }
        verified.push({
            name: vendor.original,
            version: vendor.originalVersion,
            advisory: vendor.advisory,
            state: 'VERIFIED_SECURITY_REPLACEMENT',
            replacementName: vendor.package,
            replacementVersion: vendor.version,
            sourceSha256: vendor.sourceSha256,
            copies: results,
        });
    }
    return verified;
}

export function isVerifiedSecurityReplacement(name, advisory, verified) {
    return SECURITY_VENDORS.some(
        vendor =>
            vendor.original === name &&
            advisory.url === vendor.advisory &&
            advisory.severity === vendor.severity &&
            (advisory.version === undefined ||
                (advisory.replacement && advisory.version === vendor.originalVersion)) &&
            (!advisory.replacement ||
                (advisory.replacement.name === vendor.package &&
                    advisory.replacement.version === vendor.version)) &&
            verified.some(
                item =>
                    item.state === 'VERIFIED_SECURITY_REPLACEMENT' &&
                    item.name === vendor.original &&
                    item.version === vendor.originalVersion &&
                    item.advisory === vendor.advisory &&
                    item.replacementName === vendor.package &&
                    item.replacementVersion === vendor.version &&
                    item.sourceSha256 === vendor.sourceSha256,
            ),
    );
}

function requestAdvisoryJson(options, payload) {
    return new Promise((resolve, reject) => {
        const request = https.request({ ...options, family: 4 }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                text += chunk;
                if (Buffer.byteLength(text) > 1024 * 1024)
                    response.destroy(new Error('Origin advisory response too large'));
            });
            response.on('error', reject);
            response.on('end', () => {
                if (response.statusCode !== 200)
                    return reject(
                        new Error(
                            `Origin advisory registry HTTP ${response.statusCode} from ${options.hostname}`,
                        ),
                    );
                try {
                    resolve(JSON.parse(text));
                } catch {
                    reject(new Error('Invalid origin advisory registry response'));
                }
            });
        });
        const deadline = setTimeout(
            () => request.destroy(new Error('Origin advisory registry timeout')),
            15000,
        );
        request.once('close', () => clearTimeout(deadline));
        request.once('error', reject);
        request.end(payload);
    });
}

function requestOriginAudit(versions) {
    const payload = JSON.stringify(versions);
    return requestAdvisoryJson(
        {
            hostname: 'registry.npmjs.org',
            path: '/-/npm/v1/security/advisories/bulk',
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        },
        payload,
    );
}

function requestOriginAdvisory(advisoryUrl) {
    const identity = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/u.exec(
        advisoryUrl,
    );
    assert.ok(identity, 'Invalid known origin advisory URL');
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    return requestAdvisoryJson({
        hostname: 'api.github.com',
        path: '/advisories/' + identity[1],
        method: 'GET',
        headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'vendure-origin-advisory-audit',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
    });
}

function verifyWithdrawal(vendor, advisory) {
    const withdrawnAt = Date.parse(advisory?.withdrawn_at);
    assert.ok(
        advisory?.html_url === vendor.advisory &&
            advisory.ghsa_id === vendor.advisory.split('/').at(-1) &&
            advisory.severity === vendor.severity &&
            Number.isFinite(withdrawnAt) &&
            withdrawnAt <= Date.now() &&
            advisory.vulnerabilities?.some(
                item =>
                    item.package?.ecosystem === 'npm' &&
                    item.package.name === vendor.original &&
                    semver.satisfies(vendor.originalVersion, item.vulnerable_version_range),
            ),
        'Known origin advisory disappeared; official withdrawal could not be verified',
    );
    return {
        state: 'WITHDRAWN_UPSTREAM',
        advisory: vendor.advisory,
        name: vendor.original,
        version: vendor.originalVersion,
        withdrawnAt: advisory.withdrawn_at,
    };
}

// Private package names must never hide future upstream advisories. Query the
// recorded original identities independently; unknown findings still block policy.
export async function addSecurityOriginFindings(
    report,
    verified,
    { requestAudit = requestOriginAudit, requestAdvisory = requestOriginAdvisory, onOriginReport } = {},
) {
    const vendors = SECURITY_VENDORS.filter(vendor =>
        verified.some(
            item =>
                item.state === 'VERIFIED_SECURITY_REPLACEMENT' && item.sourceSha256 === vendor.sourceSha256,
        ),
    );
    if (!vendors.length) return report;
    const versions = Object.fromEntries(vendors.map(vendor => [vendor.original, [vendor.originalVersion]]));
    const origins = await requestAudit(versions);
    assert.ok(
        origins && typeof origins === 'object' && !Array.isArray(origins),
        'Invalid original-dependency advisory report',
    );
    assert.ok(
        Object.keys(origins).every(name => name in versions),
        'Unexpected original-dependency advisory identity',
    );
    const combined = { ...report };
    const withdrawnAdvisories = [];
    try {
        for (const vendor of vendors) {
            const findings = Object.hasOwn(origins, vendor.original) ? origins[vendor.original] : [];
            assert.ok(Array.isArray(findings), 'Invalid original-dependency advisory entry');
            if (!findings.some(item => item.url === vendor.advisory)) {
                withdrawnAdvisories.push(verifyWithdrawal(vendor, await requestAdvisory(vendor.advisory)));
            }
            const existing = report[vendor.original] ?? [];
            assert.ok(Array.isArray(existing), 'Invalid original-dependency audit entry');
            combined[vendor.original] = [...existing, ...findings];
        }
    } finally {
        await onOriginReport?.({
            versions,
            report: origins,
            withdrawnAdvisories,
            source: 'npm original dependency identities; withdrawals verified through GitHub Advisory API',
        });
    }
    return combined;
}
