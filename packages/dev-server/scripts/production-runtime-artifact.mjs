import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { damatongAssets } from './damatong-storefront-config.mjs';
import { auditRuntimePackages } from './production-runtime-audit.mjs';
import {
    collectArtifactEntries,
    collectPackageInventory,
    DENIED_RUNTIME_PACKAGES,
    findDeniedPackages,
    verifyRuntimeArtifact,
    writeIntegrityFiles,
} from './production-runtime-verify.mjs';
import { moyaoBrandAssets } from './sync-moyao-brand.mjs';
import { storefrontMediaManifest } from './sync-storefront-media.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../..');
export const runtimeArtifactsRoot = path.join(repositoryRoot, 'artifacts', 'production-runtime');

export const RUNTIME_PACKAGE_ASSETS = Object.freeze({
    'asset-server-plugin': ['lib'],
    'catalog-management-plugin': ['dist'],
    'commerce-fulfillment-plugin': ['dist'],
    common: ['lib'],
    'content-translation-plugin': ['dist'],
    core: ['dist'],
    dashboard: ['dist'],
    'dev-server': ['dist', 'email-templates'],
    'email-plugin': ['lib', 'templates', 'dev-mailbox.html'],
    'harden-plugin': ['lib'],
    'image-generation-plugin': ['dist'],
    'next-admin': ['dist'],
    'operations-dashboard-plugin': ['dist'],
    'two-factor-dashboard-plugin': ['dist'],
    'store-domain-plugin': ['dist'],
    'store-management-plugin': ['dist'],
    'storefront-cart-plugin': ['dist'],
    'storefront-catalog-plugin': ['dist'],
    'storefront-content-plugin': ['dist'],
    'storefront-review-plugin': ['dist'],
    'telemetry-plugin': ['dist'],
});

const STOREFRONT_MEDIA_RUNTIME_FILES = Object.freeze(
    storefrontMediaManifest.map(entry => path.relative(repositoryRoot, entry.file).split(path.sep).join('/')),
);
const MOYAO_BRAND_RUNTIME_FILES = Object.freeze(
    moyaoBrandAssets.map(entry => path.relative(repositoryRoot, entry.file).split(path.sep).join('/')),
);
// Stage one installs the guard without publishing data. Once stage two adds the
// reviewed publisher, it becomes a required, checksum-protected runtime input.
export const HOMEPAGE_CAROUSEL_RUNTIME_FILES = Object.freeze(
    ['packages/dev-server/scripts/sync-homepage-carousel.mjs'].filter(file =>
        existsSync(path.join(repositoryRoot, file)),
    ),
);
export const REFERRAL_POSTER_RUNTIME_FILES = Object.freeze(
    existsSync(path.join(repositoryRoot, 'packages/dev-server/scripts/sync-referral-posters.mjs'))
        ? [
              'packages/dev-server/scripts/sync-referral-posters.mjs',
              ...[
                  'manifest.json',
                  '01-clear-blue.png',
                  '02-warm-paper.png',
                  '03-jade-form.png',
                  '04-champagne-arc.png',
                  '05-lilac-prism.png',
                  '06-ai-core.png',
              ].map(file => `packages/dev-server/assets/referral-posters/v2/${file}`),
          ]
        : [],
);
const DAMATONG_RUNTIME_FILES = Object.freeze(
    damatongAssets.map(entry => path.relative(repositoryRoot, entry.file).split(path.sep).join('/')),
);

export const REQUIRED_RUNTIME_FILES = Object.freeze([
    'packages/catalog-management-plugin/dist/index.js',
    'packages/dev-server/dist/index.js',
    'packages/dev-server/dist/index-worker.js',
    'packages/dev-server/dist/run-migrations.js',
    'packages/next-admin/dist/index.html',
    'packages/dev-server/email-templates/order-confirmation/body.hbs',
    'packages/content-translation-plugin/dist/index.js',
    'packages/image-generation-plugin/dist/index.js',
    'packages/two-factor-dashboard-plugin/dist/index.js',
    'packages/telemetry-plugin/dist/index.js',
    'packages/storefront/dist/index.html',
    'packages/dev-server/scripts/sync-storefront-media.mjs',
    'packages/dev-server/scripts/sync-auth-visuals.mjs',
    'packages/dev-server/scripts/sync-moyao-brand.mjs',
    'packages/dev-server/scripts/damatong-storefront-config.mjs',
    'packages/dev-server/scripts/sync-damatong-storefront.mjs',
    'packages/dev-server/scripts/repair-inventory-inheritance.mjs',
    'packages/image-generation-plugin/dist/index.js',
    ...STOREFRONT_MEDIA_RUNTIME_FILES,
    ...MOYAO_BRAND_RUNTIME_FILES,
    ...HOMEPAGE_CAROUSEL_RUNTIME_FILES,
    ...REFERRAL_POSTER_RUNTIME_FILES,
    ...DAMATONG_RUNTIME_FILES,
]);

function isPathInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return (
        relative !== '' &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative)
    );
}

export async function assertSafeOutputPath(outputPath) {
    const resolvedOutput = path.resolve(repositoryRoot, outputPath);
    if (!isPathInside(runtimeArtifactsRoot, resolvedOutput)) {
        throw new Error(`Output must be a child of ${runtimeArtifactsRoot}`);
    }
    try {
        await stat(resolvedOutput);
        throw new Error(`Output already exists and will not be overwritten: ${resolvedOutput}`);
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            throw error;
        }
    }
    return resolvedOutput;
}

export async function ensureRuntimeRootPermissions(runtimeRoot) {
    await chmod(runtimeRoot, 0o755);
    const mode = (await stat(runtimeRoot)).mode % 0o1000;
    if (mode !== 0o755) {
        throw new Error(`Runtime artifact root must use mode 755, received ${mode.toString(8)}`);
    }
}

function git(...args) {
    return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function commandVersion(command, args = ['--version']) {
    return execFileSync(command, args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
}

function timestampForPath(date = new Date()) {
    return date
        .toISOString()
        .replace(/[-:]/gu, '')
        .replace(/\.\d{3}Z$/u, 'Z');
}

function sha256(contents) {
    return createHash('sha256').update(contents).digest('hex');
}

async function copyInstallerInputs(stagingRoot) {
    for (const relativePath of ['package.json', 'bun.lock', 'bunfig.toml']) {
        await cp(path.join(repositoryRoot, relativePath), path.join(stagingRoot, relativePath));
    }
    await cp(path.join(repositoryRoot, 'patches'), path.join(stagingRoot, 'patches'), { recursive: true });
    const sourcePackages = await readdir(path.join(repositoryRoot, 'packages'), { withFileTypes: true });
    for (const sourcePackage of sourcePackages) {
        if (!sourcePackage.isDirectory()) {
            continue;
        }
        const sourceManifest = path.join(repositoryRoot, 'packages', sourcePackage.name, 'package.json');
        try {
            await stat(sourceManifest);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        const destinationDirectory = path.join(stagingRoot, 'packages', sourcePackage.name);
        await mkdir(destinationDirectory, { recursive: true });
        await cp(sourceManifest, path.join(destinationDirectory, 'package.json'));
    }
}

function installProductionDependencies(stagingRoot) {
    const args = [
        'install',
        '--production',
        '--frozen-lockfile',
        '--filter',
        'dev-server',
        '--ignore-scripts',
        '--linker=hoisted',
    ];
    const result = spawnSync('bun', args, { cwd: stagingRoot, stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`Production dependency install failed with exit code ${result.status ?? 'unknown'}`);
    }
}

export async function pruneDeniedRuntimePackages(stagingRoot) {
    const entries = await collectArtifactEntries(stagingRoot);
    const runtimePackages = await collectPackageInventory(stagingRoot, entries);
    const deniedPackages = findDeniedPackages(runtimePackages).sort(
        (left, right) => right.path.split('/').length - left.path.split('/').length,
    );
    for (const runtimePackage of deniedPackages) {
        await rm(path.join(stagingRoot, runtimePackage.path), { recursive: true, force: true });
    }
    return deniedPackages;
}

async function pruneInstallerWorkspace(stagingRoot) {
    const stagingPackagesRoot = path.join(stagingRoot, 'packages');
    const packageDirectories = await readdir(stagingPackagesRoot, { withFileTypes: true });
    for (const packageDirectory of packageDirectories) {
        if (packageDirectory.isDirectory() && !(packageDirectory.name in RUNTIME_PACKAGE_ASSETS)) {
            await rm(path.join(stagingPackagesRoot, packageDirectory.name), { recursive: true, force: true });
        }
    }
    for (const relativePath of ['bun.lock', 'bunfig.toml', 'patches']) {
        await rm(path.join(stagingRoot, relativePath), { recursive: true, force: true });
    }
}

async function copyRuntimeBuildOutputs(stagingRoot) {
    for (const [packageDirectory, assets] of Object.entries(RUNTIME_PACKAGE_ASSETS)) {
        for (const asset of assets) {
            const source = path.join(repositoryRoot, 'packages', packageDirectory, asset);
            const destination = path.join(stagingRoot, 'packages', packageDirectory, asset);
            try {
                await stat(source);
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    throw new Error(
                        `Required production build output is missing: ${path.relative(repositoryRoot, source)}`,
                    );
                }
                throw error;
            }
            await cp(source, destination, { recursive: true });
        }
    }
    const storefrontSource = path.join(repositoryRoot, 'packages/storefront/dist');
    try {
        await stat(storefrontSource);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error('Required production build output is missing: packages/storefront/dist');
        }
        throw error;
    }
    await mkdir(path.join(stagingRoot, 'packages/storefront'), { recursive: true });
    await cp(storefrontSource, path.join(stagingRoot, 'packages/storefront/dist'), { recursive: true });
}

export async function copyStorefrontMediaReleaseInputs(stagingRoot) {
    const releaseScripts = [
        'sync-storefront-media.mjs',
        'sync-auth-visuals.mjs',
        'sync-moyao-brand.mjs',
        'damatong-storefront-config.mjs',
        'sync-damatong-storefront.mjs',
        'repair-inventory-inheritance.mjs',
        ...HOMEPAGE_CAROUSEL_RUNTIME_FILES.map(file => path.basename(file)),
    ];
    for (const scriptName of releaseScripts) {
        const scriptSource = path.join(repositoryRoot, 'packages/dev-server/scripts', scriptName);
        const scriptDestination = path.join(stagingRoot, 'packages/dev-server/scripts', scriptName);
        await mkdir(path.dirname(scriptDestination), { recursive: true });
        await cp(scriptSource, scriptDestination);
    }

    for (const file of REFERRAL_POSTER_RUNTIME_FILES) {
        const destination = path.join(stagingRoot, file);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(path.join(repositoryRoot, file), destination);
    }

    for (const entry of storefrontMediaManifest) {
        const relativePath = path.relative(repositoryRoot, entry.file);
        if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            throw new Error(`Storefront media must stay inside the repository: ${entry.file}`);
        }
        const destination = path.join(stagingRoot, relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(entry.file, destination);
    }

    for (const entry of moyaoBrandAssets) {
        const relativePath = path.relative(repositoryRoot, entry.file);
        if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            throw new Error(`MOYAO AI brand asset must stay inside the repository: ${entry.file}`);
        }
        const destination = path.join(stagingRoot, relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(entry.file, destination);
    }

    for (const entry of damatongAssets) {
        const relativePath = path.relative(repositoryRoot, entry.file);
        if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            throw new Error(`Damatong asset must stay inside the repository: ${entry.file}`);
        }
        const destination = path.join(stagingRoot, relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(entry.file, destination);
    }
}

/**
 * @param {string} stagingRoot
 * @param {{ engines?: Record<string, string>, version?: string }} rootManifest
 * @param {Record<string, unknown>} metadata
 */
async function writeRuntimeRootFiles(stagingRoot, rootManifest, metadata) {
    const runtimeManifest = {
        name: 'vendure-production-runtime',
        version: rootManifest.version,
        private: true,
        engines: rootManifest.engines,
        scripts: {
            migrate: 'node packages/dev-server/dist/run-migrations.js',
            'repair:inventory-inheritance':
                'node packages/dev-server/scripts/repair-inventory-inheritance.mjs',
            'sync:storefront-media': 'node packages/dev-server/scripts/sync-storefront-media.mjs',
            'sync:auth-visuals': 'node packages/dev-server/scripts/sync-auth-visuals.mjs',
            'sync:moyao-brand': 'node packages/dev-server/scripts/sync-moyao-brand.mjs',
            'sync:damatong-storefront': 'node packages/dev-server/scripts/sync-damatong-storefront.mjs',
            'start:server': 'node packages/dev-server/dist/index.js',
            'start:worker': 'node packages/dev-server/dist/index-worker.js',
            verify: 'node verify-runtime.mjs',
        },
    };
    await writeFile(path.join(stagingRoot, 'package.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`);
    await cp(
        path.join(repositoryRoot, 'packages/dev-server/scripts/production-runtime-verify.mjs'),
        path.join(stagingRoot, 'verify-runtime.mjs'),
    );
    await writeFile(
        path.join(stagingRoot, 'RUNTIME-METADATA.json'),
        `${JSON.stringify(metadata, null, 2)}\n`,
    );
}

async function assertRequiredFiles(stagingRoot) {
    for (const requiredFile of REQUIRED_RUNTIME_FILES) {
        try {
            const fileStats = await stat(path.join(stagingRoot, requiredFile));
            if (!fileStats.isFile()) {
                throw new Error('not a file');
            }
        } catch {
            throw new Error(`Required runtime file is missing: ${requiredFile}`);
        }
    }
}

/**
 * @param {{ allowDirty?: boolean, auditLevel?: string, auditReportPath?: string, output?: string, requirePlatform?: string }} [options]
 */
export async function buildRuntimeArtifact({
    allowDirty = false,
    auditLevel = 'high',
    auditReportPath,
    output,
    requirePlatform,
} = {}) {
    const platform = `${process.platform}/${process.arch}`;
    if (requirePlatform && requirePlatform !== platform) {
        throw new Error(`Runtime artifact requires ${requirePlatform}, but this build host is ${platform}`);
    }
    const gitSha = git('rev-parse', 'HEAD^{commit}');
    const sourceDirty = git('status', '--porcelain') !== '';
    if (sourceDirty && !allowDirty) {
        throw new Error('Refusing to build a deployable runtime artifact from a dirty worktree');
    }
    const defaultName = `${gitSha}-${timestampForPath()}-${process.platform}-${process.arch}${sourceDirty ? '-dirty' : ''}`;
    const resolvedOutput = await assertSafeOutputPath(output ?? path.join(runtimeArtifactsRoot, defaultName));
    await mkdir(runtimeArtifactsRoot, { recursive: true });
    const stagingRoot = await mkdtemp(path.join(runtimeArtifactsRoot, '.building-'));

    try {
        const rootManifestContents = await readFile(path.join(repositoryRoot, 'package.json'), 'utf8');
        const lockfileContents = await readFile(path.join(repositoryRoot, 'bun.lock'));
        const lockfileSha256 = sha256(lockfileContents);
        const parsedRootManifest = JSON.parse(rootManifestContents);
        const rootManifest = {
            engines:
                parsedRootManifest && typeof parsedRootManifest.engines === 'object'
                    ? parsedRootManifest.engines
                    : undefined,
            version:
                parsedRootManifest && typeof parsedRootManifest.version === 'string'
                    ? parsedRootManifest.version
                    : undefined,
        };
        await copyInstallerInputs(stagingRoot);
        installProductionDependencies(stagingRoot);
        await pruneDeniedRuntimePackages(stagingRoot);
        await pruneInstallerWorkspace(stagingRoot);
        await copyRuntimeBuildOutputs(stagingRoot);
        await copyStorefrontMediaReleaseInputs(stagingRoot);

        const metadata = {
            artifactFormat: 1,
            buildTime: new Date().toISOString(),
            bunVersion: commandVersion('bun'),
            deniedPackages: DENIED_RUNTIME_PACKAGES,
            gitSha,
            lockfileSha256,
            nodeVersion: process.version,
            platform,
            sourceDirty,
            startCommands: {
                server: 'node packages/dev-server/dist/index.js',
                worker: 'node packages/dev-server/dist/index-worker.js',
            },
        };
        await writeRuntimeRootFiles(stagingRoot, rootManifest, metadata);
        await assertRequiredFiles(stagingRoot);

        const entries = await collectArtifactEntries(stagingRoot);
        const runtimePackages = await collectPackageInventory(stagingRoot, entries);
        const deniedPackages = findDeniedPackages(runtimePackages);
        if (deniedPackages.length > 0) {
            throw new Error(`Denied runtime package found before release: ${deniedPackages[0].path}`);
        }
        await writeFile(
            path.join(stagingRoot, 'RUNTIME-PACKAGES.json'),
            `${JSON.stringify(runtimePackages, null, 2)}\n`,
        );
        await auditRuntimePackages(stagingRoot, runtimePackages, {
            auditReportPath,
            expectedLockfileSha256: lockfileSha256,
            failOn: auditLevel,
        });
        await writeIntegrityFiles(stagingRoot);
        await verifyRuntimeArtifact(stagingRoot, { allowDirty, expectedSha: gitSha });
        await ensureRuntimeRootPermissions(stagingRoot);
        await rename(stagingRoot, resolvedOutput);
        return resolvedOutput;
    } catch (error) {
        await rm(stagingRoot, { recursive: true, force: true });
        throw error;
    }
}

async function main() {
    const { values } = parseArgs({
        options: {
            'allow-dirty': { type: 'boolean' },
            'audit-level': { type: 'string' },
            'audit-report': { type: 'string' },
            output: { type: 'string' },
            'require-platform': { type: 'string' },
        },
        strict: true,
    });
    const output = await buildRuntimeArtifact({
        allowDirty: values['allow-dirty'] ?? false,
        auditLevel: values['audit-level'],
        auditReportPath: values['audit-report'],
        output: values.output,
        requirePlatform: values['require-platform'],
    });
    process.stdout.write(`Production runtime artifact created: ${output}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
