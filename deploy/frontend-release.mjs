import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { classifyChanges, STATIC_APPS } from '../scripts/ci-impact.mjs';

import { loadProductionStorefronts } from './production-storefronts.mjs';
import { assertServedStorefrontAssets, switchStorefront } from './storefront-release.mjs';

export const FRONTEND_POINTERS = {
    storefront: '/var/www/kaiyuangouwu-storefront-current',
    'next-admin': '/var/www/kaiyuangouwu-next-admin-current',
};
export function assertFrontendScope(paths, components) {
    const plan = classifyChanges(paths);
    assert.equal(plan.lane, 'frontend', 'The cumulative production diff requires a full runtime release');
    assert.deepEqual(
        [...components].sort(),
        plan.frontends,
        'All changed frontends must be deployed together',
    );
    return plan;
}
export async function activateFrontends(releases, verify) {
    const previous = releases.map(({ pointer }) => realpathSync(pointer));
    let switched = 0;
    const restore = () => {
        const failures = [];
        while (switched > 0) {
            const index = --switched;
            try {
                switchStorefront(previous[index], releases[index].pointer);
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
    assert.ok(STATIC_APPS.includes(component));
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
    const components = componentList.split(',');
    assert.ok(components.length > 0 && components.every(component => STATIC_APPS.includes(component)));
    assert.equal(new Set(components).size, components.length);
    if (command === 'scope')
        assertFrontendScope(readFileSync(0, 'utf8').split('\0').filter(Boolean), components);
    else if (command === 'activate') {
        const releases = components.map(component => ({
            candidate: resolve(directory, component),
            pointer: FRONTEND_POINTERS[component],
        }));
        const previous = await activateFrontends(releases, async () => {
            for (const component of components)
                await verifyFrontend(component, resolve(directory, component), releaseId);
        });
        process.stdout.write(JSON.stringify({ components, releaseId, previous }) + '\n');
    } else throw new Error('Expected scope or activate');
}
