import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, '..');
const managedRoots = ['packages/storefront/src/assets/storefront', 'packages/storefront/src/assets/brand'];
const mediaExtension = /\.(?:avif|gif|jpe?g|png|svg|webp)$/iu;
const designOnlyAssets = new Set([
    'packages/storefront/src/assets/brand/moyao-ai/icon-monochrome.svg',
    'packages/storefront/src/assets/storefront/auth-login-ai-gateway.jpg',
    'packages/storefront/src/assets/storefront/auth-register-ai-workspace.jpg',
    'packages/storefront/src/assets/storefront/logo.svg',
    'packages/storefront/src/assets/storefront/products/codex-plus-source.png',
    'packages/storefront/src/assets/storefront/products/codex-pro-x5-source.png',
    'packages/storefront/src/assets/storefront/promotions/category-gpt-source.png',
    'packages/storefront/src/assets/storefront/carousel/colorful-marketplace-v1/source/token-topup-source.png',
    'packages/storefront/src/assets/storefront/carousel/colorful-marketplace-v1/source/codex-tiers-source.png',
    'packages/storefront/src/assets/storefront/carousel/colorful-marketplace-v1/source/account-services-source.png',
]);

function toPosix(value) {
    return value.split(path.sep).join('/');
}

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(entryPath)));
        else if (entry.isFile()) files.push(entryPath);
    }
    return files;
}

function localMediaImports(source, owner) {
    const imports = [];
    const pattern = /from\s+['"](?<asset>[^'"]*assets\/(?:storefront|brand)\/[^'"]+)['"]/gu;
    for (const match of source.matchAll(pattern)) {
        const absolute = path.resolve(path.dirname(owner), match.groups.asset);
        imports.push(absolute);
    }
    return imports;
}

function publisherAssetPaths(source, baseDirectory, variableName) {
    const paths = [];
    const pattern = new RegExp(`path\\.join\\(${variableName},\\s*['\"](?<asset>[^'\"]+)['\"]\\)`, 'gu');
    for (const match of source.matchAll(pattern)) {
        paths.push(path.resolve(baseDirectory, match.groups.asset));
    }
    return paths;
}

export function findForbiddenClientMediaReferences(source, relativePath) {
    if (/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(relativePath)) return [];
    const issues = [];
    if (relativePath !== 'packages/storefront/src/storefront-images.ts') {
        if (/assets\/(?:storefront|brand)\//u.test(source)) {
            issues.push(
                `${relativePath}: managed media must be registered through storefront-images.ts, not imported directly`,
            );
        }
    }
    if (/https?:\/\/[^\s'"`)]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^\s'"`)]*)?/iu.test(source)) {
        issues.push(
            `${relativePath}: hard-coded remote media bypasses Vendure; use an Asset or managed content field`,
        );
    }
    return issues;
}

export function isDerivedResponsiveAsset(relativePath, classifiedPaths) {
    const match = relativePath.match(/^(?<stem>.+)-\d+\.webp$/u);
    if (!match) return false;
    return ['jpg', 'jpeg', 'png', 'webp'].some(extension =>
        classifiedPaths.has(`${match.groups.stem}.${extension}`),
    );
}

export async function auditStorefrontPublishingPolicy(repositoryRoot = defaultRepositoryRoot) {
    const storefrontImagesPath = path.join(repositoryRoot, 'packages/storefront/src/storefront-images.ts');
    const mediaPublisherPath = path.join(
        repositoryRoot,
        'packages/dev-server/scripts/sync-storefront-media.mjs',
    );
    const brandPublisherPath = path.join(repositoryRoot, 'packages/dev-server/scripts/sync-moyao-brand.mjs');
    const damatongPublisherConfigPath = path.join(
        repositoryRoot,
        'packages/dev-server/scripts/damatong-storefront-config.mjs',
    );
    const [storefrontImages, mediaPublisher, brandPublisher, damatongPublisherConfig] = await Promise.all([
        readFile(storefrontImagesPath, 'utf8'),
        readFile(mediaPublisherPath, 'utf8'),
        readFile(brandPublisherPath, 'utf8'),
        readFile(damatongPublisherConfigPath, 'utf8'),
    ]);

    const classifiedPaths = new Set(designOnlyAssets);
    for (const absolutePath of localMediaImports(storefrontImages, storefrontImagesPath)) {
        classifiedPaths.add(toPosix(path.relative(repositoryRoot, absolutePath)));
    }
    const storefrontAssets = path.join(repositoryRoot, managedRoots[0]);
    for (const absolutePath of publisherAssetPaths(mediaPublisher, storefrontAssets, 'storefrontAssets')) {
        classifiedPaths.add(toPosix(path.relative(repositoryRoot, absolutePath)));
    }
    const brandDirectory = path.join(repositoryRoot, managedRoots[1], 'moyao-ai');
    for (const absolutePath of publisherAssetPaths(brandPublisher, brandDirectory, 'brandDirectory')) {
        classifiedPaths.add(toPosix(path.relative(repositoryRoot, absolutePath)));
    }
    const damatongStorefrontDirectory = path.join(managedRoots[0], 'damatong');
    for (const absolutePath of publisherAssetPaths(
        damatongPublisherConfig,
        path.join(repositoryRoot, damatongStorefrontDirectory),
        'storefrontAssetDirectory',
    )) {
        classifiedPaths.add(toPosix(path.relative(repositoryRoot, absolutePath)));
    }
    const damatongBrandDirectory = path.join(managedRoots[1], 'damatong-market');
    for (const absolutePath of publisherAssetPaths(
        damatongPublisherConfig,
        path.join(repositoryRoot, damatongBrandDirectory),
        'brandAssetDirectory',
    )) {
        classifiedPaths.add(toPosix(path.relative(repositoryRoot, absolutePath)));
    }

    const issues = [];
    const managedFiles = (
        await Promise.all(managedRoots.map(root => walk(path.join(repositoryRoot, root))))
    ).flat();
    for (const absolutePath of managedFiles) {
        const relativePath = toPosix(path.relative(repositoryRoot, absolutePath));
        if (!mediaExtension.test(relativePath)) continue;
        if (!classifiedPaths.has(relativePath) && !isDerivedResponsiveAsset(relativePath, classifiedPaths)) {
            issues.push(
                `${relativePath}: unclassified media must be added to a Vendure publisher, the central fallback registry, or the explicit design-only inventory`,
            );
        }
    }

    const storefrontSourceRoot = path.join(repositoryRoot, 'packages/storefront/src');
    const sourceFiles = (await walk(storefrontSourceRoot)).filter(file =>
        /\.(?:[cm]?[jt]sx?|css)$/u.test(file),
    );
    for (const absolutePath of sourceFiles) {
        const relativePath = toPosix(path.relative(repositoryRoot, absolutePath));
        const source = await readFile(absolutePath, 'utf8');
        issues.push(...findForbiddenClientMediaReferences(source, relativePath));
    }

    return {
        classifiedMediaCount: classifiedPaths.size,
        inspectedMediaCount: managedFiles.filter(file => mediaExtension.test(file)).length,
        issues,
    };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const result = await auditStorefrontPublishingPolicy();
    assert.deepEqual(result.issues, [], result.issues.join('\n'));
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}
