import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    access,
    chmod,
    cp,
    lstat,
    mkdir,
    mkdtemp,
    readFile,
    readlink,
    rename,
    rm,
    stat,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { damatongAssets } from './damatong-storefront-config.mjs';
import {
    assertSafeOutputPath,
    copyStorefrontMediaReleaseInputs,
    ensureRuntimeRootPermissions,
    HOMEPAGE_CAROUSEL_RUNTIME_FILES,
    pruneDeniedRuntimePackages,
    REFERRAL_POSTER_RUNTIME_FILES,
    repositoryRoot,
    REQUIRED_RUNTIME_FILES,
    RUNTIME_PACKAGE_ASSETS,
    runtimeArtifactsRoot,
    writeRuntimeFrontendReleaseManifests,
} from './production-runtime-artifact.mjs';
import {
    auditRuntimePackages,
    BRACES_PATCH,
    HTTP_CACHE_PATCH,
    writeBunAuditEvidence,
} from './production-runtime-audit.mjs';
import {
    assertRuntimeSymlinksResolve,
    assertVendureWorkspaceSymlinksResolve,
    collectArtifactEntries,
    collectPackageInventory,
    DENIED_RUNTIME_PACKAGES,
    findDeniedPackages,
    GOVERNANCE_RECONCILIATION_RUNTIME_FILES,
    verifyRuntimeArtifact,
    writeIntegrityFiles,
} from './production-runtime-verify.mjs';
import { moyaoBrandAssets } from './sync-moyao-brand.mjs';
import { storefrontMediaManifest } from './sync-storefront-media.mjs';

void test('runtime artifact includes catalog management plugin build output', () => {
    assert.deepEqual(RUNTIME_PACKAGE_ASSETS['catalog-management-plugin'], ['dist']);
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/catalog-management-plugin/dist/index.js'));
});

void test('runtime artifact includes the telemetry plugin required by dev-server', () => {
    assert.deepEqual(RUNTIME_PACKAGE_ASSETS['telemetry-plugin'], ['dist']);
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/telemetry-plugin/dist/index.js'));
});

void test('runtime artifact includes icloud relay plugin build output', () => {
    assert.deepEqual(RUNTIME_PACKAGE_ASSETS['icloud-relay-plugin'], ['dist']);
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/icloud-relay-plugin/dist/index.js'));
});

void test('runtime artifact serves the standalone next-admin application', () => {
    assert.deepEqual(RUNTIME_PACKAGE_ASSETS['next-admin'], ['dist']);
    assert.deepEqual(RUNTIME_PACKAGE_ASSETS['next-admin-plugin'], ['dist']);
    assert.equal(RUNTIME_PACKAGE_ASSETS.dashboard, undefined);
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/next-admin-plugin/dist/index.js'));
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/next-admin/dist/index.html'));
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/next-admin/dist/frontend-release.json'));
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/storefront/dist/frontend-release.json'));
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/storefront/dist/.server/public-page-renderer.cjs'));
    assert.ok(!REQUIRED_RUNTIME_FILES.includes('packages/dev-server/dist/dashboard/index.html'));
});

