import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { compensationFingerprint } from './public-preview-legacy-compensation.mjs';
import { validateLegacyDigitalReviewArtifact } from './public-preview-legacy-digital-compensation.mjs';

const exec = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const PROTECTION_MANIFEST_VERSION = 'public-preview-installed-protections-v1';
export const PROTECTION_MANIFEST_FILE = 'PUBLIC-PREVIEW-PROTECTIONS.json';
export const REQUIRED_EXECUTION_FILES = Object.freeze([
    'verify-runtime.mjs',
    'production-runtime-audit.mjs',
    'RUNTIME-SYMLINKS.json',
    'packages/dev-server/dist/index.js',
    'packages/dev-server/dist/index-worker.js',
    'packages/dev-server/dist/dev-config.js',
    'packages/dev-server/dist/storefront-cache-config.js',
    'packages/core/dist/index.js',
    'packages/core/dist/bootstrap.js',
    'packages/store-management-plugin/dist/index.js',
    'packages/storefront-cart-plugin/dist/index.js',
    'packages/commerce-fulfillment-plugin/dist/index.js',
    'packages/operations-dashboard-plugin/dist/index.js',
    ...[
        'legacy-compensation',
        'legacy-compensation-host',
        'legacy-digital-compensation',
        'legacy-digital-compensation-host',
        'production-verification',
        'managed-digital-closeout',
    ].map(name => `packages/dev-server/scripts/public-preview-${name}.mjs`),
]);

export function runtimeConfigurationFingerprints(environment) {
    const env = typeof environment === 'function' ? environment : key => environment[key];
    // Match the actual dev-config precedence; this identifies the listener used for readback.
    const apiPort = Number(env('PORT')) || Number(env('API_PORT')) || 3000;
    assert.ok(Number.isInteger(apiPort) && apiPort > 0 && apiPort < 65536, 'Actual API port is invalid');
    const apiHostname =
        env('VENDURE_HOSTNAME') || (env('NODE_ENV') === 'production' ? '127.0.0.1' : undefined);
    assert.ok(
        ['127.0.0.1', '::1'].includes(apiHostname),
        'Managed readback requires a concrete actual loopback listener',
    );
    assert.ok(
        ['mysql', 'mariadb'].includes(env('DB') || 'mysql'),
        'Running native MySQL configuration required',
    );
    assert.ok(
        env('DB_NAME')?.trim() && env('DB_USERNAME')?.trim(),
        'Actual process DB identity is unavailable',
    );
    const configurationFingerprint = compensationFingerprint({
        DB_CONNECTION_TYPE: 'mariadb',
        DB_HOST: env('DB_HOST') || '127.0.0.1',
        DB_PORT: String(Number(env('DB_PORT')) || 3306),
        DB_NAME: env('DB_NAME').trim(),
        DB_USERNAME: env('DB_USERNAME').trim(),
    });
    const address = env('STOREFRONT_REDIS_URL')?.trim();
    assert.ok(address, 'Running shared Redis configuration required for managed closeout');
    let url;
    try {
        url = new URL(address);
    } catch {
        throw new Error('Running Redis configuration is invalid');
    }
    assert.ok(['redis:', 'rediss:'].includes(url.protocol), 'Running Redis scheme is invalid');
    const cacheConfigurationFingerprint = compensationFingerprint({
        namespace: 'vendure-storefront-cache-v1',
        host: url.hostname,
        port: Number(url.port || 6379),
        db: Number(url.pathname.slice(1) || 0),
        username: url.username ? decodeURIComponent(url.username) : null,
        tls: url.protocol === 'rediss:',
    });
    return { configurationFingerprint, cacheConfigurationFingerprint, apiPort, apiHostname };
}
// These are the actual production modules, not test fixtures or user-supplied booleans.
export const REQUIRED_PROTECTION_PAIRS = Object.freeze(
    [
        ['common', 'controlled-test-payment', 'lib'],
        ['core', 'service/services/order.service', 'dist'],
        ['core', 'service/services/payment-method.service', 'dist'],
        ['commerce-fulfillment-plugin', 'checkout-resources.service', 'dist'],
        ['commerce-fulfillment-plugin', 'commerce-fulfillment.plugin', 'dist'],
        ['commerce-fulfillment-plugin', 'digital-fulfillment.guard', 'dist'],
        ['commerce-fulfillment-plugin', 'digital-order-entitlement', 'dist'],
        ['commerce-fulfillment-plugin', 'fulfillment-delivery.service', 'dist'],
        ['commerce-fulfillment-plugin', 'manual-digital-delivery.service', 'dist'],
        ['store-management-plugin', 'storefront-activation.service', 'dist'],
        ['store-management-plugin', 'storefront-activation.interceptor', 'dist'],
        ['store-management-plugin', 'store-management.plugin', 'dist'],
        ['store-management-plugin', 'promotion/store-coupon-lifecycle.service', 'dist'],
        ['operations-dashboard-plugin', 'incident-response.service', 'dist'],
        ['operations-dashboard-plugin', 'admin-notification.service', 'dist'],
    ].map(([pkg, name, output]) =>
        Object.freeze({
            source: `packages/${pkg}/src/${name}.ts`,
            compiled: `packages/${pkg}/${output}/${name}.js`,
        }),
    ),
);

