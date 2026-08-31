/* eslint-disable no-console */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(packageRoot, 'dist');
const indexPath = path.join(distRoot, 'index.html');
const assetsRoot = path.join(distRoot, 'assets');

const indexHtml = await readFile(indexPath, 'utf8');
const assets = await readdir(assetsRoot);
const javascriptAssets = assets.filter(fileName => fileName.endsWith('.js'));

if (!indexHtml.includes('/dashboard/assets/')) {
    throw new Error('next-admin production build must load assets from /dashboard/assets/');
}
if (!indexHtml.includes('/dashboard/favicon.svg')) {
    throw new Error('next-admin production build must load the favicon from /dashboard/favicon.svg');
}
if (javascriptAssets.length === 0) {
    throw new Error('next-admin production build did not emit any JavaScript assets');
}

for (const fileName of javascriptAssets) {
    const assetPath = path.join(assetsRoot, fileName);
    if (!(await stat(assetPath)).isFile()) continue;
    const contents = await readFile(assetPath, 'utf8');
    if (contents.includes('http://localhost:3000/admin-api')) {
        throw new Error(`Production asset contains the local Admin API URL: ${fileName}`);
    }
}

console.log('Verified next-admin production mount: /dashboard/ with same-origin /admin-api');