void test('full runtime writes public revisions for both applications and isolated 2FA', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-frontend-revisions-'));
    const gitSha = 'a'.repeat(40);
    try {
        for (const component of ['storefront', 'next-admin']) {
            await mkdir(path.join(fixtureRoot, 'packages', component, 'dist'), { recursive: true });
        }
        await mkdir(path.join(fixtureRoot, 'packages/storefront/dist-two-factor'), { recursive: true });
        await writeRuntimeFrontendReleaseManifests(fixtureRoot, gitSha);
        for (const component of ['storefront', 'next-admin']) {
            const manifest = JSON.parse(
                await readFile(
                    path.join(fixtureRoot, 'packages', component, 'dist', 'frontend-release.json'),
                    'utf8',
                ),
            );
            assert.deepEqual(manifest, {
                sourceSha: gitSha,
                backendSha: gitSha,
                component,
                releaseLane: 'runtime',
            });
        }
        const toolManifest = JSON.parse(
            await readFile(
                path.join(fixtureRoot, 'packages/storefront/dist-two-factor/frontend-release.json'),
                'utf8',
            ),
        );
        assert.deepEqual(toolManifest, {
            sourceSha: gitSha,
            backendSha: gitSha,
            component: 'two-factor',
            releaseLane: 'runtime',
        });
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('runtime verification rejects missing Vendure workspace packages', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-workspace-link-'));
    try {
        const vendureModules = path.join(fixtureRoot, 'node_modules', '@vendure');
        await mkdir(vendureModules, { recursive: true });
        await symlink(
            '../../packages/content-translation-plugin',
            path.join(vendureModules, 'content-translation-plugin'),
        );
        const entries = await collectArtifactEntries(fixtureRoot);

        await assert.rejects(
            () => assertVendureWorkspaceSymlinksResolve(fixtureRoot, entries),
            /workspace package symlink is broken/u,
        );

        await mkdir(path.join(fixtureRoot, 'packages', 'content-translation-plugin'), {
            recursive: true,
        });
        await assertVendureWorkspaceSymlinksResolve(fixtureRoot, entries);
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('runtime artifact root is readable and traversable by the web server', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-permissions-'));
    try {
        await ensureRuntimeRootPermissions(fixtureRoot);
        assert.equal((await stat(fixtureRoot)).mode % 0o1000, 0o755);
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('runtime artifact includes release publishers and every media manifest image', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-storefront-media-'));
    try {
        await copyStorefrontMediaReleaseInputs(fixtureRoot);
        for (const file of GOVERNANCE_RECONCILIATION_RUNTIME_FILES) {
            assert.ok(REQUIRED_RUNTIME_FILES.includes(file));
            assert.deepEqual(
                await readFile(path.join(fixtureRoot, file)),
                await readFile(path.join(repositoryRoot, file)),
            );
        }
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/catalog-cigarette-media.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/sync-storefront-media.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/sync-auth-visuals.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/sync-moyao-brand.mjs'));
        for (const file of HOMEPAGE_CAROUSEL_RUNTIME_FILES) {
            assert.ok(REQUIRED_RUNTIME_FILES.includes(file));
            assert.equal(
                await readFile(path.join(fixtureRoot, file), 'utf8'),
                await readFile(path.join(repositoryRoot, file), 'utf8'),
            );
        }
        for (const file of REFERRAL_POSTER_RUNTIME_FILES) {
            assert.ok(REQUIRED_RUNTIME_FILES.includes(file));
            assert.deepEqual(
                await readFile(path.join(fixtureRoot, file)),
                await readFile(path.join(repositoryRoot, file)),
            );
        }
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/damatong-storefront-config.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/sync-damatong-storefront.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/repair-inventory-inheritance.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/repair-coupon-lifecycle.mjs'));
        for (const entry of storefrontMediaManifest) {
            const relativePath = path.relative(repositoryRoot, entry.file);
            const copied = await readFile(path.join(fixtureRoot, relativePath));
            assert.ok(copied.byteLength > 0, `Missing copied media: ${entry.key}`);
        }
        for (const entry of moyaoBrandAssets) {
            const relativePath = path.relative(repositoryRoot, entry.file);
            const copied = await readFile(path.join(fixtureRoot, relativePath));
            assert.ok(copied.byteLength > 0, `Missing copied brand asset: ${entry.key}`);
        }
        for (const entry of damatongAssets) {
            const relativePath = path.relative(repositoryRoot, entry.file);
            const copied = await readFile(path.join(fixtureRoot, relativePath));
            assert.ok(copied.byteLength > 0, `Missing copied Damatong asset: ${entry.key}`);
        }
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('production artifact workflow reuses one validated high-severity audit response', async () => {
    const workflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/build_production_runtime.yml'),
        'utf8',
    );

    assert.equal([...workflow.matchAll(/production-runtime-audit\.mjs/gu)].length, 1);
    assert.doesNotMatch(workflow, /bun audit --json/u);
    assert.match(workflow, /--audit-level high/u);
    assert.match(workflow, /--evidence-output "\$BUN_AUDIT_REPORT"/u);
    assert.match(workflow, /--lockfile bun\.lock/u);
    assert.match(workflow, /--audit-report "\$BUN_AUDIT_REPORT"/u);
});

void test('production artifact reuses exact successful CI evidence instead of rerunning the suite', async () => {
    const workflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/build_production_runtime.yml'),
        'utf8',
    );
    const repositoryWorkflow = await readFile(
        path.join(repositoryRoot, '.github/workflows/build_and_test.yml'),
        'utf8',
    );

    assert.match(workflow, /actions: read/u);
    assert.match(
        workflow,
        /node scripts\/release-evidence\.mjs verify "\$BASE_SHA" "\$TARGET_SHA" "\$CI_RUN_ID"/u,
    );
    assert.match(workflow, /node deploy\/build-artifact\.mjs restore/u);
    assert.match(workflow, /if: steps\.compiled\.outputs\.restored != 'true'/u);
    assert.doesNotMatch(workflow, /git rev-list --parents|RELEASE_BASE_SHA.*REVIEWED_HEAD_SHA/u);
    assert.doesNotMatch(workflow, /bun run --cwd packages\/dev-server test:dev-workflow/u);
    assert.doesNotMatch(workflow, /^\s+bun run test$/mu);
    assert.ok(
        workflow.indexOf('Build production bundles') < workflow.indexOf('Validate prompt Skill release'),
        'Prompt Skill validation must reuse the production build outputs',
    );
    assert.match(
        repositoryWorkflow,
        /Operations dashboard regression tests[\s\S]+operations-dashboard-plugin test/u,
    );
});

void test('runtime artifact output is restricted to a new child of the artifact directory', async () => {
    await assert.rejects(() => assertSafeOutputPath(repositoryRoot), /Output must be a child/u);
    await assert.rejects(() => assertSafeOutputPath(runtimeArtifactsRoot), /Output must be a child/u);

    const existingDirectory = path.join(runtimeArtifactsRoot, 'existing-test-output');
    await mkdir(existingDirectory, { recursive: true });
    try {
        await assert.rejects(() => assertSafeOutputPath(existingDirectory), /will not be overwritten/u);
    } finally {
        await rm(existingDirectory, { recursive: true, force: true });
    }
});

void test('runtime artifact pruning removes build-only and denied packages', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-prune-'));
    try {
        for (const [name, version] of [
            ['vite', '7.3.6'],
            ['less', '4.2.2'],
            ['allowed-package', '1.0.0'],
        ]) {
            const packageRoot = path.join(fixtureRoot, 'node_modules', name);
            await mkdir(packageRoot, { recursive: true });
            await writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({ name, version })}\n`);
        }

        const removed = await pruneDeniedRuntimePackages(fixtureRoot);

        assert.deepEqual(removed.map(runtimePackage => runtimePackage.name).sort(), ['less', 'vite']);
        await assert.rejects(() => access(path.join(fixtureRoot, 'node_modules', 'less')));
        await assert.rejects(() => access(path.join(fixtureRoot, 'node_modules', 'vite')));
        await access(path.join(fixtureRoot, 'node_modules', 'allowed-package'));
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('runtime pruning removes only declared denied-package command links at each install level', async () => {
    let root = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-prune-bins-'));
    try {
        for (const modules of ['node_modules', 'node_modules/owner/node_modules']) {
            await mkdir(path.join(root, modules, '.bin'), { recursive: true });
            await mkdir(path.join(root, modules, 'typescript/bin'), { recursive: true });
            await writeFile(
                path.join(root, modules, 'typescript/package.json'),
                JSON.stringify({
                    name: 'typescript',
                    version: '5.9.3',
                    bin: { tsc: './bin/tsc', tsserver: './bin/tsserver' },
                }),
            );
            for (const command of ['tsc', 'tsserver']) {
                await writeFile(path.join(root, modules, 'typescript/bin', command), 'process.exit(0);\n');
                await symlink(`../typescript/bin/${command}`, path.join(root, modules, '.bin', command));
            }
        }
        await mkdir(path.join(root, 'node_modules/less/bin'), { recursive: true });
        await writeFile(
            path.join(root, 'node_modules/less/package.json'),
            JSON.stringify({ name: 'less', version: '4.2.2', bin: './bin/less.js' }),
        );
        await writeFile(path.join(root, 'node_modules/less/bin/less.js'), 'process.exit(0);\n');
        await symlink('../less/bin/less.js', path.join(root, 'node_modules/.bin/less'));
        await mkdir(path.join(root, 'node_modules/runtime-cli/bin'), { recursive: true });
        await writeFile(
            path.join(root, 'node_modules/runtime-cli/package.json'),
            JSON.stringify({ name: 'runtime-cli', version: '1.0.0', bin: { 'runtime-cli': 'bin/run.js' } }),
        );
        await writeFile(
            path.join(root, 'node_modules/runtime-cli/bin/run.js'),
            '#!/usr/bin/env node\nprocess.stdout.write("RUNTIME_OK");\n',
        );
        await chmod(path.join(root, 'node_modules/runtime-cli/bin/run.js'), 0o755);
        await symlink('../runtime-cli/bin/run.js', path.join(root, 'node_modules/.bin/runtime-cli'));

        const removed = await pruneDeniedRuntimePackages(root);
        assert.equal(removed.length, 3);
        for (const modules of ['node_modules', 'node_modules/owner/node_modules']) {
            for (const command of ['tsc', 'tsserver']) {
                await assert.rejects(lstat(path.join(root, modules, '.bin', command)), { code: 'ENOENT' });
            }
            await assert.rejects(access(path.join(root, modules, 'typescript')), { code: 'ENOENT' });
        }
        await assert.rejects(lstat(path.join(root, 'node_modules/.bin/less')), { code: 'ENOENT' });
        assert.equal(
            await readlink(path.join(root, 'node_modules/.bin/runtime-cli')),
            '../runtime-cli/bin/run.js',
        );
        await writeIntegrityFiles(root);
        const inventory = JSON.parse(await readFile(path.join(root, 'RUNTIME-SYMLINKS.json'), 'utf8'));
        assert.deepEqual(inventory, [
            { path: 'node_modules/.bin/runtime-cli', target: '../runtime-cli/bin/run.js' },
        ]);
        const installedRoot = `${root}-installed`;
        await rename(root, installedRoot);
        root = installedRoot;
        await assertRuntimeSymlinksResolve(root);
        const executable = spawnSync(path.join(root, 'node_modules/.bin/runtime-cli'), [], {
            encoding: 'utf8',
        });
        assert.equal(executable.status, 0, executable.stderr);
        assert.equal(executable.stdout, 'RUNTIME_OK');
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

void test('runtime pruning preserves a same-name command owned by an allowed package', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-prune-conflict-'));
    try {
        await mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
        await mkdir(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
        await mkdir(path.join(root, 'node_modules/allowed/bin'), { recursive: true });
        await writeFile(
            path.join(root, 'node_modules/typescript/package.json'),
            JSON.stringify({
                name: 'typescript',
                version: '5.9.3',
                bin: { tsc: 'bin/tsc' },
            }),
        );
        await writeFile(path.join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(0);\n');
        await writeFile(path.join(root, 'node_modules/allowed/bin/tsc'), 'process.exit(0);\n');
        await symlink('../allowed/bin/tsc', path.join(root, 'node_modules/.bin/tsc'));
        await pruneDeniedRuntimePackages(root);
        assert.equal(await readlink(path.join(root, 'node_modules/.bin/tsc')), '../allowed/bin/tsc');
        await writeIntegrityFiles(root);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

void test('runtime pruning leaves unrelated aliases visible for strict closure rejection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-prune-alias-'));
    try {
        await mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
        await mkdir(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
        await writeFile(
            path.join(root, 'node_modules/typescript/package.json'),
            JSON.stringify({
                name: 'typescript',
                version: '5.9.3',
                bin: { tsc: 'bin/tsc' },
            }),
        );
        await writeFile(path.join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(0);\n');
        await symlink('../typescript/bin/tsc', path.join(root, 'node_modules/.bin/tsc'));
        await symlink('../typescript/bin/tsc', path.join(root, 'node_modules/.bin/undeclared-alias'));
        await symlink('node_modules/typescript', path.join(root, 'non-bin-alias'));
        await pruneDeniedRuntimePackages(root);
        assert.equal(
            await readlink(path.join(root, 'node_modules/.bin/undeclared-alias')),
            '../typescript/bin/tsc',
        );
        assert.equal(await readlink(path.join(root, 'non-bin-alias')), 'node_modules/typescript');
        await assert.rejects(writeIntegrityFiles(root), /Runtime symlink is broken or cyclic/u);
        await assert.rejects(access(path.join(root, 'SHA256SUMS')), { code: 'ENOENT' });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

void test('runtime pruning fails before mutation for invalid bins and command targets', async t => {
    const cases = [
        ['bin-name-escape', { '../tsc': 'bin/tsc' }, '../typescript/bin/tsc'],
        ['absolute-bin', { tsc: '/outside/tsc' }, '../typescript/bin/tsc'],
        ['bin-path-escape', { tsc: '../../outside' }, '../typescript/bin/tsc'],
        ['invalid-bin-value', { tsc: 1 }, '../typescript/bin/tsc'],
        ['invalid-bin-map', [], '../typescript/bin/tsc'],
        ['null-bin-map', null, '../typescript/bin/tsc'],
        ['missing-bin-file', { tsc: 'bin/missing' }, '../typescript/bin/tsc'],
        ['directory-bin-target', { tsc: 'bin' }, '../typescript/bin/tsc'],
        ['wrong-package-file', { tsc: 'bin/tsc' }, '../typescript/bin/other'],
        ['command-path-escape', { tsc: 'bin/tsc' }, '../../../outside'],
    ];
    for (const [label, bin, link] of cases) {
        await t.test(label, async () => {
            const root = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-invalid-bin-'));
            try {
                await mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
                await mkdir(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
                await writeFile(
                    path.join(root, 'node_modules/typescript/package.json'),
                    JSON.stringify({
                        name: 'typescript',
                        version: '5.9.3',
                        bin,
                    }),
                );
                for (const name of ['tsc', 'other']) {
                    await writeFile(
                        path.join(root, 'node_modules/typescript/bin', name),
                        'process.exit(0);\n',
                    );
                }
                await symlink(link, path.join(root, 'node_modules/.bin/tsc'));
                await assert.rejects(pruneDeniedRuntimePackages(root));
                await access(path.join(root, 'node_modules/typescript/package.json'));
                assert.equal(await readlink(path.join(root, 'node_modules/.bin/tsc')), link);
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        });
    }
});

void test('runtime pruning validates all commands before removing an earlier valid alias', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-prune-before-mutation-'));
    try {
        await mkdir(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
        await mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
        await writeFile(
            path.join(root, 'node_modules/typescript/package.json'),
            JSON.stringify({
                name: 'typescript',
                version: '5.9.3',
                bin: { tsc: 'bin/tsc', tsserver: '../outside' },
            }),
        );
        await writeFile(path.join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(0);\n');
        await symlink('../typescript/bin/tsc', path.join(root, 'node_modules/.bin/tsc'));
        await assert.rejects(pruneDeniedRuntimePackages(root), /bin escapes its package/u);
        assert.equal(await readlink(path.join(root, 'node_modules/.bin/tsc')), '../typescript/bin/tsc');
        await access(path.join(root, 'node_modules/typescript/package.json'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

void test('runtime pruning rejects redirected bins without touching outside resources', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-redirected-bin-'));
    const root = path.join(fixture, 'runtime');
    const outside = path.join(fixture, 'outside');
    try {
        await mkdir(path.join(root, 'node_modules/.bin'), { recursive: true });
        await mkdir(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
        await mkdir(outside);
        await writeFile(path.join(outside, 'tsc'), 'OUTSIDE_MUST_SURVIVE\n');
        await writeFile(
            path.join(root, 'node_modules/typescript/package.json'),
            JSON.stringify({
                name: 'typescript',
                version: '5.9.3',
                bin: { tsc: 'bin/tsc' },
            }),
        );
        await symlink('../../../../outside/tsc', path.join(root, 'node_modules/typescript/bin/tsc'));
        await symlink('../typescript/bin/tsc', path.join(root, 'node_modules/.bin/tsc'));
        await assert.rejects(pruneDeniedRuntimePackages(root), /bin has an invalid target/u);
        assert.equal(await readFile(path.join(outside, 'tsc'), 'utf8'), 'OUTSIDE_MUST_SURVIVE\n');
        await access(path.join(root, 'node_modules/typescript/package.json'));
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

void test('runtime pruning rejects a redirected command directory before unlinking outside aliases', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-redirected-bin-directory-'));
    const root = path.join(fixture, 'runtime');
    const outside = path.join(fixture, 'outside');
    try {
        await mkdir(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
        await mkdir(path.join(outside, 'bin'), { recursive: true });
        await writeFile(
            path.join(root, 'node_modules/typescript/package.json'),
            JSON.stringify({
                name: 'typescript',
                version: '5.9.3',
                bin: { tsc: 'bin/tsc' },
            }),
        );
        await writeFile(path.join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(0);\n');
        await writeFile(path.join(outside, 'sentinel'), 'OUTSIDE_MUST_SURVIVE\n');
        await symlink('../runtime/node_modules/typescript', path.join(outside, 'typescript'));
        await symlink('../typescript/bin/tsc', path.join(outside, 'bin/tsc'));
        await symlink('../../outside/bin', path.join(root, 'node_modules/.bin'));
        await assert.rejects(pruneDeniedRuntimePackages(root), /command directory is not a real directory/u);
        assert.equal(await readlink(path.join(outside, 'bin/tsc')), '../typescript/bin/tsc');
        assert.equal(await readFile(path.join(outside, 'sentinel'), 'utf8'), 'OUTSIDE_MUST_SURVIVE\n');
        await access(path.join(root, 'node_modules/typescript/package.json'));
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

void test('runtime symlink closure preserves workspace links and rejects broken, cyclic or escaping links', async t => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-link-closure-'));
    const root = path.join(fixture, 'runtime');
    try {
        await mkdir(path.join(root, 'node_modules/@vendure'), { recursive: true });
        await mkdir(path.join(root, 'packages/common/lib'), { recursive: true });
        await writeFile(path.join(root, 'packages/common/lib/index.js'), 'module.exports = {};\n');
        await symlink('../../packages/common', path.join(root, 'node_modules/@vendure/common'));
        await symlink('node_modules/@vendure/common/lib/index.js', path.join(root, 'workspace-entry'));
        await assertRuntimeSymlinksResolve(root);
        await writeIntegrityFiles(root);
        assert.equal(JSON.parse(await readFile(path.join(root, 'RUNTIME-SYMLINKS.json'), 'utf8')).length, 2);
        await writeFile(path.join(fixture, 'outside'), 'OUTSIDE_MUST_SURVIVE\n');
        for (const [label, target] of [
            ['broken', 'missing'],
            ['cyclic', 'invalid-link'],
            ['escaping', '../outside'],
            ['absolute-inside', path.join(root, 'packages/common/lib/index.js')],
            ['absolute-outside', path.join(fixture, 'outside')],
        ]) {
            await t.test(label, async () => {
                await symlink(target, path.join(root, 'invalid-link'));
                try {
                    await assert.rejects(assertRuntimeSymlinksResolve(root), /Runtime symlink/u);
                    await assert.rejects(writeIntegrityFiles(root), /Runtime symlink/u);
                } finally {
                    await rm(path.join(root, 'invalid-link'));
                }
            });
        }
        await mkdir(path.join(fixture, 'outside-directory'));
        await writeFile(path.join(fixture, 'outside-directory/file.js'), 'OUTSIDE_MUST_SURVIVE\n');
        await symlink('../outside-directory', path.join(root, 'redirect'));
        await symlink('redirect/file.js', path.join(root, 'indirect'));
        await assert.rejects(
            assertRuntimeSymlinksResolve(root, [
                { path: 'indirect', target: 'redirect/file.js', type: 'symlink' },
            ]),
            /redirects outside/u,
        );
        assert.equal(await readFile(path.join(fixture, 'outside'), 'utf8'), 'OUTSIDE_MUST_SURVIVE\n');
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

void test('runtime package scan finds denied transitive packages without following symlinks', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-scan-'));
    try {
        const packageRoot = path.join(fixtureRoot, 'node_modules', 'tar');
        await mkdir(packageRoot, { recursive: true });
        await writeFile(path.join(packageRoot, 'package.json'), '{"name":"tar","version":"7.5.2"}\n');
        await symlink(packageRoot, path.join(fixtureRoot, 'linked-tar'));

        const entries = await collectArtifactEntries(fixtureRoot);
        const packages = await collectPackageInventory(fixtureRoot, entries);

        assert.deepEqual(findDeniedPackages(packages), [
            { name: 'tar', path: 'node_modules/tar', version: '7.5.2' },
        ]);
        assert.deepEqual(
            entries.filter(entry => entry.type === 'symlink'),
            [{ path: 'linked-tar', target: packageRoot, type: 'symlink' }],
        );
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('runtime verification rejects files added after the integrity manifest is written', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-integrity-'));
    try {
        await writeFile(
            path.join(fixtureRoot, 'package.json'),
            '{"name":"fixture-runtime","version":"1.0.0"}\n',
        );
        await writeFile(
            path.join(fixtureRoot, 'RUNTIME-METADATA.json'),
            `${JSON.stringify({
                deniedPackages: DENIED_RUNTIME_PACKAGES,
                gitSha: 'a'.repeat(40),
                platform: `${process.platform}/${process.arch}`,
                sourceDirty: false,
            })}\n`,
        );
        const entries = await collectArtifactEntries(fixtureRoot);
        const packages = await collectPackageInventory(fixtureRoot, entries);
        await writeFile(
            path.join(fixtureRoot, 'RUNTIME-PACKAGES.json'),
            `${JSON.stringify(packages, null, 2)}\n`,
        );
        await writeFile(
            path.join(fixtureRoot, 'RUNTIME-AUDIT.json'),
            `${JSON.stringify({
                findings: [],
                generatedAt: new Date().toISOString(),
                policy: { failOn: 'critical' },
                summary: { critical: 0, high: 0, low: 0, moderate: 0, total: 0 },
            })}\n`,
        );
        await writeIntegrityFiles(fixtureRoot);

        await verifyRuntimeArtifact(fixtureRoot, { expectedSha: 'a'.repeat(40), verifyModules: false });
        await symlink('node_modules/typescript/bin/tsc', path.join(fixtureRoot, 'unexpected-command'));
        await assert.rejects(
            verifyRuntimeArtifact(fixtureRoot, { expectedSha: 'a'.repeat(40), verifyModules: false }),
            /Runtime symlink is broken or cyclic/u,
        );
        await rm(path.join(fixtureRoot, 'unexpected-command'));
        await writeFile(path.join(fixtureRoot, 'unexpected.txt'), 'unexpected\n');
        await assert.rejects(
            () =>
                verifyRuntimeArtifact(fixtureRoot, {
                    expectedSha: 'a'.repeat(40),
                    verifyModules: false,
                }),
            /SHA256SUMS does not exactly match/u,
        );
    } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
    }
});

void test('standalone runtime verifier rechecks pinned patches and preserves raw high findings', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-patch-proof-'));
    const root = path.join(fixture, 'runtime');
    const expectedSha = 'a'.repeat(40);
    try {
        await mkdir(path.join(root, 'node_modules'), { recursive: true });
        for (const name of [
            'braces',
            'fill-range',
            'to-regex-range',
            'is-number',
            'http-cache-semantics',
            'semver',
        ]) {
            await cp(path.join(repositoryRoot, 'node_modules', name), path.join(root, 'node_modules', name), {
                recursive: true,
            });
        }
        await cp(
            path.join(repositoryRoot, 'packages/dev-server/scripts/production-runtime-verify.mjs'),
            path.join(root, 'verify-runtime.mjs'),
        );
        await cp(
            path.join(repositoryRoot, 'packages/dev-server/scripts/production-runtime-audit.mjs'),
            path.join(root, 'production-runtime-audit.mjs'),
        );
        await writeFile(path.join(root, 'package.json'), '{"name":"fixture-runtime","version":"1.0.0"}\n');
        await writeFile(
            path.join(root, 'RUNTIME-METADATA.json'),
            JSON.stringify({
                deniedPackages: DENIED_RUNTIME_PACKAGES,
                gitSha: expectedSha,
                platform: `${process.platform}/${process.arch}`,
                sourceDirty: false,
            }),
        );
        const packages = await collectPackageInventory(root);
        await writeFile(path.join(root, 'RUNTIME-PACKAGES.json'), JSON.stringify(packages));
        const raw = Object.fromEntries(
            [BRACES_PATCH, HTTP_CACHE_PATCH].map((patch, index) => [
                patch.package,
                [
                    {
                        id: index + 1,
                        severity: 'high',
                        title: 'Pinned backport regression fixture',
                        url: patch.advisory,
                        vulnerable_versions: `<=${patch.version}`,
                    },
                ],
            ]),
        );
        const saved = path.join(fixture, 'saved-audit.json');
        const lockfile = path.join(repositoryRoot, 'bun.lock');
        writeBunAuditEvidence(saved, lockfile, raw);
        const lockSha = createHash('sha256')
            .update(await readFile(lockfile))
            .digest('hex');
        const report = await auditRuntimePackages(root, packages, {
            auditReportPath: saved,
            expectedLockfileSha256: lockSha,
            failOn: 'high',
        });
        const refresh = async value => {
            await writeFile(path.join(root, 'RUNTIME-AUDIT.json'), JSON.stringify(value));
            await writeIntegrityFiles(root);
        };
        await refresh(report);
        await verifyRuntimeArtifact(root, { expectedSha, verifyModules: false });
        assert.equal(report.summary.high, 2);
        assert.equal(report.findings.length, 2);
        const standalone = spawnSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `import {verifyRuntimeArtifact} from './verify-runtime.mjs'; await verifyRuntimeArtifact('.', {expectedSha:'${expectedSha}', verifyModules:false});`,
            ],
            { cwd: root, encoding: 'utf8' },
        );
        assert.equal(standalone.status, 0, standalone.stderr);

        const forged = structuredClone(report);
        forged.verifiedPatches[0].patchSha256 = 'b'.repeat(64);
        await refresh(forged);
        await assert.rejects(
            verifyRuntimeArtifact(root, { expectedSha, verifyModules: false }),
            /patch proof/u,
        );
        await refresh(report);
        // Recomputing integrity checksums must not certify corrupted installed patch bytes.
        await writeFile(path.join(root, 'node_modules/braces/lib/parse.js'), '// unpatched copy\n');
        await writeIntegrityFiles(root);
        await assert.rejects(
            verifyRuntimeArtifact(root, { expectedSha, verifyModules: false }),
            /fingerprint mismatch/u,
        );
        await cp(
            path.join(repositoryRoot, 'node_modules/braces/lib/parse.js'),
            path.join(root, 'node_modules/braces/lib/parse.js'),
        );
        const critical = structuredClone(report);
        critical.findings[0].severity = 'critical';
        critical.summary.high -= 1;
        critical.summary.critical += 1;
        await refresh(critical);
        await assert.rejects(
            verifyRuntimeArtifact(root, { expectedSha, verifyModules: false }),
            /Runtime audit policy failed/u,
        );
        const unrelated = structuredClone(report);
        unrelated.findings[0].url = 'https://example.invalid/unapproved-high';
        unrelated.verifiedPatches = unrelated.verifiedPatches.filter(
            proof => proof.name !== unrelated.findings[0].name,
        );
        await refresh(unrelated);
        await assert.rejects(
            verifyRuntimeArtifact(root, { expectedSha, verifyModules: false }),
            /Runtime audit policy failed/u,
        );
    } finally {
        await rm(fixture, { recursive: true, force: true });
    }
});

void test('copied runtime CLI validates governance imports and the database driver before deployment', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vendure-runtime-governance-inputs-'));
    const expectedSha = 'a'.repeat(40);
    try {
        await writeFile(path.join(root, 'package.json'), '{"name":"fixture-runtime","version":"1.0.0"}\n');
        for (const file of GOVERNANCE_RECONCILIATION_RUNTIME_FILES) {
            await mkdir(path.dirname(path.join(root, file)), { recursive: true });
            await cp(path.join(repositoryRoot, file), path.join(root, file));
        }
        for (const [source, destination] of [
            ['production-runtime-verify.mjs', 'verify-runtime.mjs'],
            ['production-runtime-audit.mjs', 'production-runtime-audit.mjs'],
        ]) {
            await cp(
                path.join(repositoryRoot, 'packages/dev-server/scripts', source),
                path.join(root, destination),
            );
        }
        for (const name of ['@vendure/core', '@vendure/next-admin-plugin', 'dotenv', 'mysql2']) {
            const directory = path.join(root, 'node_modules', name);
            await mkdir(directory, { recursive: true });
            await writeFile(
                path.join(directory, 'package.json'),
                JSON.stringify({ name, version: '1.0.0', main: 'index.js' }),
            );
            await writeFile(
                path.join(directory, 'index.js'),
                'throw new Error("PROBE_MUST_ONLY_RESOLVE_DRIVER");\n',
            );
        }
        await writeFile(path.join(root, 'node_modules/dotenv/config.js'), '');
        await cp(path.join(repositoryRoot, 'node_modules/semver'), path.join(root, 'node_modules/semver'), {
            recursive: true,
        });
        await writeFile(
            path.join(root, 'node_modules/mysql2/promise.js'),
            'throw new Error("DATABASE_MUST_NOT_CONNECT");\n',
        );
        await mkdir(path.join(root, 'packages/dev-server/dist'), { recursive: true });
        for (const name of ['index.js', 'index-worker.js', 'run-migrations.js', 'dev-config.js']) {
            await writeFile(path.join(root, 'packages/dev-server/dist', name), '');
        }
        await writeFile(
            path.join(root, 'RUNTIME-METADATA.json'),
            JSON.stringify({
                deniedPackages: DENIED_RUNTIME_PACKAGES,
                gitSha: expectedSha,
                platform: `${process.platform}/${process.arch}`,
                sourceDirty: false,
            }),
        );
        const refresh = async () => {
            await writeFile(
                path.join(root, 'RUNTIME-PACKAGES.json'),
                JSON.stringify(await collectPackageInventory(root)),
            );
            await writeFile(
                path.join(root, 'RUNTIME-AUDIT.json'),
                JSON.stringify({
                    findings: [],
                    generatedAt: new Date().toISOString(),
                    policy: { failOn: 'high' },
                    summary: { critical: 0, high: 0, low: 0, moderate: 0, total: 0 },
                }),
            );
            await writeIntegrityFiles(root);
        };
        const verify = () =>
            spawnSync(process.execPath, ['verify-runtime.mjs', '--expected-sha', expectedSha], {
                cwd: root,
                encoding: 'utf8',
            });
        await refresh();
        let result = verify();
        assert.equal(result.status, 0, result.stderr);
        for (const missing of [
            'packages/dev-server/scripts/platform-governance-reconciliation.mjs',
            'packages/dev-server/scripts/store-isolation-customer-dependencies.mjs',
            'node_modules/mysql2/promise.js',
        ]) {
            const file = path.join(root, missing);
            const contents = await readFile(file);
            await rm(file);
            // A freshly generated integrity manifest cannot bless missing executable inputs.
            await refresh();
            result = verify();
            assert.notEqual(result.status, 0, missing);
            assert.match(result.stderr, /Cannot find (?:module|package)/u);
            await writeFile(file, contents);
        }
        await refresh();
        result = verify();
        assert.equal(result.status, 0, result.stderr);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

void test('runtime artifact requires isolated decoder and dedicated vault output', () => {
    for (const relative of [
        'deploy/image-worker/server.cjs',
        'deploy/image-worker/decoder.cjs',
        'deploy/image-worker/clamd.cjs',
        'packages/storefront/dist-two-factor/index.html',
    ]) {
        assert.ok(REQUIRED_RUNTIME_FILES.includes(relative), relative);
    }
});