export function validateProtectionManifest(manifest, expectedReleaseSha) {
    assert.match(expectedReleaseSha, /^[a-f0-9]{40}$/u, 'Exact release SHA required');
    assert.equal(manifest?.version, PROTECTION_MANIFEST_VERSION, 'Protection manifest version mismatch');
    assert.equal(manifest.releaseSha, expectedReleaseSha, 'Protection source release mismatch');
    assert.deepEqual(
        manifest.files?.map(({ source, compiled }) => ({ source, compiled })),
        REQUIRED_PROTECTION_PAIRS,
        'Protection coverage or order mismatch',
    );
    for (const row of manifest.files) {
        assert.match(row.sourceSha256, /^[a-f0-9]{64}$/u, 'Missing reviewed source digest');
        assert.match(row.compiledSha256, /^[a-f0-9]{64}$/u, 'Missing compiled digest');
    }
    return manifest;
}

async function readPinnedJson(file, expectedDigest) {
    assert.match(expectedDigest, /^[a-f0-9]{64}$/u, 'Independent pinned evidence digest required');
    const bytes = await readFile(file);
    assert.equal(digest(bytes), expectedDigest, 'Pinned evidence changed');
    return JSON.parse(bytes.toString('utf8'));
}

async function readInstalledFile(root, relative) {
    const file = path.resolve(root, relative);
    assert.ok(file.startsWith(root + path.sep), 'Runtime input escaped installed directory');
    assert.equal(await realpath(file), file, 'Protected runtime input must not redirect through symlinks');
    return { bytes: await readFile(file), file, attributes: await stat(file) };
}

export function validateRuntimeObservation(observation, releaseRoot, expectedReleaseSha) {
    const { metadata, processes, protectedFiles } = observation;
    assert.equal(metadata?.gitSha, expectedReleaseSha, 'Installed release SHA mismatch');
    assert.equal(metadata.sourceDirty, false, 'Dirty runtime artifact is forbidden');
    assert.equal(metadata.platform, 'linux/x64', 'Actual production artifact platform required');
    assert.equal(processes.length, 2, 'Both actual API and worker are required');
    for (const [i, name] of ['vendure-api', 'vendure-worker'].entries()) {
        const p = processes[i];
        const entry = path.join(
            releaseRoot,
            'packages/dev-server/dist',
            i === 0 ? 'index.js' : 'index-worker.js',
        );
        assert.equal(p.name, name, 'Managed process identity mismatch');
        assert.equal(p.status, 'online', 'Managed runtime is not online');
        assert.ok(Number.isSafeInteger(p.pid) && p.pid > 0, 'Actual kernel PID missing');
        assert.equal(p.cwd, releaseRoot, 'Actual process cwd differs from installed release');
        assert.equal(p.managedCwd, releaseRoot, 'Managed process cwd mismatch');
        assert.equal(p.entry, entry, 'Managed entry mismatch');
        assert.equal(p.kernelEntry, entry, 'Kernel process entry mismatch');
        assert.ok(Number.isFinite(p.startedAtMs) && p.startedAtMs > 0, 'Kernel start time missing');
        assert.equal(p.pidStable, true, 'Process changed during observation');
        assert.ok(
            protectedFiles.length >= REQUIRED_PROTECTION_PAIRS.length * 2 + 2,
            'Installed source and compiled evidence incomplete',
        );
        for (const file of protectedFiles) {
            assert.equal(file.hashMatches, true, 'Installed protection bytes mismatch');
            // An artifact changed after startup cannot attest the code loaded in this process.
            assert.ok(
                file.mtimeMs <= p.startedAtMs && file.ctimeMs <= p.startedAtMs,
                'Runtime inputs changed after the actual process started',
            );
        }
    }
    assert.notEqual(processes[0].pid, processes[1].pid, 'API and worker PID must be distinct');
    return observation;
}

