/* eslint-disable no-console */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(packageRoot, 'dist');
const indexHtml = await readFile(path.join(distRoot, 'index.html'), 'utf8');

function referencedAsset(pattern, label) {
    const match = indexHtml.match(pattern);
    if (!match) throw new Error(`storefront production build does not reference its ${label}`);
    return match[1];
}

const entryAsset = referencedAsset(
    /<script\b[^>]*\bsrc=["']\/assets\/([^"']+\.js)["']/iu,
    'JavaScript entry',
);
const styleAsset = referencedAsset(/<link\b[^>]*\bhref=["']\/assets\/([^"']+\.css)["']/iu, 'main stylesheet');
const entryBytes = (await stat(path.join(distRoot, 'assets', entryAsset))).size;
const styleBytes = (await stat(path.join(distRoot, 'assets', styleAsset))).size;
const entryBudgetBytes = 380 * 1024;
const styleBudgetBytes = 380 * 1024;
const routeStyleBudgetBytes = 32 * 1024;
const routeStylePrefixes = [
    'account-catalog-surfaces-',
    'account-security-page-',
    'checkout-payment-surfaces-',
    'order-pages-',
    'product-detail-page-',
    'search-page-',
];
const emittedAssets = await readdir(path.join(distRoot, 'assets'));

if (indexHtml.includes('/storefront/restore-logo.js')) {
    throw new Error('storefront production build must not restore its logo with a parser-blocking request');
}
if (!indexHtml.includes('<!--# include virtual="/_storefront/lcp-preload" -->')) {
    throw new Error('storefront production build must preserve the host-resolved LCP preload include');
}
const routeStyleAssets = routeStylePrefixes.map(prefix => {
    const asset = emittedAssets.find(fileName => fileName.startsWith(prefix) && fileName.endsWith('.css'));
    if (!asset)
        throw new Error(`storefront production build is missing lazy route stylesheet: ${prefix}*.css`);
    return asset;
});
const routeStyleSizes = await Promise.all(
    routeStyleAssets.map(async asset => ({
        asset,
        bytes: (await stat(path.join(distRoot, 'assets', asset))).size,
    })),
);
const largestRouteStyle = routeStyleSizes.reduce((largest, current) =>
    current.bytes > largest.bytes ? current : largest,
);

if (entryBytes > entryBudgetBytes) {
    throw new Error(
        `storefront entry exceeds ${entryBudgetBytes / 1024} KiB: ${Math.ceil(entryBytes / 1024)} KiB`,
    );
}
if (styleBytes > styleBudgetBytes) {
    throw new Error(
        `storefront main CSS exceeds ${styleBudgetBytes / 1024} KiB: ${Math.ceil(styleBytes / 1024)} KiB`,
    );
}
if (largestRouteStyle.bytes > routeStyleBudgetBytes) {
    throw new Error(
        `storefront lazy route CSS exceeds ${routeStyleBudgetBytes / 1024} KiB: ${largestRouteStyle.asset} is ${Math.ceil(largestRouteStyle.bytes / 1024)} KiB`,
    );
}

console.log(
    `Verified storefront performance budgets: entry ${Math.ceil(entryBytes / 1024)} KiB; ` +
        `critical CSS ${Math.ceil(styleBytes / 1024)} KiB; ` +
        `largest lazy route CSS ${Math.ceil(largestRouteStyle.bytes / 1024)} KiB`,
);
