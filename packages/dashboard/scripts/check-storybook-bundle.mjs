import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const outputDirectory = path.resolve('storybook-static');
const budgets = {
    iframeRaw: 1_850_000,
    iframeGzip: 525_000,
    chunkRaw: 1_600_000,
    chunkGzip: 550_000,
    managerRaw: 3_500_000,
    managerGzip: 750_000,
};

async function findJavaScriptAssets(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const assets = [];

    for (const entry of entries) {
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
            assets.push(...(await findJavaScriptAssets(path.join(directory, entry.name), relativePath)));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            assets.push(relativePath);
        }
    }

    return assets;
}

const assetNames = await findJavaScriptAssets(outputDirectory);
const iframeEntries = assetNames.filter(name => path.basename(name).startsWith('iframe-'));

if (iframeEntries.length !== 1) {
    throw new Error(`Expected one Storybook iframe entry, found ${iframeEntries.length}.`);
}

const violations = [];
for (const assetName of assetNames) {
    const source = await readFile(path.join(outputDirectory, assetName));
    const rawBytes = source.byteLength;
    const gzipBytes = gzipSync(source).byteLength;
    const isIframeEntry = path.basename(assetName).startsWith('iframe-');
    const isManagerRuntime = assetName.startsWith(`sb-manager${path.sep}`);
    const rawBudget = isIframeEntry
        ? budgets.iframeRaw
        : isManagerRuntime
          ? budgets.managerRaw
          : budgets.chunkRaw;
    const gzipBudget = isIframeEntry
        ? budgets.iframeGzip
        : isManagerRuntime
          ? budgets.managerGzip
          : budgets.chunkGzip;

    if (rawBytes > rawBudget || gzipBytes > gzipBudget) {
        violations.push(
            `${assetName}: raw ${rawBytes}/${rawBudget} bytes, gzip ${gzipBytes}/${gzipBudget} bytes`,
        );
    }
}

if (violations.length > 0) {
    throw new Error(`Storybook bundle budget exceeded:\n${violations.join('\n')}`);
}

const iframeSource = await readFile(path.join(outputDirectory, iframeEntries[0]));
console.log(
    `Storybook bundle budgets passed: iframe raw ${iframeSource.byteLength} bytes, gzip ${gzipSync(iframeSource).byteLength} bytes.`,
);
