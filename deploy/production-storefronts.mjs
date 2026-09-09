#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_PRODUCTION_STOREFRONTS_PATH = fileURLToPath(
    new URL('./production-storefronts.json', import.meta.url),
);

function httpsUrl(value, label, { rootOnly = false } = {}) {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    const url = new URL(value);
    assert.equal(url.protocol, 'https:', `${label} must use https`);
    assert.ok(!url.username && !url.password, `${label} must not contain credentials`);
    assert.ok(!url.search && !url.hash, `${label} must not contain query parameters or a fragment`);
    if (rootOnly) assert.equal(url.pathname, '/', `${label} must be an origin without a path`);
    return url;
}

export function validateProductionStorefronts(input) {
    assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'Invalid storefront config');
    const dashboardUrl = httpsUrl(input.dashboardUrl, 'dashboardUrl').href;
    assert.ok(
        Array.isArray(input.storefronts) && input.storefronts.length > 0,
        'At least one store is required',
    );

    const origins = new Set();
    const channelCodes = new Set();
    const storefronts = input.storefronts.map((store, index) => {
        assert.ok(
            store && typeof store === 'object' && !Array.isArray(store),
            `Invalid store at index ${index}`,
        );
        const origin = httpsUrl(store.origin, `storefronts[${index}].origin`, { rootOnly: true }).origin;
        const expectedChannelCode = String(store.expectedChannelCode ?? '').trim();
        assert.ok(expectedChannelCode, `storefronts[${index}].expectedChannelCode is required`);
        assert.ok(!origins.has(origin), `Duplicate storefront origin: ${origin}`);
        assert.ok(
            !channelCodes.has(expectedChannelCode),
            `Duplicate expected Channel: ${expectedChannelCode}`,
        );
        origins.add(origin);
        channelCodes.add(expectedChannelCode);
        return { origin, expectedChannelCode };
    });

    return { dashboardUrl, storefronts };
}

export async function loadProductionStorefronts(configPath = DEFAULT_PRODUCTION_STOREFRONTS_PATH) {
    return validateProductionStorefronts(JSON.parse(await readFile(configPath, 'utf8')));
}

async function main() {
    const { values } = parseArgs({
        options: {
            config: { type: 'string', default: DEFAULT_PRODUCTION_STOREFRONTS_PATH },
            field: { type: 'string' },
        },
        strict: true,
    });
    const config = await loadProductionStorefronts(values.config);
    if (values.field === 'first-origin') {
        process.stdout.write(`${config.storefronts[0].origin}\n`);
        return;
    }
    if (values.field === 'dashboard-url') {
        process.stdout.write(`${config.dashboardUrl}\n`);
        return;
    }
    if (values.field === 'origins') {
        process.stdout.write(`${config.storefronts.map(store => store.origin).join(',')}\n`);
        return;
    }
    assert.ok(!values.field, 'field must be first-origin, dashboard-url or origins');
    process.stdout.write(`${JSON.stringify(config)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        process.stderr.write(`Production storefront configuration failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}
