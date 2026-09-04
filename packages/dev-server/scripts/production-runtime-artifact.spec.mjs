import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    assertSafeOutputPath,
    copyStorefrontMediaReleaseInputs,
    ensureRuntimeRootPermissions,
    pruneDeniedRuntimePackages,
    repositoryRoot,
    REQUIRED_RUNTIME_FILES,
    RUNTIME_PACKAGE_ASSETS,
    runtimeArtifactsRoot,
} from './production-runtime-artifact.mjs';
import {
    assertVendureWorkspaceSymlinksResolve,
    collectArtifactEntries,
    collectPackageInventory,
    DENIED_RUNTIME_PACKAGES,
    findDeniedPackages,
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

void test('runtime artifact serves the standalone next-admin application', () => {
    assert.deepEqual(RUNTIME_PACKAGE_ASSETS['next-admin'], ['dist']);
    assert.ok(REQUIRED_RUNTIME_FILES.includes('packages/next-admin/dist/index.html'));
    assert.ok(!REQUIRED_RUNTIME_FILES.includes('packages/dev-server/dist/dashboard/index.html'));
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
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/sync-storefront-media.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/sync-moyao-brand.mjs'));
        await access(path.join(fixtureRoot, 'packages/dev-server/scripts/repair-inventory-inheritance.mjs'));
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
    assert.match(workflow, /read -r -a release_commit < <\(git rev-list --parents -n 1 "\$TARGET_SHA"\)/u);
    assert.match(workflow, /git merge-base --is-ancestor "\$RELEASE_BASE_SHA" "\$REVIEWED_HEAD_SHA"/u);
    assert.match(workflow, /TARGET_TREE="\$\(git rev-parse "\$TARGET_SHA\^\{tree\}"\)"/u);
    assert.match(workflow, /REVIEWED_TREE="\$\(git rev-parse "\$REVIEWED_HEAD_SHA\^\{tree\}"\)"/u);
    assert.match(workflow, /actions\/workflows\/build_and_test\.yml\/runs/u);
    assert.match(workflow, /event=pull_request&status=success&head_sha=\$\{REVIEWED_HEAD_SHA\}/u);
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
