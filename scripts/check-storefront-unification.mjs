import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [
    'packages/storefront/src',
    'packages/storefront/public',
    'packages/storefront-content-plugin/src',
    'packages/store-management-plugin/src',
    'packages/commerce-fulfillment-plugin/src',
    'packages/dev-server/plugins/commerce-fulfillment',
    'packages/next-admin/src',
];
const merchantBrand = /moyao|模钥|大马通|damatong|flashcast|闪铸|美宜佳|miyijia/iu;
const storeCodeBranch =
    /\b(?:channel|store|market|config|profile)\??\.code\s*(?:===?|!==?)\s*['"](?!__default_channel__)[^'"]+['"]/u;
const storeCodePresetLookup = /\bmarkets\s*\[\s*config\.code\s*\]/u;
const bundledAuthCampaign = /auth-(?:login|register)-ai-campaign/iu;
const platformAdminBrandFiles = new Set([
    'packages/next-admin/src/layouts/AppShell.tsx',
    'packages/next-admin/src/pages/Auth/LoginModule.tsx',
    'packages/next-admin/src/pages/Auth/InitialPasswordChangeModule.tsx',
]);

// These surfaces were explicitly retired; historical API types and records remain valid.
export function findRetiredStorefrontIssues(source, relativePath) {
    const issues = [];
    if (/\b(?:desktopCategoryBannerInput|resolveDesktopCategoryBanner)\b/u.test(source)) {
        issues.push(`${relativePath}: retired category banner creation/rendering helper must not return`);
    }
    if (
        relativePath.startsWith('packages/storefront/') &&
        /(?:\.account-hero(?:[\w-]*)(?=[\s.{:#>\[,])|["'`]account-hero(?=[\s"'`])|\baccount-hero-art\b)/u.test(
            source,
        )
    ) {
        issues.push(`${relativePath}: retired account artwork/card implementation must not return`);
    }
    return issues;
}

export function findStorefrontUnificationIssues(source, relativePath) {
    const issues = [];
    for (const [index, line] of source.split(/\r?\n/u).entries()) {
        if (merchantBrand.test(line)) {
            // The platform Admin's own title is not merchant storefront content.
            const platformTitle =
                platformAdminBrandFiles.has(relativePath) && line.includes('MOYAO AI｜模钥管理后台');
            const platformChannelTitle =
                relativePath === 'packages/next-admin/src/utils/channel-display.ts' &&
                line.trim() ===
                    "return languageCode === 'zh_Hans' ? '模钥平台管理中心' : 'MOYAO Platform Management Center';";
            if (!platformTitle && !platformChannelTitle) {
                issues.push(`${relativePath}:${index + 1}: merchant brand in shared runtime source`);
            }
        }
        if (storeCodeBranch.test(line)) {
            issues.push(`${relativePath}:${index + 1}: store code must not select client UI or features`);
        }
        if (storeCodePresetLookup.test(line)) {
            issues.push(
                `${relativePath}:${index + 1}: Shop API configuration must override bootstrap markets`,
            );
        }
        if (bundledAuthCampaign.test(line)) {
            issues.push(`${relativePath}:${index + 1}: auth art must come from published Admin content`);
        }
    }
    return issues;
}

async function walk(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'assets' && entry.name !== '__generated__')
                files.push(...(await walk(fullPath)));
        } else if (
            entry.isFile() &&
            /\.(?:[cm]?[jt]sx?|css|html|xml|txt)$/u.test(entry.name) &&
            !/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(entry.name)
        ) {
            files.push(fullPath);
        }
    }
    return files;
}

export async function auditStorefrontUnification(repositoryRoot = root) {
    const files = (await Promise.all(roots.map(item => walk(path.join(repositoryRoot, item))))).flat();
    const issues = [];
    for (const file of files) {
        const relativePath = path.relative(repositoryRoot, file).split(path.sep).join('/');
        const source = await readFile(file, 'utf8');
        issues.push(...findRetiredStorefrontIssues(source, relativePath));
        if (!relativePath.endsWith('.css')) {
            issues.push(...findStorefrontUnificationIssues(source, relativePath));
        }
    }
    return { issues, inspectedFiles: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await auditStorefrontUnification();
    if (result.issues.length) {
        for (const issue of result.issues) process.stderr.write(`${issue}\n`);
        process.exitCode = 1;
    } else {
        process.stdout.write(
            `Checked ${result.inspectedFiles} shared runtime files for store-specific branches and brands.\n`,
        );
    }
}
