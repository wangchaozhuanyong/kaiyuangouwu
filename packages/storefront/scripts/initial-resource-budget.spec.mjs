import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

import { initialResourceCosts, initialRouteRoots, staticModuleImports } from './initial-resource-budget.mjs';

test('static closure excludes dynamic branches, comment/string lookalikes and import.meta', () => {
    assert.deepEqual(
        staticModuleImports(`
      import { value } from './vendor.js'; import './side-effect.js';
      export { value as thing } from './shared.js';
      const text="import './not-a-module.js'";
      // import './comment.js';
      const later=()=>import('./lazy.js'); const url=import.meta.url;
    `),
        ['./vendor.js', './side-effect.js', './shared.js'],
    );
});

test('initial budgets deduplicate vendor cycles and attach only selected route CSS', async () => {
    const root = await mkdtemp(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '.resource-budget-test-'),
    );
    try {
        await mkdir(path.join(root, 'assets'));
        const files = new Map([
            [
                'entry-12345678.js',
                `import './vendor-12345678.js';const later=()=>import('./unselected-12345678.js');`,
            ],
            ['vendor-12345678.js', `import './entry-12345678.js';`],
            ['base-12345678.css', 'base{}'],
            ['route-12345678.css', 'route{}'],
            ['unselected-12345678.js', 'x'.repeat(10000)],
        ]);
        for (const patterns of Object.values(initialRouteRoots))
            for (const pattern of patterns) {
                const name = pattern.source
                    .replace(/^\^/u, '')
                    .replace(/\$$/u, '')
                    .replace('[\\w-]{8}', '12345678')
                    .replace('.*', '12345678')
                    .replace(/\\\./gu, '.');
                files.set(name, `import './vendor-12345678.js';`);
            }
        files.set(
            'preload-12345678.js',
            'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=[' +
                '"assets/business-services-page-12345678.js","assets/route-12345678.css"])))=>i.map(i=>d[i]); ' +
                'const load=()=>preload(()=>import("./business-services-page-12345678.js"),__vite__mapDeps([0,1]));',
        );
        for (const [name, contents] of files) await writeFile(path.join(root, 'assets', name), contents);
        const html =
            '<script type="module" src="/assets/entry-12345678.js"></script><link rel="stylesheet" href="/assets/base-12345678.css">';
        const costs = await initialResourceCosts(root, html);
        assert.equal(
            costs.startup.jsBytes,
            files.get('entry-12345678.js').length + files.get('vendor-12345678.js').length,
        );
        assert.equal(costs.startup.cssBytes, 6);
        assert.equal(costs.services.cssBytes, 13);
        assert.equal(costs.home.cssBytes, 6);
        assert.equal(costs.services.assets.includes('unselected-12345678.js'), false);
        await rm(path.join(root, 'assets', 'vendor-12345678.js'));
        await assert.rejects(() => initialResourceCosts(root, html), /Missing initial resource/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
