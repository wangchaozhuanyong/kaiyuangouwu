import yaml from 'js-yaml';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { architectureBudgetInput, classifyChanges } from './ci-impact.mjs';
import { assertPrHeadContainsBase } from './ci-pr-base.mjs';

const inventory = [
    { directory: 'storefront', name: '@vendure/storefront' },
    { directory: 'next-admin', name: 'next-admin' },
    { directory: 'core', name: '@vendure/core', scripts: { e2e: 'test' } },
    { directory: 'common', name: '@vendure/common' },
    { directory: 'dev-server', name: 'dev-server', dependencies: { '@vendure/core': '3' } },
    { directory: 'catalog-management-plugin', name: 'catalog', dependencies: { '@vendure/core': '3' } },
    { directory: 'store-management-plugin', name: 'store-management' },
    { directory: 'other-plugin', name: 'other', dependencies: { catalog: '1' } },
    { directory: 'icloud-relay-plugin', name: 'icloud', dependencies: { '@vendure/core': '3' } },
];
test('ordinary source does not trigger global architecture budgets; budgeted inputs still do', () => {
    for (const file of [
        'packages/store-management-plugin/src/administrator-access.service.ts',
        'packages/storefront/src/styles/cart-layout.css',
    ]) {
        assert.equal(architectureBudgetInput(file), false, file);
        assert.equal(classifyChanges([file], inventory).architecture, false, file);
    }
    for (const file of [
        'packages/storefront/src/styles.css',
        'packages/store-management-plugin/src/dashboard/AdminPanel.tsx',
        'scripts/architecture-debt-baseline.json',
    ]) {
        assert.equal(architectureBudgetInput(file), true, file);
        assert.equal(classifyChanges([file], inventory).architecture, true, file);
    }
    assert.equal(
        classifyChanges(['packages/storefront/src/styles/cart-layout.css'], inventory, { full: true })
            .architecture,
        true,
    );
});
test('PR CI rejects an old main base before planning expensive checks', () => {
    const base = 'a'.repeat(40);
    const calls = [];
    assert.equal(
        assertPrHeadContainsBase(base, 'HEAD', (binary, args) => calls.push([binary, args])),
        true,
    );
    assert.deepEqual(calls, [['git', ['merge-base', '--is-ancestor', base, 'HEAD']]]);
    assert.throws(
        () =>
            assertPrHeadContainsBase(base, 'HEAD', () => {
                throw new Error('not an ancestor');
            }),
        /refresh the branch before its first CI run/u,
    );
    assert.equal(
        assertPrHeadContainsBase('', 'HEAD', () => assert.fail('non-PR CI must skip')),
        false,
    );
    const workflow = yaml.load(
        readFileSync(new URL('../.github/workflows/build_and_test.yml', import.meta.url), 'utf8'),
    );
    const steps = workflow.jobs['detect-changes'].steps.map(step => step.name);
    assert.ok(
        steps.indexOf('Reject a PR candidate based on old main before expensive checks') <
            steps.indexOf('Explain the affected checks'),
    );
});
test('a storefront spacing change never launches backend, codegen or database checks', () => {
    const plan = classifyChanges(['packages/storefront/src/styles/cart-layout.css'], inventory);
    assert.deepEqual(plan.frontends, ['next-admin', 'storefront']);
    assert.deepEqual(plan.packages, []);
    for (const key of ['e2e', 'icloud', 'translation', 'codegen', 'dependencies', 'full', 'controls'])
        assert.equal(plan[key], false, key);
    assert.equal(plan.lane, 'frontend');
});
test('shared business services renderers rebuild both static apps without a backend release', () => {
    for (const file of [
        'packages/storefront-content-plugin/src/shared/business-services-hero.css',
        'packages/storefront-content-plugin/src/shared/business-services-hero.tsx',
    ]) {
        const plan = classifyChanges([file], inventory);
        assert.equal(plan.lane, 'frontend', file);
        assert.deepEqual(plan.frontends, ['next-admin', 'storefront']);
        assert.deepEqual(plan.packages, []);
        assert.deepEqual(plan.databases, []);
        assert.equal(plan.publishing, false);
    }
    assert.equal(
        classifyChanges(
            ['packages/storefront-content-plugin/src/storefront-content.service.ts'],
            [...inventory, { directory: 'storefront-content-plugin', name: 'storefront-content' }],
        ).lane,
        'runtime',
    );
});
test('static deployment entry repairs select controls and reuse frontend checks', () => {
    const controls = [
        'deploy/frontend-release.mjs',
        'deploy/frontend-ssm.mjs',
        'deploy/deploy-frontends-from-s3.sh',
    ];
    const controlPlan = classifyChanges(controls, inventory);
    assert.equal(controlPlan.lane, 'none');
    assert.equal(controlPlan.controls, true);
    assert.deepEqual(controlPlan.frontends, []);
    assert.deepEqual(controlPlan.packages, []);
    const cumulative = classifyChanges(
        [...controls, 'packages/storefront-content-plugin/src/shared/hero-scene.css'],
        inventory,
    );
    assert.equal(cumulative.lane, 'frontend');
    assert.deepEqual(cumulative.frontends, ['next-admin', 'storefront']);
    assert.deepEqual(cumulative.databases, []);
    assert.equal(classifyChanges([...controls, 'packages/core/src/api/auth.ts'], inventory).lane, 'runtime');
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
test('read-only mailbox diagnostics require controls without a website release', () => {
    const files = [
        '.github/workflows/production_operations.yml',
        'deploy/production-operations.cjs',
        'deploy/icloud-relay-diagnostic.mjs',
        'deploy/icloud-relay-receipt.cjs',
        'deploy/icloud-relay-diagnostic.spec.mjs',
        'packages/dev-server/scripts/production-operations.spec.mjs',
        'scripts/ci-impact.mjs',
        'scripts/ci-impact.spec.mjs',
    ];
    const plan = classifyChanges(files, inventory);
    assert.equal(plan.controls, true);
    assert.equal(plan.lane, 'none');
    assert.deepEqual(plan.packages, []);
    assert.deepEqual(plan.frontends, []);
    assert.deepEqual(plan.databases, []);
    assert.equal(
        classifyChanges([...files, 'packages/icloud-relay-plugin/src/mailbox.service.ts'], inventory).lane,
        'runtime',
    );
});
test('fixed read-only product inventory audit requires controls without a serving-process release', () => {
    const files = [
        'deploy/PRODUCTION_OPERATIONS.md',
        '.github/workflows/production_operations.yml',
        'deploy/product-stock-ownership-receipt.cjs',
        'packages/dev-server/scripts/product-ownership-preflight.mjs',
        'packages/dev-server/scripts/product-ownership-preflight.spec.mjs',
        'deploy/production-operations.cjs',
        'packages/dev-server/scripts/production-operations.spec.mjs',
        'scripts/ci-impact.mjs',
        'scripts/ci-impact.spec.mjs',
    ];
    const plan = classifyChanges(files, inventory);
    assert.equal(plan.controls, true);
    assert.equal(plan.lane, 'none');
    assert.equal(plan.full, false);
    assert.deepEqual(plan.frontends, []);
    assert.deepEqual(plan.packages, []);
    assert.deepEqual(plan.databases, []);
    for (const runtimeFile of [
        'packages/dev-server/scripts/moyao-default-store-migration.mjs',
        'packages/store-management-plugin/src/digital-product.service.ts',
    ]) {
        assert.equal(classifyChanges([...files, runtimeFile], inventory).lane, 'runtime', runtimeFile);
    }
});
test('storefront runtime source updates Admin preview, while client tests and isolated tool do not', () => {
    assert.deepEqual(
        classifyChanges(['packages/storefront/src/styles/home-showcase.css'], inventory).frontends,
        ['next-admin', 'storefront'],
    );
    assert.deepEqual(classifyChanges(['packages/storefront/src/home-page.spec.tsx'], inventory).frontends, [
        'storefront',
    ]);
    assert.deepEqual(classifyChanges(['packages/storefront/two-factor-tool/main.tsx'], inventory).frontends, [
        'storefront',
    ]);
});
test('2FA changes stay in the static lane and rebuild Admin only when imported by its preview', () => {
    for (const file of [
        'packages/storefront/src/client-plugins/two-factor/two-factor-page.css',
        'packages/storefront/src/client-plugins/two-factor/two-factor-page.tsx',
        'packages/storefront/two-factor-tool/main.tsx',
        'packages/storefront/two-factor-tool/styles.css',
    ]) {
        const plan = classifyChanges([file], inventory);
        assert.equal(plan.lane, 'frontend', file);
        assert.deepEqual(
            plan.frontends,
            file.startsWith('packages/storefront/src/') ? ['next-admin', 'storefront'] : ['storefront'],
        );
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
    assert.deepEqual(frontend.frontends, ['next-admin', 'storefront']);
    for (const file of [
        'deploy/nginx/damatong.conf',
        'deploy/deploy-production-from-s3.sh',
        'packages/core/src/order.ts',
    ])
        assert.equal(classifyChanges([...files, file], inventory).lane, 'runtime', file);
});

test('shared hero CSS rebuilds the client and Admin preview while shared server inputs retain runtime scope', () => {
    const css = 'packages/storefront-content-plugin/src/shared/hero-scene.css';
    const plan = classifyChanges([css], inventory);
    assert.equal(plan.lane, 'frontend');
    assert.deepEqual(plan.frontends, ['next-admin', 'storefront']);
    assert.deepEqual(plan.packages, []);
    assert.deepEqual(plan.databases, []);
    assert.equal(plan.publishing, false);
    for (const runtime of [
        'packages/core/src/service.ts',
        'packages/storefront-content-plugin/src/shared/hero-theme.ts',
    ])
        assert.equal(
            classifyChanges(
                [css, runtime],
                [
                    ...inventory,
                    { directory: 'storefront-content-plugin', name: '@vendure/storefront-content-plugin' },
                ],
            ).lane,
            'runtime',
        );
});

test('artifact input hashing is a release control rather than serving process code', () => {
    const plan = classifyChanges(
        ['deploy/artifact-inputs.mjs', 'packages/storefront/src/index.css'],
        inventory,
    );
    assert.equal(plan.lane, 'frontend');
    assert.equal(plan.controls, true);
    assert.deepEqual(plan.packages, []);
});

test('public page contracts rebuild both frontends and keep the backend release lane', () => {
    for (const name of ['public-page-data.ts', 'public-seo.ts']) {
        const plan = classifyChanges(
            [`packages/storefront-content-plugin/src/shared/${name}`],
            [
                ...inventory,
                { directory: 'storefront-content-plugin', name: '@vendure/storefront-content-plugin' },
            ],
        );
        assert.deepEqual(plan.frontends, ['next-admin', 'storefront'], name);
        assert.equal(plan.lane, 'runtime', name);
    }
});

// Shared content renderers are compiled only by the two browser apps.
test('shared browser text renderers select both static apps without server checks', () => {
    for (const file of [
        'packages/storefront-content-plugin/src/shared/content-text.tsx',
        'packages/storefront-content-plugin/src/shared/content-text.css',
        'packages/storefront-content-plugin/src/shared/hero-scene.tsx',
        'packages/storefront-content-plugin/src/shared/auth-visual.tsx',
    ]) {
        const plan = classifyChanges([file], inventory);
        assert.equal(plan.lane, 'frontend', file);
        assert.deepEqual(plan.frontends, ['next-admin', 'storefront'], file);
        assert.deepEqual(plan.packages, [], file);
        assert.equal(plan.publishing, false, file);
    }
});