async function observeKernelProcess(managed, releaseRoot, clockTicks, bootMs) {
    const pid = managed.pid;
    assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Managed PID missing');
    const proc = `/proc/${pid}`;
    const before = await readFile(`${proc}/stat`, 'utf8');
    const fields = before
        .slice(before.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/u);
    const startedAtMs = bootMs + (Number(fields[19]) * 1000) / clockTicks;
    const environment = (await readFile(`${proc}/environ`, 'utf8')).split('\0');
    // Read only whitelisted identity values. Never include the environment in a receipt or error.
    const envValue = key => environment.find(value => value.startsWith(`${key}=`))?.slice(key.length + 1);
    const command = (await readFile(`${proc}/cmdline`, 'utf8')).split('\0');
    const entry = managed.pm2_env?.pm_exec_path;
    // PM2 sets process.title to this exact Node entry, replacing /proc/cmdline's original argv.
    const direct =
        command.includes(entry) ||
        command.some(value => value === `node ${entry}` || value === `nodejs ${entry}`);
    const pm2 =
        command.some(value => value.endsWith('/pm2/lib/ProcessContainerFork.js')) &&
        envValue('pm_exec_path') === entry &&
        envValue('pm_cwd') === releaseRoot;
    assert.ok(direct || pm2, 'Kernel command does not prove the expected production entry');
    assert.match(
        path.basename(await realpath(`${proc}/exe`)),
        /^node(?:js)?$/u,
        'Actual Node runtime required',
    );
    const cwd = await realpath(`${proc}/cwd`);
    const after = await readFile(`${proc}/stat`, 'utf8');
    return {
        name: managed.name,
        pid,
        status: managed.pm2_env?.status,
        managedCwd: managed.pm2_env?.pm_cwd,
        entry,
        cwd,
        kernelEntry: direct || pm2 ? entry : null,
        startedAtMs,
        ...runtimeConfigurationFingerprints(envValue),
        pidStable:
            before.slice(0, before.lastIndexOf(')') + 1) === after.slice(0, after.lastIndexOf(')') + 1) &&
            fields[19] ===
                after
                    .slice(after.lastIndexOf(')') + 2)
                    .trim()
                    .split(/\s+/u)[19],
    };
}

