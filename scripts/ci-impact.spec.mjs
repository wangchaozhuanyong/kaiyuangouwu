import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyChanges } from './ci-impact.mjs';

const inventory = [
    { directory: 'storefront', name: '@vendure/storefront' },
    { directory: 'next-admin', name: 'next-admin' },
    { directory: 'core', name: '@vendure/core', scripts: { e2e: 'test' } },
    { directory: 'common', name: '@vendure/common' },
    { directory: 'catalog-management-plugin', name: 'catalog', dependencies: { '@vendure/core': '3' } },
    { directory: 'other-plugin', name: 'other', dependencies: { catalog: '1' } },
    { directory: 'icloud-relay-plugin', name: 'icloud', dependencies: { '@vendure/core': '3' } },
];
test('a storefront spacing change never launches backend, codegen or database checks', () => {
    const plan = classifyChanges(['packages/storefront/src/styles/cart-layout.css'], inventory);
    assert.deepEqual(plan.frontends, ['storefront']);
    assert.deepEqual(plan.packages, []);
    for (const key of ['e2e', 'icloud', 'translation', 'codegen', 'dependencies', 'full', 'controls'])
        assert.equal(plan[key], false, key);
    assert.equal(plan.lane, 'frontend');
});
test('admin UI stays in its own scope, while mixed app changes include both apps', () => {
    assert.deepEqual(
        classifyChanges(['packages/next-admin/src/pages/Catalog/Button.tsx'], inventory).frontends,
        ['next-admin'],
    );
    assert.deepEqual(
        classifyChanges(['packages/next-admin/src/index.css', 'packages/storefront/src/index.css'], inventory)
            .frontends,
        ['next-admin', 'storefront'],
    );
});
test('plugin changes include their dependents but not unrelated plugin integrations', () => {
    const plan = classifyChanges(['packages/catalog-management-plugin/src/service.ts'], inventory);
    assert.deepEqual(plan.packages, ['catalog-management-plugin', 'other-plugin']);
    assert.equal(plan.icloud, false);
    assert.equal(plan.lane, 'runtime');
});
test('a cumulative diff containing a migration cannot enter the frontend lane', () => {
    const plan = classifyChanges(
        ['packages/storefront/src/index.css', 'packages/dev-server/migrations/123-change.ts'],
        inventory,
    );
    assert.equal(plan.lane, 'runtime');
    assert.equal(plan.migration, true);
    assert.equal(plan.e2e, true);
});
test('auth/payment core, lockfiles and unknown inputs retain broader checks', () => {
    for (const file of [
        'packages/core/src/service/services/payment.service.ts',
        'bun.lock',
        'new-build-input.js',
    ]) {
        const plan = classifyChanges([file], inventory);
        assert.equal(plan.full, true, file);
        assert.equal(plan.lane, 'runtime', file);
    }
});
test('documentation and deleted/renamed executable inputs are not confused', () => {
    assert.equal(classifyChanges(['README.md', 'docs/help.mdx'], inventory).lane, 'none');
    assert.equal(classifyChanges(['packages/core/src/old.ts', 'docs/old.md'], inventory).lane, 'runtime');
    assert.equal(classifyChanges(['packages/storefront/vite.config.ts'], inventory).lane, 'runtime');
    assert.equal(classifyChanges(['packages/storefront/src/api/account.ts'], inventory).lane, 'frontend');
});
test('full scope must be explicitly requested', () => {
    const files = ['packages/storefront/src/index.css'];
    assert.equal(classifyChanges(files, inventory).full, false);
    assert.equal(classifyChanges(files, inventory, { full: true }).full, true);
});

test('dependent packages with e2e tests are included even when the edited package has no e2e script', () => {
    const graph = inventory.map(pkg =>
        pkg.directory === 'other-plugin' ? { ...pkg, scripts: { e2e: 'test' } } : pkg,
    );
    const plan = classifyChanges(['packages/catalog-management-plugin/src/service.ts'], graph);
    assert.equal(plan.full, false);
    assert.equal(plan.e2e, true);
});
