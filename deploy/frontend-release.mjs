import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { classifyChanges, STATIC_APPS } from '../scripts/ci-impact.mjs';

import { loadProductionStorefronts } from './production-storefronts.mjs';
import { assertServedStorefrontAssets, switchStorefront } from './storefront-release.mjs';

const TWO_FACTOR_DIRECTORY = '.two-factor';
export const TWO_FACTOR_POINTER = '/var/www/kaiyuangouwu-two-factor-current';

export function readTwoFactorConfig(candidate) {
    const config = JSON.parse(readFileSync(resolve(candidate, 'build-config.json'), 'utf8'));
    assert.equal(config.version, 1);
    assert.ok(Array.isArray(config.parents));
    for (const origin of [...config.parents, ...(config.origin ? [config.origin] : [])]) {
        const url = new URL(origin);
        assert.equal(url.protocol, 'https:');
        assert.equal(url.origin, origin, '2FA origins must be exact HTTPS origins');
    }
    assert.ok(config.origin === null || typeof config.origin === 'string');
    assert.ok(!config.parents.includes(config.origin), 'Vault must use a separate origin');
    return config;
}

export function validateTwoFactorCandidate(candidate) {
    const config = readTwoFactorConfig(candidate);
    const html = readFileSync(resolve(candidate, 'index.html'), 'utf8');
    assertServedStorefrontAssets(html, html);
    for (const [, asset] of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gu)) {
        assert.match(asset, /^\/assets\/[\w.-]+\.(?:js|css)$/u, 'Invalid isolated 2FA entry asset');
        assert.ok(readFileSync(resolve(candidate, asset.slice(1))).length > 0, 'Missing 2FA asset');
    }
    return config;
}