// No test/dependency injection in this production collector. Every invocation re-reads the
// installed bytes and actual Linux process identities; callers cannot supply a VERIFIED JSON.
export function createProductionRuntimeVerifier({
    releaseRoot,
    expectedReleaseSha,
    protectionManifestPath,
    protectionManifestSha256,
    artifactChecksumSha256,
}) {
    const previouslyVerifiedBytes = new Map();
    let boundRuntimeConfiguration;
    return async () => {
        assert.equal(process.platform, 'linux', 'Actual Linux production runtime required');
        const root = path.resolve(releaseRoot);
        assert.equal(await realpath(root), root, 'Use immutable release directory, not current symlink');
        assert.equal(
            path.resolve(protectionManifestPath),
            path.join(root, PROTECTION_MANIFEST_FILE),
            'Use installed protected manifest',
        );
        const manifest = validateProtectionManifest(
            await readPinnedJson(protectionManifestPath, protectionManifestSha256),
            expectedReleaseSha,
        );
        const metadata = JSON.parse((await readInstalledFile(root, 'RUNTIME-METADATA.json')).bytes);
        const { stdout: pm2Json } = await exec('pm2', ['jlist'], { maxBuffer: 8 * 1024 * 1024 });
        const pm2Processes = JSON.parse(pm2Json);
        const managed = ['vendure-api', 'vendure-worker'].map(name => {
            const matches = pm2Processes.filter(p => p.name === name);
            assert.equal(matches.length, 1, 'Unique managed API/worker required');
            return matches[0];
        });
        const { stdout: ticks } = await exec('getconf', ['CLK_TCK']);
        const clockTicks = Number(ticks.trim());
        assert.ok(Number.isFinite(clockTicks) && clockTicks > 0, 'Kernel clock frequency missing');
        const bootMs = Date.now() - Number((await readFile('/proc/uptime', 'utf8')).split(' ')[0]) * 1000;
        const processes = await Promise.all(
            managed.map(p => observeKernelProcess(p, root, clockTicks, bootMs)),
        );
        const checksumBytes = (await readInstalledFile(root, 'SHA256SUMS')).bytes;
        assert.match(
            artifactChecksumSha256,
            /^[a-f0-9]{64}$/u,
            'Independently pinned artifact checksum required',
        );
        assert.equal(digest(checksumBytes), artifactChecksumSha256, 'Installed checksum manifest changed');
        const checksums = new Map(
            checksumBytes
                .toString('utf8')
                .trim()
                .split('\n')
                .map(line => {
                    const match = /^([a-f0-9]{64}) [ *](.+)$/u.exec(line);
                    assert.ok(match, 'Invalid artifact checksum entry');
                    return [match[2].replace(/^\.\//u, ''), match[1]];
                }),
        );
        assert.equal(
            checksums.size,
            checksumBytes.toString('utf8').trim().split('\n').length,
            'Duplicate artifact checksum paths',
        );
        for (const file of REQUIRED_EXECUTION_FILES)
            assert.ok(checksums.has(file), 'Actual execution input omitted from pinned artifact');
        const installedFiles = new Map();
        for (const [relative, expected] of checksums) {
            const file = path.resolve(root, relative);
            assert.ok(file.startsWith(root + path.sep), 'Artifact checksum path escaped release');
            assert.equal(await realpath(file), file, 'Artifact regular input redirects through symlink');
            const attributes = await stat(file);
            const signature = [
                attributes.dev,
                attributes.ino,
                attributes.size,
                attributes.mtimeMs,
                attributes.ctimeMs,
                attributes.mode,
            ].join(':');
            const prior = previouslyVerifiedBytes.get(relative);
            if (!prior || prior.signature !== signature || prior.sha256 !== expected) {
                assert.equal(digest(await readFile(file)), expected, 'Installed artifact payload changed');
            }
            for (const p of processes)
                assert.ok(
                    attributes.ctimeMs <= p.startedAtMs && attributes.mtimeMs <= p.startedAtMs,
                    'Execution dependency changed after process startup',
                );
            const observed = { signature, sha256: expected, attributes, file };
            installedFiles.set(relative, observed);
        }
        // Import only pinned verifier bytes, and use its side-effect-free inventory reader.
        const { collectArtifactEntries } = await import(pathToFileURL(path.join(root, 'verify-runtime.mjs')));
        const actualEntries = await collectArtifactEntries(root);
        const mutableBindings = new Set([
            '.env',
            'packages/dev-server/.env',
            'assets',
            'packages/dev-server/assets',
            'static',
            'packages/dev-server/static',
        ]);
        const regularFiles = actualEntries
            .filter(e => e.type === 'file' && e.path !== 'SHA256SUMS' && !mutableBindings.has(e.path))
            .map(e => e.path)
            .sort();
        assert.deepEqual(
            regularFiles,
            [...checksums.keys()].sort(),
            'Unreviewed executable artifact contents',
        );
        const links = JSON.parse(await readFile(path.join(root, 'RUNTIME-SYMLINKS.json'), 'utf8'));
        const actualLinks = actualEntries
            .filter(e => e.type === 'symlink' && !mutableBindings.has(e.path))
            .map(({ path: linkPath, target }) => ({ path: linkPath, target }));
        assert.deepEqual(
            actualLinks,
            links.filter(e => !mutableBindings.has(e.path)),
            'Actual module symlink closure changed',
        );
        const observedLinks = [];
        for (const link of actualLinks) {
            assert.equal(await readlink(path.join(root, link.path)), link.target, 'Module link changed');
            const target = await realpath(path.join(root, link.path));
            assert.ok(target.startsWith(root + path.sep), 'Loaded dependency escapes installed release');
            const attributes = await lstat(path.join(root, link.path));
            for (const p of processes)
                assert.ok(
                    attributes.ctimeMs <= p.startedAtMs && attributes.mtimeMs <= p.startedAtMs,
                    'Module link changed after actual runtime startup',
                );
            observedLinks.push({
                ...link,
                resolvedTarget: target,
                signature: [
                    attributes.dev,
                    attributes.ino,
                    attributes.ctimeMs,
                    attributes.mtimeMs,
                    attributes.mode,
                ].join(':'),
            });
        }
        assert.equal(
            processes[0].configurationFingerprint,
            processes[1].configurationFingerprint,
            'Actual API and worker databases differ',
        );
        assert.equal(
            processes[0].cacheConfigurationFingerprint,
            processes[1].cacheConfigurationFingerprint,
            'Actual API and worker caches differ',
        );
        assert.equal(
            processes[0].apiPort,
            processes[1].apiPort,
            'Actual API and worker listener configurations differ',
        );
        assert.equal(
            processes[0].apiHostname,
            processes[1].apiHostname,
            'Actual API and worker listener addresses differ',
        );
        const protectedFiles = [];
        const rows = manifest.files.flatMap(row => [
            [row.source, row.sourceSha256],
            [row.compiled, row.compiledSha256],
        ]);
        rows.push(
            [PROTECTION_MANIFEST_FILE, protectionManifestSha256],
            ['RUNTIME-METADATA.json', checksums.get('RUNTIME-METADATA.json')],
        );
        for (const [relative, expected] of rows) {
            const installed = installedFiles.get(relative);
            assert.ok(installed, 'Guard missing from verified payload');
            const actual = installed.sha256;
            assert.equal(
                checksums.get(relative),
                expected,
                'Artifact coverage differs from pinned protections',
            );
            protectedFiles.push({
                path: relative,
                sha256: actual,
                hashMatches: actual === expected,
                mtimeMs: installed.attributes.mtimeMs,
                ctimeMs: installed.attributes.ctimeMs,
            });
        }
        validateRuntimeObservation({ metadata, processes, protectedFiles }, root, expectedReleaseSha);
        // Re-read PM2 and kernel identities after hashing to reject a concurrent switch/restart.
        const { stdout: finalPm2 } = await exec('pm2', ['jlist'], { maxBuffer: 8 * 1024 * 1024 });
        const finalProcesses = JSON.parse(finalPm2);
        for (const p of processes) {
            const current = finalProcesses.find(item => item.name === p.name);
            assert.equal(current?.pid, p.pid, 'Runtime restarted during verification');
            const final = await observeKernelProcess(current, root, clockTicks, bootMs);
            assert.equal(final.startedAtMs, p.startedAtMs, 'Runtime PID was reused');
            assert.equal(final.cwd, root, 'Runtime switched during verification');
            assert.equal(final.status, 'online', 'Runtime stopped during verification');
            assert.equal(final.apiPort, p.apiPort, 'Runtime listener changed');
            assert.equal(final.apiHostname, p.apiHostname, 'Runtime listener address changed');
            assert.equal(final.configurationFingerprint, p.configurationFingerprint, 'Runtime DB changed');
            assert.equal(
                final.cacheConfigurationFingerprint,
                p.cacheConfigurationFingerprint,
                'Runtime cache changed',
            );
        }
        for (const [relative, observed] of installedFiles) {
            const attributes = await stat(observed.file);
            assert.equal(
                [
                    attributes.dev,
                    attributes.ino,
                    attributes.size,
                    attributes.mtimeMs,
                    attributes.ctimeMs,
                    attributes.mode,
                ].join(':'),
                observed.signature,
                'Artifact changed during runtime verification',
            );
            previouslyVerifiedBytes.set(relative, observed);
        }
        for (const link of observedLinks) {
            const file = path.join(root, link.path);
            const attributes = await lstat(file);
            assert.equal(
                [
                    attributes.dev,
                    attributes.ino,
                    attributes.ctimeMs,
                    attributes.mtimeMs,
                    attributes.mode,
                ].join(':'),
                link.signature,
                'Module link changed during verification',
            );
            assert.equal(await readlink(file), link.target, 'Module target changed during verification');
            assert.equal(
                await realpath(file),
                link.resolvedTarget,
                'Module resolution changed during verification',
            );
        }
        assert.equal(
            digest(await readFile(path.join(root, 'SHA256SUMS'))),
            artifactChecksumSha256,
            'Artifact manifest changed during verification',
        );
        const currentConfiguration = {
            configurationFingerprint: processes[0].configurationFingerprint,
            cacheConfigurationFingerprint: processes[0].cacheConfigurationFingerprint,
            apiPort: processes[0].apiPort,
            apiHostname: processes[0].apiHostname,
        };
        if (boundRuntimeConfiguration)
            assert.deepEqual(
                currentConfiguration,
                boundRuntimeConfiguration,
                'Running targets changed within this managed session',
            );
        boundRuntimeConfiguration = currentConfiguration;
        return {
            status: 'VERIFIED',
            runtimeSha: expectedReleaseSha,
            releaseSha: expectedReleaseSha,
            protectionsFingerprint: compensationFingerprint({ manifest, processes, protectedFiles }),
            sourceHashesVerified: true,
            nativeFundingGuardsVerified: true,
            testOrderDeliveryGuardsVerified: true,
            historicalDigitalCloseoutGuardsVerified: true,
            artifactChecksumsFingerprint: artifactChecksumSha256,
            filesVerified: installedFiles.size,
            configurationFingerprint: processes[0].configurationFingerprint,
            cacheConfigurationFingerprint: processes[0].cacheConfigurationFingerprint,
            apiPort: processes[0].apiPort,
            apiHostname: processes[0].apiHostname,
            capturedAt: new Date().toISOString(),
            processes,
            protectedFiles,
        };
    };
}

export function createPinnedReviewVerifier({
    reviewPath,
    reviewSha256,
    expectedSourceSnapshotSha256,
    expectedReviewerId,
}) {
    assert.match(expectedSourceSnapshotSha256, /^[a-f0-9]{64}$/u, 'Pinned native snapshot digest required');
    assert.ok(
        typeof expectedReviewerId === 'string' && expectedReviewerId.trim(),
        'Independent reviewer identity required',
    );
    return async (reviewArtifact, expected) => {
        const envelope = await readPinnedJson(reviewPath, reviewSha256);
        assert.equal(
            envelope.version,
            'public-preview-independent-review-envelope-v1',
            'Review envelope missing',
        );
        assert.equal(envelope.sourceSnapshotSha256, expectedSourceSnapshotSha256, 'Review snapshot mismatch');
        assert.equal(envelope.reviewerId, expectedReviewerId, 'Independent reviewer mismatch');
        assert.notEqual(envelope.reviewerId, envelope.executorId, 'Executor cannot approve its own evidence');
        assert.equal(envelope.decision, 'APPROVED', 'Independent review did not approve');
        assert.equal(
            envelope.reviewArtifact.externalDeliveryOutcome,
            'NOT_VERIFIED',
            'User test classification does not prove external delivery outcome',
        );
        assert.deepEqual(
            reviewArtifact,
            envelope.reviewArtifact,
            'Execution review differs from approved bytes',
        );
        validateLegacyDigitalReviewArtifact(reviewArtifact, expected);
        return true;
    };
}
