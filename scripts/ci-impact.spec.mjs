import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyChanges } from './ci-impact.mjs';

const inventory = [
    { directory: 'storefront', name: '@vendure/storefront' },
    { directory: 'next-admin', name: 'next-admin' },
    { directory: 'core', name: '@vendure/core', scripts: { e2e: 'test' } },
    { directory: 'common', name: '@vendure/common' },
    { directory: 'dev-server', name: 'dev-server', dependencies: { '@vendure/core': '3' } },
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
test('2FA styles and components select only the static frontend lane', () => {
    for (const file of [
        'packages/storefront/src/client-plugins/two-factor/two-factor-page.css',
        'packages/storefront/src/client-plugins/two-factor/two-factor-page.tsx',
        'packages/storefront/two-factor-tool/main.tsx',
        'packages/storefront/two-factor-tool/styles.css',
    ]) {
        const plan = classifyChanges([file], inventory);
        assert.equal(plan.lane, 'frontend', file);
        assert.deepEqual(plan.frontends, ['storefront']);
        assert.deepEqual(plan.packages, []);
        assert.deepEqual(plan.databases, []);
        assert.equal(plan.full, false);
    }
    for (const file of [
        'packages/storefront/vite.two-factor.config.ts',
        'packages/core/src/api/auth.ts',
        'packages/dev-server/migrations/change.ts',
    ])
        assert.equal(
            classifyChanges(['packages/storefront/two-factor-tool/styles.css', file], inventory).lane,
            'runtime',
            file,
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
test('core and lockfile changes use their dependency scope without enabling full CI', () => {
    const core = classifyChanges(['packages/core/src/service/services/payment.service.ts'], inventory);
    assert.equal(core.full, false);
    assert.equal(core.lane, 'runtime');
    assert.ok(core.packages.includes('catalog-management-plugin'));
    assert.deepEqual(core.frontends, []);
    assert.deepEqual(core.databases, ['mysql']);
    const lock = classifyChanges(['bun.lock'], inventory);
    assert.equal(lock.full, false);
    assert.equal(lock.dependencies, true);
    assert.deepEqual(lock.frontends, ['next-admin', 'storefront']);
    assert.throws(() => classifyChanges(['new-build-input.js'], inventory), /scope is unmapped/u);
});
test('CI routing and backup scripts stay in control checks with no backend or database jobs', () => {
    for (const file of [
        '.github/workflows/build_and_test.yml',
        'scripts/ci-impact.mjs',
        'scripts/release-evidence.mjs',
        'deploy/systemd/vendure-mysql-backup-manifest.py',
        'packages/dev-server/scripts/production-operations.mjs',
    ]) {
        const plan = classifyChanges([file], inventory);
        assert.equal(plan.full, false, file);
        assert.equal(plan.controls, true, file);
        assert.deepEqual(plan.packages, [], file);
        assert.deepEqual(plan.frontends, [], file);
        assert.deepEqual(plan.databases, [], file);
        assert.equal(plan.codegen, false, file);
    }
});
test('the four-database matrix requires full; a driver change adds only its own database', () => {
    const file = 'packages/core/src/connection/postgres-driver.ts';
    assert.deepEqual(classifyChanges([file], inventory).databases, ['mysql', 'postgres']);
    assert.deepEqual(classifyChanges([file], inventory, { full: true }).databases, [
        'mysql',
        'sqljs',
        'postgres',
        'mariadb',
    ]);
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

test('shared frontend inputs require whole affected app tests without enabling repository full', () => {
    const plan = classifyChanges(['bun.lock', 'packages/storefront/src/index.css'], inventory);
    assert.equal(plan.full, false);
    assert.equal(plan.frontendFull, true);
    assert.equal(classifyChanges(['packages/storefront/vite.config.ts'], inventory).frontendFull, true);
    assert.equal(classifyChanges(['packages/storefront/src/index.css'], inventory).frontendFull, false);
});

test('CI-only changes are checked without deploying, and cannot accumulate into a later frontend rebuild', () => {
    const files = [
        'scripts/ci-check-inputs.mjs',
        '.github/workflows/production_release.yml',
        'packages/dev-server/scripts/production-release-smoke.spec.mjs',
    ];
    const controls = classifyChanges(files, inventory);
    assert.equal(controls.lane, 'none');
    assert.equal(controls.controls, true);
    assert.deepEqual(controls.packages, []);
    const frontend = classifyChanges([...files, 'packages/storefront/src/page.css'], inventory);
    assert.equal(frontend.lane, 'frontend');
    assert.deepEqual(frontend.frontends, ['storefront']);
    for (const file of [
        'deploy/nginx/damatong.conf',
        'deploy/deploy-production-from-s3.sh',
        'packages/core/src/order.ts',
    ])
        assert.equal(classifyChanges([...files, file], inventory).lane, 'runtime', file);
});
