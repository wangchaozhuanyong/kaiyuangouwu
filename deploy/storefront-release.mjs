import assert from 'node:assert/strict';
import {
    existsSync,
    lstatSync,
    readFileSync,
    realpathSync,
    renameSync,
    symlinkSync,
    unlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadProductionStorefronts } from './production-storefronts.mjs';
import { verifyConfiguredProductionStorefronts } from './verify-production-storefronts.mjs';

export function assertStorefrontOnly(paths) {
    const unsupported = paths.filter(path => !path.startsWith('packages/storefront/'));
    assert.deepEqual(
        unsupported,
        [],
        'Fast lane requires a full release for changes outside packages/storefront',
    );
}

// rename is atomic on the pointer's filesystem; completed releases are never edited.
export function switchStorefront(target, pointer) {
    const destination = realpathSync(target);
    assert.ok(lstatSync(resolve(destination, 'index.html')).isFile(), 'Missing storefront index');
    let previous = null;
    try {
        assert.ok(lstatSync(pointer).isSymbolicLink(), 'Storefront pointer must be a symlink');
        previous = realpathSync(pointer);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const temporary = `${pointer}.new-${process.pid}`;
    symlinkSync(destination, temporary);
    try {
        renameSync(temporary, pointer);
    } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
    }
    return previous;
}

export async function activateStorefront({ candidate, pointer, verify }) {
    const previous = realpathSync(pointer);
    let switched = false;
    const restore = () => {
        if (switched) {
            switchStorefront(previous, pointer);
            switched = false;
        }
    };
    const onSignal = () => {
        restore();
        process.exit(1);
    };
    process.once('SIGTERM', onSignal);
    process.once('SIGINT', onSignal);
    try {
        switchStorefront(candidate, pointer);
        switched = true;
        await verify();
    } catch (error) {
        restore();
        throw error;
    } finally {
        process.removeListener('SIGTERM', onSignal);
        process.removeListener('SIGINT', onSignal);
    }
    return previous;
}

// CDN analytics may add markup; every built entry/chunk reference must still be current.
export function assertServedStorefrontAssets(expectedHtml, servedHtml) {
    const assets = [...expectedHtml.matchAll(/(?:src|href)=["']((?:\/dashboard)?\/assets\/[^"']+)["']/g)].map(
        match => match[1],
    );
    assert.ok(
        assets.some(asset => asset.endsWith('.js')),
        'Built HTML has no JavaScript entry',
    );
    const served = new Set([...servedHtml.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]));
    for (const asset of assets)
        assert.ok(served.has(asset), `Public storefront is missing current asset ${asset}`);
}

async function verifyPublishedArtifact(candidate, releaseId) {
    const config = await loadProductionStorefronts();
    const expectedManifest = readFileSync(resolve(candidate, 'storefront-release.json'), 'utf8');
    const expectedIndex = readFileSync(resolve(candidate, 'index.html'), 'utf8');
    for (const { origin } of config.storefronts) {
        for (const path of ['/storefront-release.json', '/']) {
            const url = new URL(path, origin);
            url.searchParams.set('__release', releaseId);
            const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
            assert.equal(response.status, 200, `${origin}${path} is unavailable`);
            const body = await response.text();
            if (path.endsWith('.json'))
                assert.equal(body, expectedManifest, `${origin} storefront version differs`);
            else assertServedStorefrontAssets(expectedIndex, body);
        }
    }
    await verifyConfiguredProductionStorefronts({ mode: 'release', releaseId });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const [command, target, pointer, releaseId] = process.argv.slice(2);
    if (command === 'scope') {
        assertStorefrontOnly(readFileSync(0, 'utf8').split('\0').filter(Boolean));
    } else if (command === 'switch') {
        switchStorefront(target, pointer);
    } else if (command === 'activate') {
        const previous = await activateStorefront({
            candidate: target,
            pointer,
            verify: () => verifyPublishedArtifact(target, releaseId),
        });
        process.stdout.write(
            JSON.stringify({ storefront: realpathSync(pointer), previous, releaseId }) + '\n',
        );
    } else {
        throw new Error('Expected scope, switch or activate');
    }
}
