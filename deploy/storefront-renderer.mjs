import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export const STOREFRONT_RENDERER_FILE = '.server/public-page-renderer.cjs';

// The backend loads this exact interface from the active frontend release.
export function assertStorefrontRenderer(directory) {
    const file = resolve(directory, STOREFRONT_RENDERER_FILE);
    let stats;
    try {
        stats = statSync(file);
    } catch {
        throw new Error('Missing storefront public page renderer');
    }
    assert.ok(stats.isFile() && stats.size > 0, 'Missing storefront public page renderer');
    const require = createRequire(import.meta.url);
    delete require.cache[require.resolve(file)];
    const renderer = require(file);
    assert.equal(typeof renderer.renderPublicPage, 'function', 'Invalid storefront public page renderer');
}
