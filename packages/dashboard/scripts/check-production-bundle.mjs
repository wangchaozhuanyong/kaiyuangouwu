import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const outputDirectory = path.resolve('dist/bundle');
const defaultJavaScriptBudget = { raw: 1_500_000, gzip: 280_000 };
const styleBudget = { raw: 150_000, gzip: 40_000 };
const fontBudget = { raw: 100_000, gzip: 100_000 };
const totalFontBudget = 450_000;

async function findBundleAssets(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const assets = [];

    for (const entry of entries) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            assets.push(...(await findBundleAssets(path.join(directory, entry.name), relativePath)));
        } else if (entry.isFile() && /\.(css|js|woff2)$/.test(entry.name)) {
            assets.push(relativePath);
        }
    }

    return assets;
}

const assetNames = await findBundleAssets(outputDirectory);
const violations = [];
let totalFontBytes = 0;

for (const assetName of assetNames) {
    const source = await readFile(path.join(outputDirectory, assetName));
    const rawBytes = source.byteLength;
    const gzipBytes = gzipSync(source).byteLength;
    const budget = assetName.endsWith('.css')
        ? styleBudget
        : assetName.endsWith('.woff2')
          ? fontBudget
          : defaultJavaScriptBudget;

    if (assetName.endsWith('.woff2')) {
        totalFontBytes += rawBytes;
    }

    if (assetName.endsWith('.css') && source.includes(Buffer.from('data:font/woff2;base64,'))) {
        violations.push(`${assetName}: contains eagerly inlined WOFF2 data`);
    }

    if (assetName.endsWith('.css')) {
        const css = source.toString('utf8');
        for (const match of css.matchAll(/url\((?:['"])?([^)'"?]+\.woff2)(?:['"])?\)/g)) {
            const referencedFont = path.resolve(outputDirectory, path.dirname(assetName), match[1]);
            try {
                await readFile(referencedFont);
            } catch {
                violations.push(`${assetName}: missing referenced font ${match[1]}`);
            }
        }
    }

    if (rawBytes > budget.raw || gzipBytes > budget.gzip) {
        violations.push(
            `${assetName}: raw ${rawBytes}/${budget.raw} bytes, gzip ${gzipBytes}/${budget.gzip} bytes`,
        );
    }
}

if (totalFontBytes > totalFontBudget) {
    violations.push(`font assets: raw ${totalFontBytes}/${totalFontBudget} bytes`);
}

if (violations.length > 0) {
    throw new Error(`Production bundle budget exceeded:\n${violations.join('\n')}`);
}

console.log(`Production bundle budgets passed across ${assetNames.length} JS/CSS/WOFF2 assets.`);
