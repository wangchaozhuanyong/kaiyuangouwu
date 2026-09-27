import { assertDisplayLocalization } from '../../../scripts/audit-display-localization.mjs';
/* eslint-disable no-console */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assertDisplayLocalization();

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(packageRoot, 'dist');
const indexPath = path.join(distRoot, 'index.html');
const assetsRoot = path.join(distRoot, 'assets');

const indexHtml = await readFile(indexPath, 'utf8');
const assets = await readdir(assetsRoot);
const javascriptAssets = assets.filter(fileName => fileName.endsWith('.js'));
const entryScriptMatch = indexHtml.match(/<script\b[^>]*\bsrc=["']\/dashboard\/assets\/([^"']+\.js)["']/iu);
const inlineScripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)].filter(
    match => !/\bsrc\s*=/iu.test(match[1]) && match[2].trim().length > 0,
);

if (!indexHtml.includes('/dashboard/assets/')) {
    throw new Error('next-admin production build must load assets from /dashboard/assets/');
}
if (!indexHtml.includes('/dashboard/brand-icon-180.png')) {
    throw new Error('next-admin production build must load the compact brand icon');
}
const brandIconBytes = (await stat(path.join(distRoot, 'brand-icon-180.png'))).size;
if (brandIconBytes > 48 * 1024) {
    throw new Error(`next-admin brand icon exceeds 48 KiB: ${brandIconBytes} bytes`);
}
if (javascriptAssets.length === 0) {
    throw new Error('next-admin production build did not emit any JavaScript assets');
}
if (!entryScriptMatch) {
    throw new Error('next-admin production build does not reference its JavaScript entry');
}
if (inlineScripts.length > 0) {
    throw new Error('next-admin production build must not contain inline scripts blocked by production CSP');
}

const previewHtml = await readFile(path.join(distRoot, 'storefront-preview.html'), 'utf8');
const previewEntry = previewHtml.match(
    /<script\b[^>]*\bsrc=["']\/dashboard\/assets\/([^"']+\.js)["']/iu,
)?.[1];
const previewCss = [
    ...previewHtml.matchAll(/<link\b[^>]*href=["']\/dashboard\/assets\/([^"']+\.css)["']/giu),
].map(match => match[1]);
if (!previewEntry || previewEntry === entryScriptMatch[1] || previewCss.length === 0) {
    throw new Error('next-admin must emit a separate storefront preview entry and client stylesheet');
}
for (const fileName of [previewEntry, ...previewCss]) {
    await stat(path.join(assetsRoot, fileName));
}
if (
    [...previewHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)].some(
        match => !/\bsrc\s*=/iu.test(match[1]) && match[2].trim().length > 0,
    )
) {
    throw new Error('storefront preview must not contain inline scripts blocked by production CSP');
}
if (previewCss.some(fileName => indexHtml.includes(fileName))) {
    throw new Error('storefront preview CSS must stay isolated from the Admin stylesheet');
}

let hasBuildPreloadRecovery = false;
const entryAsset = entryScriptMatch[1];
const entryBytes = (await stat(path.join(assetsRoot, entryAsset))).size;
const entryBudgetBytes = 340 * 1024;
if (entryBytes > entryBudgetBytes) {
    throw new Error(
        `next-admin entry asset exceeds the ${entryBudgetBytes / 1024} KiB performance budget: ${entryAsset} is ${Math.ceil(entryBytes / 1024)} KiB`,
    );
}
for (const fileName of javascriptAssets) {
    const assetPath = path.join(assetsRoot, fileName);
    if (!(await stat(assetPath)).isFile()) continue;
    const contents = await readFile(assetPath, 'utf8');
    if (contents.includes('vite:preloadError')) {
        hasBuildPreloadRecovery = true;
    }
    if (contents.includes('http://localhost:3000/admin-api')) {
        throw new Error(`Production asset contains the local Admin API URL: ${fileName}`);
    }
}
if (!hasBuildPreloadRecovery) {
    throw new Error('next-admin production build must include stale chunk recovery');
}

console.log(
    `Verified next-admin production mount: /dashboard/ with same-origin /admin-api; entry ${Math.ceil(entryBytes / 1024)} KiB`,
);