export function assertTwoFactorRouting(nginx, origin) {
    if (!origin) return;
    const host = new URL(origin).hostname;
    // nginx -T emits complete server blocks, including nested location blocks.
    const source = nginx.replace(/#[^\n]*/gu, '');
    let found = false;
    for (const match of source.matchAll(/\bserver\s*\{/gu)) {
        let depth = 1;
        let end = match.index + match[0].length;
        for (; end < source.length && depth; end++) {
            if (source[end] === '{') depth++;
            if (source[end] === '}') depth--;
        }
        const block = source.slice(match.index, end);
        const names = /\bserver_name\s+([^;]+);/u.exec(block)?.[1].trim().split(/\s+/u) ?? [];
        if (!names.includes(host)) continue;
        const port = new URL(origin).port || '443';
        if (!new RegExp(`\\blisten\\s+[^;]*\\b${port}\\b[^;]*\\bssl\\b[^;]*;`, 'u').test(block)) continue;
        found = true;
        assert.match(
            block,
            /\broot\s+\/var\/www\/kaiyuangouwu-two-factor-current\s*;/u,
            'Active vault must serve the independent 2FA pointer before a static release',
        );
        assert.ok(
            !/\b(?:alias|proxy_pass)\s/u.test(block),
            'Vault routes must serve only its static pointer',
        );
    }
    assert.ok(found, 'Configured isolated vault has no reviewed Nginx server');
}

export function frontendReleases(
    components,
    directory,
    pointers = FRONTEND_POINTERS,
    toolPointer = TWO_FACTOR_POINTER,
) {
    const releases = components.map(component => ({
        candidate: resolve(directory, component),
        pointer: pointers[component],
    }));
    if (components.includes('storefront')) {
        const candidate = resolve(directory, 'storefront', TWO_FACTOR_DIRECTORY);
        validateTwoFactorCandidate(candidate);
        const main = JSON.parse(readFileSync(resolve(directory, 'storefront/frontend-release.json'), 'utf8'));
        const tool = JSON.parse(readFileSync(resolve(candidate, 'frontend-release.json'), 'utf8'));
        assert.match(main.sourceSha, /^[a-f0-9]{40}$/u);
        assert.match(main.backendSha, /^[a-f0-9]{40}$/u);
        assert.equal(tool.sourceSha, main.sourceSha, 'Storefront and 2FA revisions differ');
        assert.equal(tool.backendSha, main.backendSha, 'Storefront and 2FA backend revisions differ');
        assert.equal(tool.component, 'two-factor');
        releases.push({ candidate, pointer: toolPointer, allowInitialize: true });
    }
    return releases;
}

export async function verifyTwoFactor(candidate, releaseId, { fetcher = fetch } = {}) {
    const { origin } = validateTwoFactorCandidate(candidate);
    const manifest = readFileSync(resolve(candidate, 'frontend-release.json'), 'utf8');
    const marker = JSON.parse(manifest);
    assert.match(marker.sourceSha, /^[a-f0-9]{40}$/u);
    assert.match(marker.backendSha, /^[a-f0-9]{40}$/u);
    assert.equal(marker.component, 'two-factor');
    if (!origin)
        return { public: false, reason: 'Isolated origin is not configured; artifact verified locally.' };
    await verifyFrontend('two-factor', candidate, releaseId, {
        config: { dashboardUrl: origin + '/', storefronts: [] },
        fetcher,
    });
    return { public: true, origin };
}

export const FRONTEND_POINTERS = {
    storefront: '/var/www/kaiyuangouwu-storefront-current',
    'next-admin': '/var/www/kaiyuangouwu-next-admin-current',
};
export function frontendChangedSinceObserved(observedSha, targetSha, component) {
    return Boolean(
        execFileSync(
            'git',
            ['diff', '--no-renames', '--name-only', observedSha, targetSha, '--', `packages/${component}/`],
            { encoding: 'utf8' },
        ).trim(),
    );
}
export function pendingFrontendComponents(
    plan,
    { storefrontSha, adminSha, targetSha },
    changedSince = frontendChangedSinceObserved,
) {
    assert.match(targetSha, /^[a-f0-9]{40}$/u);
    const observed = { storefront: storefrontSha, 'next-admin': adminSha };
    return plan.frontends.filter(component => {
        const sourceSha = observed[component];
        assert.match(sourceSha, /^[a-f0-9]{40}$/u, `Unknown active ${component} revision`);
        return sourceSha !== targetSha && changedSince(sourceSha, targetSha, component);
    });
}
export function assertFrontendScope(
    paths,
    components,
    revisions,
    changedSince = frontendChangedSinceObserved,
) {
    const plan = classifyChanges(paths);
    assert.equal(plan.lane, 'frontend', 'The cumulative production diff requires a full runtime release');
    assert.deepEqual(
        [...components].sort(),
        pendingFrontendComponents(plan, revisions, changedSince),
        'Deploy exactly the frontends changed since their active revisions',
    );
    return plan;
}
export async function activateFrontends(releases, verify) {
    const previous = releases.map(({ pointer, allowInitialize }) => {
        try {
            return realpathSync(pointer);
        } catch (error) {
            if (allowInitialize && error.code === 'ENOENT') return null;
            throw error;
        }
    });
    let switched = 0;
    const restore = () => {
        const failures = [];
        while (switched > 0) {
            const index = --switched;
            try {
                if (previous[index]) switchStorefront(previous[index], releases[index].pointer);
                else unlinkSync(releases[index].pointer);
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length) throw new AggregateError(failures, 'Frontend rollback failed');
    };
    const signal = () => {
        restore();
        process.exit(1);
    };
    process.once('SIGTERM', signal);
    process.once('SIGINT', signal);
    try {
        for (const { candidate, pointer } of releases) {
            switchStorefront(candidate, pointer);
            switched++;
        }
        await verify();
    } catch (error) {
        try {
            restore();
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'Deployment and rollback failed');
        }
        throw error;
    } finally {
        process.removeListener('SIGTERM', signal);
        process.removeListener('SIGINT', signal);
    }
    return previous;
}

export async function verifyFrontend(component, candidate, releaseId, { config, fetcher = fetch } = {}) {
    assert.ok([...STATIC_APPS, 'two-factor'].includes(component));
    config ??= await loadProductionStorefronts();
    const urls =
        component === 'storefront'
            ? config.storefronts.map(store => store.origin + '/')
            : [config.dashboardUrl];
    const expected = readFileSync(resolve(candidate, 'index.html'), 'utf8');
    const manifest = readFileSync(resolve(candidate, 'frontend-release.json'), 'utf8');
    for (const base of urls) {
        for (const [path, expectedBody] of [
            ['', expected],
            ['frontend-release.json', manifest],
        ]) {
            const url = new URL(path, base);
            url.searchParams.set('__release', releaseId);
            const response = await fetcher(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
            assert.equal(response.status, 200, `${component} entry/manifest is unavailable`);
            const body = await response.text();
            if (path) assert.equal(body, expectedBody, 'Public frontend version differs');
            else {
                assertServedStorefrontAssets(expected, body);
                for (const asset of [...expected.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gu)].map(
                    match => match[1],
                )) {
                    const assetUrl = new URL(asset, base);
                    assert.equal(assetUrl.origin, new URL(base).origin);
                    const assetResponse = await fetcher(assetUrl, { signal: AbortSignal.timeout(20000) });
                    assert.equal(
                        assetResponse.status,
                        200,
                        `Frontend entry asset is unavailable: ${assetUrl.pathname}`,
                    );
                    assert.ok(
                        !/text\/html/iu.test(assetResponse.headers.get('content-type') ?? ''),
                        'Asset request returned HTML',
                    );
                }
            }
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [command, componentList, directory, releaseId] = process.argv.slice(2);
    if (command === 'vault-routing' || command === 'vault-routing-tool') {
        const candidate =
            command === 'vault-routing' ? resolve(componentList, TWO_FACTOR_DIRECTORY) : componentList;
        const config = validateTwoFactorCandidate(candidate);
        assertTwoFactorRouting(readFileSync(0, 'utf8'), config.origin);
        process.stdout.write('TWO_FACTOR_ROUTING_OK\n');
    } else if (command === 'verify-two-factor') {
        const result = await verifyTwoFactor(componentList, directory);
        process.stdout.write(JSON.stringify(result) + '\n');
    } else {
        const components = componentList.split(',');
        assert.ok(components.length > 0 && components.every(component => STATIC_APPS.includes(component)));
        assert.equal(new Set(components).size, components.length);
        if (command === 'scope')
            assertFrontendScope(readFileSync(0, 'utf8').split('\0').filter(Boolean), components, {
                storefrontSha: process.env.STOREFRONT_SHA,
                adminSha: process.env.ADMIN_SHA,
                targetSha: process.env.TARGET_SHA,
            });
        else if (command === 'activate') {
            const releases = frontendReleases(components, directory);
            const previous = await activateFrontends(releases, async () => {
                for (const component of components)
                    await verifyFrontend(component, resolve(directory, component), releaseId);
                if (components.includes('storefront')) {
                    const result = await verifyTwoFactor(
                        resolve(directory, 'storefront', TWO_FACTOR_DIRECTORY),
                        releaseId,
                    );
                    process.stdout.write(`TWO_FACTOR_ACCEPTANCE ${JSON.stringify(result)}\n`);
                }
            });
            process.stdout.write(JSON.stringify({ components, releaseId, previous }) + '\n');
        } else throw new Error('Expected scope or activate');
    }
}
