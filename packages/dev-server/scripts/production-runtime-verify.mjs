import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const DENIED_RUNTIME_PACKAGES = Object.freeze([
    'esbuild',
    'less',
    'tar',
    'typescript',
    'vite',
    'webpack',
]);

const CHECKSUM_FILE = 'SHA256SUMS';
const AUDIT_FILE = 'RUNTIME-AUDIT.json';
const METADATA_FILE = 'RUNTIME-METADATA.json';
const PACKAGE_INVENTORY_FILE = 'RUNTIME-PACKAGES.json';
const SYMLINK_INVENTORY_FILE = 'RUNTIME-SYMLINKS.json';

/** @typedef {{ path: string, type: 'file' } | { path: string, target: string, type: 'symlink' }} ArtifactEntry */
/** @typedef {{ name: string, path: string, version: string }} RuntimePackage */
/** @typedef {{ deniedPackages: string[], gitSha: string, platform: string, sourceDirty: boolean }} RuntimeMetadata */

/**
 * @param {string} contents
 * @returns {unknown}
 */
function parseJson(contents) {
    return JSON.parse(contents);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {RuntimePackage[]}
 */
function parsePackageInventory(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`${label} must be an array`);
    }
    return value.map((entry, index) => {
        if (
            !isRecord(entry) ||
            typeof entry.name !== 'string' ||
            typeof entry.path !== 'string' ||
            typeof entry.version !== 'string'
        ) {
            throw new Error(`${label}[${index}] is invalid`);
        }
        return { name: entry.name, path: entry.path, version: entry.version };
    });
}

/**
 * @param {unknown} value
 * @returns {RuntimeMetadata}
 */
function parseRuntimeMetadata(value) {
    if (
        !isRecord(value) ||
        !Array.isArray(value.deniedPackages) ||
        !value.deniedPackages.every(packageName => typeof packageName === 'string') ||
        typeof value.gitSha !== 'string' ||
        typeof value.platform !== 'string' ||
        typeof value.sourceDirty !== 'boolean'
    ) {
        throw new Error('Runtime metadata is invalid');
    }
    return {
        deniedPackages: value.deniedPackages,
        gitSha: value.gitSha,
        platform: value.platform,
        sourceDirty: value.sourceDirty,
    };
}

/**
 * @param {unknown} value
 * @param {RuntimePackage[]} packages
 */
function assertRuntimeAudit(value, packages) {
    const severities = ['low', 'moderate', 'high', 'critical'];
    if (
        !isRecord(value) ||
        typeof value.generatedAt !== 'string' ||
        !isRecord(value.policy) ||
        typeof value.policy.failOn !== 'string' ||
        !severities.includes(value.policy.failOn) ||
        !isRecord(value.summary) ||
        !Array.isArray(value.findings)
    ) {
        throw new Error('Runtime audit report is invalid');
    }
    const expectedPackages = new Set(
        packages.map(runtimePackage =>
            [runtimePackage.name, runtimePackage.version, runtimePackage.path].join('\u0000'),
        ),
    );
    const counts = { critical: 0, high: 0, low: 0, moderate: 0 };
    const failOnRank = severities.indexOf(value.policy.failOn);
    for (const [index, finding] of value.findings.entries()) {
        if (
            !isRecord(finding) ||
            typeof finding.id !== 'string' ||
            typeof finding.name !== 'string' ||
            typeof finding.path !== 'string' ||
            typeof finding.severity !== 'string' ||
            !severities.includes(finding.severity) ||
            typeof finding.title !== 'string' ||
            typeof finding.url !== 'string' ||
            typeof finding.version !== 'string' ||
            typeof finding.vulnerableVersions !== 'string'
        ) {
            throw new Error(`Runtime audit finding ${index} is invalid`);
        }
        const packageKey = [finding.name, finding.version, finding.path].join('\u0000');
        if (!expectedPackages.has(packageKey)) {
            throw new Error(`Runtime audit finding does not match package inventory: ${finding.path}`);
        }
        counts[finding.severity] += 1;
        if (severities.indexOf(finding.severity) >= failOnRank) {
            throw new Error(
                `Runtime audit policy failed: ${finding.name}@${finding.version} is ${finding.severity}`,
            );
        }
    }
    if (
        value.summary.total !== value.findings.length ||
        severities.some(severity => value.summary[severity] !== counts[severity])
    ) {
        throw new Error('Runtime audit summary does not match its findings');
    }
}

function isPathInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return (
        relative !== '' &&
        !relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative)
    );
}

/**
 * @param {string} root
 * @param {string} [current]
 * @returns {Promise<ArtifactEntry[]>}
 */
async function walkDirectory(root, current = root) {
    /** @type {ArtifactEntry[]} */
    const entries = [];
    const directoryEntries = await readdir(current, { withFileTypes: true });
    directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const directoryEntry of directoryEntries) {
        const absolutePath = path.join(current, directoryEntry.name);
        const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
        const stats = await lstat(absolutePath);

        if (stats.isSymbolicLink()) {
            entries.push({ path: relativePath, target: await readlink(absolutePath), type: 'symlink' });
        } else if (stats.isDirectory()) {
            entries.push(...(await walkDirectory(root, absolutePath)));
        } else if (stats.isFile()) {
            entries.push({ path: relativePath, type: 'file' });
        } else {
            throw new Error(`Runtime artifact contains unsupported filesystem entry: ${relativePath}`);
        }
    }
    return entries;
}

/**
 * @param {string} root
 * @returns {Promise<ArtifactEntry[]>}
 */
export async function collectArtifactEntries(root) {
    const resolvedRoot = path.resolve(root);
    const stats = await lstat(resolvedRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Runtime artifact root must be a real directory: ${resolvedRoot}`);
    }
    return walkDirectory(resolvedRoot);
}

/**
 * @param {string} root
 * @param {ArtifactEntry[]} [entries]
 */
export async function assertVendureWorkspaceSymlinksResolve(root, entries) {
    const artifactEntries = entries ?? (await collectArtifactEntries(root));
    const workspacePackageSymlinks = artifactEntries.filter(
        entry =>
            entry.type === 'symlink' &&
            /^node_modules\/@vendure\/[^/]+$/u.test(entry.path) &&
            entry.target.startsWith('../../packages/'),
    );

    for (const entry of workspacePackageSymlinks) {
        const symlinkPath = path.join(root, entry.path);
        const targetPath = path.resolve(path.dirname(symlinkPath), entry.target);
        if (!isPathInside(root, targetPath)) {
            throw new Error(`Runtime workspace package symlink escapes the artifact: ${entry.path}`);
        }
        try {
            const targetStats = await lstat(targetPath);
            if (!targetStats.isDirectory()) {
                throw new Error('target is not a directory');
            }
        } catch {
            throw new Error(`Runtime workspace package symlink is broken: ${entry.path}`);
        }
    }
}

/** @param {string} relativePath */
function isInstalledPackageManifest(relativePath) {
    const segments = relativePath.split('/');
    if (segments.at(-1) !== 'package.json') {
        return false;
    }
    if (segments.length === 1 || (segments.length === 3 && segments[0] === 'packages')) {
        return true;
    }
    const nodeModulesIndex = segments.lastIndexOf('node_modules');
    const packagePathLength = segments.length - nodeModulesIndex - 1;
    return (
        nodeModulesIndex >= 0 &&
        (packagePathLength === 2 ||
            (packagePathLength === 3 && segments[nodeModulesIndex + 1].startsWith('@')))
    );
}

/**
 * @param {string} root
 * @param {ArtifactEntry[]} [entries]
 * @returns {Promise<RuntimePackage[]>}
 */
export async function collectPackageInventory(root, entries) {
    const artifactEntries = entries ?? (await collectArtifactEntries(root));
    const manifests = artifactEntries
        .filter(entry => entry.type === 'file' && isInstalledPackageManifest(entry.path))
        .map(entry => entry.path);
    /** @type {RuntimePackage[]} */
    const packages = [];

    for (const manifestPath of manifests) {
        const contents = parseJson(await readFile(path.join(root, manifestPath), 'utf8'));
        if (isRecord(contents) && typeof contents.name === 'string' && typeof contents.version === 'string') {
            packages.push({
                name: contents.name,
                path: manifestPath.slice(0, -'/package.json'.length),
                version: contents.version,
            });
        }
    }
    return packages.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * @param {RuntimePackage[]} packages
 * @param {readonly string[]} [deniedPackages]
 */
export function findDeniedPackages(packages, deniedPackages = DENIED_RUNTIME_PACKAGES) {
    const deniedNames = new Set(deniedPackages);
    return packages.filter(runtimePackage => deniedNames.has(runtimePackage.name));
}

async function sha256File(filePath) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}

export async function writeIntegrityFiles(root) {
    const initialEntries = await collectArtifactEntries(root);
    const symlinks = initialEntries
        .filter(entry => entry.type === 'symlink')
        .map(({ path: symlinkPath, target }) => ({ path: symlinkPath, target }));
    await writeFile(path.join(root, SYMLINK_INVENTORY_FILE), `${JSON.stringify(symlinks, null, 2)}\n`);

    const entries = await collectArtifactEntries(root);
    const regularFiles = entries
        .filter(entry => entry.type === 'file' && entry.path !== CHECKSUM_FILE)
        .map(entry => entry.path);
    const checksumLines = [];
    for (const relativePath of regularFiles) {
        if (relativePath.includes('\n') || relativePath.includes('\r')) {
            throw new Error(`Runtime artifact filename cannot contain a newline: ${relativePath}`);
        }
        checksumLines.push(`${await sha256File(path.join(root, relativePath))}  ${relativePath}`);
    }
    await writeFile(path.join(root, CHECKSUM_FILE), `${checksumLines.join('\n')}\n`);
}

/** @param {string} contents */
function parseChecksumManifest(contents) {
    return contents
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
            if (!match) {
                throw new Error(`Invalid SHA256SUMS entry: ${line}`);
            }
            return { hash: match[1], path: match[2] };
        });
}

/**
 * @param {string} root
 * @param {string} relativePath
 */
function resolveManifestPath(root, relativePath) {
    const resolved = path.resolve(root, relativePath);
    if (!isPathInside(root, resolved)) {
        throw new Error(`Integrity manifest path escapes artifact root: ${relativePath}`);
    }
    return resolved;
}

/**
 * @param {string} root
 * @param {ArtifactEntry[]} entries
 */
async function verifyIntegrity(root, entries) {
    const checksumEntries = parseChecksumManifest(await readFile(path.join(root, CHECKSUM_FILE), 'utf8'));
    const expectedFiles = entries
        .filter(entry => entry.type === 'file' && entry.path !== CHECKSUM_FILE)
        .map(entry => entry.path);
    assert.deepEqual(
        checksumEntries.map(entry => entry.path),
        expectedFiles,
        'SHA256SUMS does not exactly match the artifact files',
    );
    for (const checksumEntry of checksumEntries) {
        const actualHash = await sha256File(resolveManifestPath(root, checksumEntry.path));
        assert.equal(actualHash, checksumEntry.hash, `Checksum mismatch: ${checksumEntry.path}`);
    }

    const expectedSymlinks = parseJson(await readFile(path.join(root, SYMLINK_INVENTORY_FILE), 'utf8'));
    const actualSymlinks = entries
        .filter(entry => entry.type === 'symlink')
        .map(({ path: symlinkPath, target }) => ({ path: symlinkPath, target }));
    assert.deepEqual(
        actualSymlinks,
        expectedSymlinks,
        'Runtime symlink inventory does not match the artifact',
    );
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [environment]
 */
function runNode(root, args, environment = process.env) {
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        env: environment,
    });
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        throw new Error(`Runtime Node validation failed: ${args.join(' ')}${detail ? `\n${detail}` : ''}`);
    }
}

function verifyRuntimeModules(root) {
    runNode(root, ['--check', 'packages/dev-server/dist/index.js']);
    runNode(root, ['--check', 'packages/dev-server/dist/index-worker.js']);
    runNode(root, ['--check', 'packages/dev-server/dist/run-migrations.js']);
    const probe = [
        "require.resolve('@vendure/core')",
        "require.resolve('@vendure/dashboard/plugin')",
        "require.resolve('dotenv/config')",
        "require('./packages/dev-server/dist/dev-config.js')",
    ].join(';');
    runNode(root, ['-e', probe], {
        ...process.env,
        DB: 'mysql',
        IS_INSTRUMENTED: 'false',
        NODE_ENV: 'development',
        VENDURE_BOOTSTRAP_BASE_SCHEMA: 'true',
        VENDURE_SERVE_GRAPHIQL: 'false',
    });
}

/**
 * @param {string} root
 * @param {{ allowDirty?: boolean, expectedSha?: string, verifyModules?: boolean }} [options]
 */
export async function verifyRuntimeArtifact(
    root,
    { allowDirty = false, expectedSha, verifyModules = true } = {},
) {
    const resolvedRoot = path.resolve(root);
    const metadata = parseRuntimeMetadata(
        parseJson(await readFile(path.join(resolvedRoot, METADATA_FILE), 'utf8')),
    );
    if (!/^[a-f0-9]{40}$/u.test(metadata.gitSha)) {
        throw new Error('Runtime metadata does not contain a full 40-character Git SHA');
    }
    if (expectedSha && metadata.gitSha !== expectedSha) {
        throw new Error(`Runtime Git SHA ${metadata.gitSha} does not match expected SHA ${expectedSha}`);
    }
    if (metadata.sourceDirty && !allowDirty) {
        throw new Error('Dirty-source runtime artifacts are not deployable');
    }
    const currentPlatform = `${process.platform}/${process.arch}`;
    if (metadata.platform !== currentPlatform) {
        throw new Error(`Runtime platform ${metadata.platform} cannot run on ${currentPlatform}`);
    }

    const entries = await collectArtifactEntries(resolvedRoot);
    await assertVendureWorkspaceSymlinksResolve(resolvedRoot, entries);
    await verifyIntegrity(resolvedRoot, entries);
    const actualPackages = await collectPackageInventory(resolvedRoot, entries);
    const expectedPackages = parsePackageInventory(
        parseJson(await readFile(path.join(resolvedRoot, PACKAGE_INVENTORY_FILE), 'utf8')),
        PACKAGE_INVENTORY_FILE,
    );
    assert.deepEqual(
        actualPackages,
        expectedPackages,
        'Runtime package inventory does not match the artifact',
    );
    assertRuntimeAudit(
        parseJson(await readFile(path.join(resolvedRoot, AUDIT_FILE), 'utf8')),
        actualPackages,
    );
    assert.deepEqual(
        metadata.deniedPackages,
        DENIED_RUNTIME_PACKAGES,
        'Runtime denied-package policy is invalid',
    );
    const deniedPackages = findDeniedPackages(actualPackages, metadata.deniedPackages);
    if (deniedPackages.length > 0) {
        throw new Error(
            `Denied runtime packages found: ${deniedPackages.map(runtimePackage => `${runtimePackage.name}@${runtimePackage.version}`).join(', ')}`,
        );
    }
    if (verifyModules) {
        verifyRuntimeModules(resolvedRoot);
    }
    return {
        files: entries.filter(entry => entry.type === 'file').length,
        packages: actualPackages.length,
        metadata,
    };
}

async function main() {
    const { values } = parseArgs({
        options: {
            'allow-dirty': { type: 'boolean' },
            artifact: { type: 'string' },
            'expected-sha': { type: 'string' },
        },
        strict: true,
    });
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const artifactRoot = path.resolve(values.artifact ?? scriptDirectory);
    const result = await verifyRuntimeArtifact(artifactRoot, {
        allowDirty: values['allow-dirty'] ?? false,
        expectedSha: values['expected-sha'],
    });
    process.stdout.write(
        `Runtime artifact verified: ${result.metadata.gitSha} (${result.metadata.platform}), ${result.files} files, ${result.packages} packages\n`,
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
