import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dashboardDir = path.resolve(import.meta.dirname, '../dist/dashboard');
const assetsDir = path.join(dashboardDir, 'assets');
const assetNames = await readdir(assetsDir);
const javascriptAssets = assetNames.filter(name => name.endsWith('.js'));
const requiredMarkers = [
    'v2-browser-local',
    'catalog-safe-import',
    'catalog-browser-export',
    'catalog-product-workspace',
];
const found = new Set();

for (const name of javascriptAssets) {
    const content = await readFile(path.join(assetsDir, name), 'utf8');
    for (const marker of requiredMarkers) {
        if (content.includes(marker)) found.add(marker);
    }
}

const missingMarkers = requiredMarkers.filter(marker => !found.has(marker));
const hasParserWorker = assetNames.some(name => name.startsWith('catalog-local-file.worker-'));
const hasExportWorker = assetNames.some(name => name.startsWith('catalog-export-file.worker-'));
if (missingMarkers.length || !hasParserWorker || !hasExportWorker) {
    const details = [
        missingMarkers.length ? `missing markers: ${missingMarkers.join(', ')}` : '',
        !hasParserWorker ? 'missing local parser worker' : '',
        !hasExportWorker ? 'missing local export worker' : '',
    ].filter(Boolean);
    throw new Error(`Catalog Dashboard bundle integrity check failed: ${details.join('; ')}`);
}

process.stdout.write('Catalog Dashboard bundle integrity check passed.\n');
