import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    closeSync,
    existsSync,
    fsyncSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { changedPaths, inspection } from '../scripts/ci-impact.mjs';

import { loadProductionStorefronts } from './production-storefronts.mjs';
import { selectReleaseRoute } from './release-route.mjs';

export const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.8078.46 Mobile/15E148 Safari/604.1';
export const DESKTOP_UA =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const nginxTarget = '/etc/nginx/sites-available/damatong-production';
const releaseRoot = '/var/www/kaiyuangouwu-nginx-releases';
const securityHeaders = [
    'strict-transport-security',
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
];

export function assertNginxScope(
    { baseSha, targetSha, storefrontSha, adminSha },
    plan = inspection(baseSha, targetSha),
) {
    const route = selectReleaseRoute({ plan, baseSha, targetSha, storefrontSha, adminSha });
    assert.equal(route.lane, 'nginx', 'Cumulative serving changes are not eligible for a Nginx-only release');
    return route;
}

// Transaction steps are injected so failure recovery is exercised without root,
// live Nginx, customer data or process-control commands in the test suite.
export async function nginxTransaction(steps) {
    await steps.validateCandidate();
    await steps.backup();
    try {
        await steps.install();
        await steps.validateLive();
        await steps.reload();
        return await steps.verify();
    } catch (error) {
        try {
            await steps.restore();
            await steps.validateLive();
            await steps.reload();
            await steps.verifyRestored();
        } catch {
            throw new Error('Nginx release failed and configuration recovery requires attention', {
                cause: error,
            });
        }
        throw new Error('Nginx release failed; original configuration was restored and verified', {
            cause: error,
        });
    }
}

function command(program, args) {
    try {
        return execFileSync(program, args, {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch {
        // Never include subprocess output (PM2 contains environment secrets).
        throw new Error(`Nginx release command failed: ${program}`);
    }
}

function liveSnapshot() {
    let processes;
    try {
        processes = JSON.parse(command('sudo', ['-n', '-H', '-u', 'ubuntu', 'pm2', 'jlist']));
    } catch {
        throw new Error('Managed process snapshot is unavailable');
    }
    const managed = ['vendure-api', 'vendure-worker'].map(name => {
        const matches = processes.filter(process => process.name === name);
        assert.equal(matches.length, 1, 'Managed process is missing or ambiguous');
        const item = matches[0];
        assert.equal(item.pm2_env.status, 'online', 'Managed process is not online');
        assert.ok(item.pid > 0 && item.pm2_env.pm_uptime > 0);
        return {
            name,
            pid: item.pid,
            uptime: item.pm2_env.pm_uptime,
            cwd: item.pm2_env.pm_cwd,
            entry: item.pm2_env.pm_exec_path,
        };
    });
    const components = ['storefront', 'next-admin', 'two-factor'].map(name => {
        const pointer = `/var/www/kaiyuangouwu-${name}-current`;
        return {
            name,
            path: realpathSync(pointer),
            manifestSha256: sha256(readFileSync(`${pointer}/frontend-release.json`)),
        };
    });
    return {
        runtimeSha: readFileSync('/var/www/kaiyuangouwu-releases/current-sha', 'utf8').trim(),
        runtimePath: realpathSync('/var/www/kaiyuangouwu-current'),
        processes: managed,
        components,
    };
}

export async function observePublic(origins, releaseId, fetcher = fetch) {
    const observations = [];
    for (const origin of origins) {
        for (const [client, path, ua] of [
            ['desktop', '/zh/', DESKTOP_UA],
            ['iphone', '/zh/', IPHONE_UA],
            ['api', '/shop-api?query=%7B__typename%7D', IPHONE_UA],
        ]) {
            const url = new URL(path, origin);
            url.searchParams.set('nginx_release', releaseId);
            const response = await fetcher(url, {
                redirect: 'error',
                signal: AbortSignal.timeout(20000),
                headers: {
                    'User-Agent': ua,
                    'Cache-Control': 'no-cache',
                    ...(client === 'api' ? { 'Apollo-Require-Preflight': 'true' } : {}),
                },
            });
            assert.equal(response.status, 200, 'Public Nginx acceptance did not return HTTP 200');
            const headers = Object.fromEntries(
                [
                    ...securityHeaders,
                    'cross-origin-opener-policy',
                    'vary',
                    'cache-control',
                    'content-type',
                ].map(name => [name, response.headers.get(name)]),
            );
            assert.match(headers['strict-transport-security'] ?? '', /max-age=/u);
            assert.equal(headers['x-content-type-options'], 'nosniff');
            if (client === 'api') {
                const result = await response.json();
                assert.equal(typeof result.data?.__typename, 'string', 'Shop API is not ready');
            } else {
                assert.match(headers['content-type'] ?? '', /^text\/html/iu);
                assert.match(headers['cache-control'] ?? '', /no-store/iu);
                assert.ok((await response.text()).includes('<html'), 'Public HTML is incomplete');
            }
            observations.push({ origin, client, headers });
        }
    }
    return observations;
}

export function assertPublicTransition(before, after) {
    assert.equal(after.length, before.length);
    for (let index = 0; index < before.length; index++) {
        const old = before[index];
        const current = after[index];
        assert.equal(current.origin, old.origin);
        assert.equal(current.client, old.client);
        for (const name of securityHeaders)
            assert.equal(current.headers[name], old.headers[name], `Security header changed: ${name}`);
        const expected = current.client === 'iphone' ? null : 'same-origin-allow-popups';
        assert.equal(
            current.headers['cross-origin-opener-policy'],
            expected,
            'Unexpected public COOP policy',
        );
        // The public CDN may not preserve the origin's User-Agent Vary value.
        // observePublic requires no-store on every HTML response, so cache safety
        // is enforced through Cache-Control at the public edge.
    }
}

export function atomicConfig(target, bytes, suffix) {
    const temporary = `${target}.${suffix}.pending`;
    let created = false;
    let descriptor;
    try {
        descriptor = openSync(temporary, 'wx', 0o644);
        created = true;
        writeFileSync(descriptor, bytes);
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(temporary, target);
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
        if (created && existsSync(temporary)) unlinkSync(temporary);
    }
}

async function activate({ candidate, targetSha, configSha256, previousSha256, releaseId }) {
    assert.match(targetSha, /^[a-f0-9]{40}$/u);
    for (const hash of [configSha256, previousSha256]) assert.match(hash, /^[a-f0-9]{64}$/u);
    assert.match(releaseId, new RegExp(`^nginx-${targetSha}-[0-9]+-[0-9]+$`, 'u'));
    const directory = resolve(releaseRoot, releaseId);
    assert.equal(realpathSync(dirname(candidate)), directory);
    assert.equal(resolve(candidate), `${directory}/damatong.conf`);
    for (const file of [candidate, nginxTarget])
        assert.ok(
            lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),
            'Nginx configuration must be a regular file',
        );
    const original = readFileSync(nginxTarget);
    const replacement = readFileSync(candidate);
    assert.equal(sha256(original), previousSha256, 'Active Nginx configuration drifted');
    assert.equal(sha256(replacement), configSha256, 'Candidate configuration checksum differs');
    const snapshot = liveSnapshot();
    const origins = (await loadProductionStorefronts()).storefronts.map(store => store.origin);
    const before = await observePublic(origins, `${releaseId}-before`);
    const verifySnapshot = () =>
        assert.deepEqual(liveSnapshot(), snapshot, 'API, Worker or frontend identity changed');
    const metadata = {
        sourceSha: targetSha,
        configSha256,
        previousSha256,
        releaseId,
        before: snapshot,
        startedAt: new Date().toISOString(),
    };
    const receipt = await nginxTransaction({
        validateCandidate: () => {
            const result = JSON.parse(
                command('python3', [
                    '-B',
                    fileURLToPath(new URL('./validate-nginx-candidate.py', import.meta.url)),
                    candidate,
                ]),
            );
            assert.equal(result.exitCode, 0);
            assert.equal(result.productionTempDirectoriesUnchanged, true);
        },
        backup: () => {
            writeFileSync(`${directory}/previous.conf`, original, { flag: 'wx', mode: 0o600 });
            writeFileSync(`${directory}/before.json`, JSON.stringify(metadata) + '\n', {
                flag: 'wx',
                mode: 0o600,
            });
        },
        install: () => atomicConfig(nginxTarget, replacement, releaseId),
        validateLive: () => command('nginx', ['-t']),
        reload: () => command('systemctl', ['reload', 'nginx']),
        verify: async () => {
            const after = await observePublic(origins, `${releaseId}-after`);
            assertPublicTransition(before, after);
            assert.equal(sha256(readFileSync(nginxTarget)), configSha256);
            verifySnapshot();
            const accepted = {
                ...metadata,
                completedAt: new Date().toISOString(),
                after: snapshot,
                observations: after,
                result: 'PASS',
            };
            // Persist before committing the transaction so receipt write failures
            // take the same verified configuration recovery path as reload failures.
            writeFileSync(`${directory}/acceptance.json`, JSON.stringify(accepted) + '\n', {
                flag: 'wx',
                mode: 0o600,
            });
            const marker = `${releaseRoot}/.current-${releaseId}.json`;
            writeFileSync(marker, JSON.stringify(accepted) + '\n', { flag: 'wx', mode: 0o600 });
            renameSync(marker, `${releaseRoot}/current.json`);
            return accepted;
        },
        restore: () => {
            const backup = readFileSync(`${directory}/previous.conf`);
            assert.equal(sha256(backup), previousSha256);
            atomicConfig(nginxTarget, backup, releaseId + '-restore');
        },
        verifyRestored: async () => {
            assert.equal(sha256(readFileSync(nginxTarget)), previousSha256);
            const restored = await observePublic(origins, `${releaseId}-restored`);
            // Vary/order can be normalized at the edge. Compare every security
            // header and COOP to the previously observed native public response.
            for (let i = 0; i < before.length; i++)
                for (const name of [...securityHeaders, 'cross-origin-opener-policy'])
                    assert.equal(restored[i].headers[name], before[i].headers[name]);
            verifySnapshot();
            writeFileSync(
                `${directory}/recovery.json`,
                JSON.stringify({ sourceSha: targetSha, result: 'RESTORED', at: new Date().toISOString() }) +
                    '\n',
                { flag: 'wx', mode: 0o600 },
            );
        },
    });
    // The receipt records Nginx only; runtime/frontend markers are never written.
    process.stdout.write(`NGINX_RECEIPT ${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv[2] === 'scope') {
        const [baseSha, targetSha, storefrontSha, adminSha] = process.argv.slice(3);
        assertNginxScope({ baseSha, targetSha, storefrontSha, adminSha });
        assert.ok(changedPaths(baseSha, targetSha).includes('deploy/nginx/damatong.conf'));
        process.stdout.write('NGINX_SCOPE_OK\n');
    } else if (process.argv[2] === 'activate') {
        const [candidate, targetSha, configSha256, previousSha256, releaseId] = process.argv.slice(3);
        await activate({ candidate, targetSha, configSha256, previousSha256, releaseId });
    } else {
        throw new Error('Unknown Nginx release command');
    }
}
