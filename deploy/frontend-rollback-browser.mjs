// Local synthetic releases only. Exercises the real production asset location blocks in pinned Nginx.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { preserveFrontendAssets } from './frontend-asset-compatibility.mjs';
import { activateFrontends } from './frontend-release.mjs';
import { activateStorefront, switchStorefront } from './storefront-release.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = process.argv.includes('--baseline');
const output = path.join(repo, 'reports/realtime-rollback-20261026');
const fixture = fs.mkdtempSync(path.join(output, baseline ? 'nginx-before-' : 'nginx-after-'));
fs.chmodSync(fixture, 0o755);
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
assert.match(docker('context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'), /^unix:\/\//);
const image = 'nginx@sha256:db35bfc6b2951e7f8a72db5db120288c127ffaeeb4a6d4b95a26fead017d5913';
docker('image', 'inspect', image);
let activation = { activateFrontends, activateStorefront, switchStorefront };
if (baseline) {
    // Execute the unmodified function bodies from the requested revision against synthetic paths.
    const read = name =>
        execFileSync('git', ['show', `b5a831f:deploy/${name}`], { cwd: repo, encoding: 'utf8' });
    const storefront = read('storefront-release.mjs');
    const frontend = read('frontend-release.mjs');
    const bodies =
        storefront.slice(
            storefront.indexOf('export function switchStorefront'),
            storefront.indexOf('// CDN analytics'),
        ) +
        frontend.slice(
            frontend.indexOf('export async function activateFrontends'),
            frontend.indexOf('export async function verifyFrontend'),
        );
    activation = new Function(
        'deps',
        `const {assert,existsSync,lstatSync,realpathSync,renameSync,symlinkSync,
        unlinkSync,resolve,preserveFrontendAssets}=deps;
        ${bodies.replaceAll('export ', '')};
        return {activateFrontends,activateStorefront,switchStorefront};`,
    )({ ...fs, assert, resolve: path.resolve, preserveFrontendAssets });
}
const source = fs.readFileSync(path.join(repo, 'deploy/nginx/damatong.conf'), 'utf8');
function block(label) {
    const start = source.indexOf(label + ' {');
    assert(start >= 0, label);
    let depth = 0;
    for (let i = start + label.length + 1; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed Nginx block');
}
function release(component, suffix) {
    const dir = path.join(fixture, `${component}-${suffix}`);
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    const prefix = component === 'admin' ? '/dashboard' : '';
    const hash = suffix === 'A' ? 'aaaaaaaa' : 'bbbbbbbb';
    fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<html><body><h1>${suffix}</h1><input aria-label="Draft">
        <button id="load">Open lazy page</button><output id="result">unloaded</output>
        <script type="module" src="${prefix}/assets/entry-${hash}.js"></script></body></html>`,
    );
    fs.writeFileSync(
        path.join(dir, `assets/entry-${hash}.js`),
        `document.querySelector('#load').onclick=async()=>{
        const data=await import('${prefix}/assets/lazy-${hash}.js');
        const link=document.createElement('link');link.rel='stylesheet';
        link.href='${prefix}/assets/lazy-${hash}.css';
        await new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=reject;document.head.append(link)});
        document.querySelector('#result').textContent=data.version;};`,
    );
    fs.writeFileSync(path.join(dir, `assets/lazy-${hash}.js`), `export const version='${suffix}';`);
    fs.writeFileSync(path.join(dir, `assets/lazy-${hash}.css`), '#result{color:rgb(0,128,0)}');
    return dir;
}
const releases = ['storefront', 'admin'].map(component => {
    const old = release(component, 'A');
    const candidate = release(component, 'B');
    const pointer = path.join(fixture, `${component}-current`);
    fs.symlinkSync(old, pointer);
    return { component, old, candidate, pointer };
});
const frontAssets = block(
    source
        .split('\n')
        .find(line => line.trim().startsWith('location ~ "^/assets/'))
        .trim()
        .replace(/ \{$/u, ''),
);
const adminAssets = block('location ~ ^/dashboard/assets/.*\\.[^/]+$').replace(
    'root /var/www/kaiyuangouwu-next-admin-current;',
    `root /qa/admin-current;`,
);
const config = `events {}
http {include /etc/nginx/mime.types; default_type application/octet-stream;
map $host $customer_vault_frame_origin {default "'self'";}
${block('map "$status|$uri" $build_asset_cache_control')}
server {listen 8080; etag off; if_modified_since off; add_header Cache-Control no-store;
root /qa/storefront-current;
${frontAssets}
${adminAssets}
location /dashboard/ {alias /qa/admin-current/; index index.html;}
location / {try_files $uri $uri/ /index.html;} }}\n`;
fs.writeFileSync(path.join(fixture, 'nginx.conf'), config);
let id;
let browser;
const results = [];
try {
    id = docker(
        'run',
        '-d',
        '--rm',
        '--pull=never',
        '-p',
        '127.0.0.1::8080',
        '-v',
        `${fixture}/nginx.conf:/etc/nginx/nginx.conf:ro`,
        image,
    );
    const sync = () => {
        // Docker Desktop's macOS bind mount returned EINVAL after atomic symlink replacement.
        // Serve a byte-for-byte native Linux copy and reproduce the actual activation result there.
        docker('exec', id, 'mkdir', '-p', '/qa');
        docker('cp', fixture + '/.', id + ':/qa');
        for (const item of releases)
            docker(
                'exec',
                id,
                'ln',
                '-sfn',
                '/qa/' + path.basename(fs.realpathSync(item.pointer)),
                '/qa/' + item.component + '-current',
            );
    };
    sync();
    const port = docker('port', id, '8080/tcp').split(':').at(-1);
    const origin = `http://127.0.0.1:${port}`;
    await expect
        .poll(
            async () => {
                try {
                    return (await fetch(origin)).status;
                } catch {
                    return 0;
                }
            },
            { timeout: 5000 },
        )
        .toBe(200);
    browser = await chromium.launch({ headless: true });
    for (const entry of ['frontends', 'storefront', 'manual']) {
        // Each case starts with A. Native build files and documents remain unchanged.
        for (const item of releases) activation.switchStorefront(item.old, item.pointer);
        sync();
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const oldPages = [];
        const bPages = [];
        const active = entry === 'storefront' ? releases.slice(0, 1) : releases;
        for (const item of active) {
            const page = await context.newPage();
            await page.goto(origin + (item.component === 'admin' ? '/dashboard/' : '/'));
            await expect(page.locator('h1')).toHaveText('A');
            oldPages.push(page);
        }
        const visitB = async () => {
            sync();
            for (const item of active) {
                const page = await context.newPage();
                await page.goto(origin + (item.component === 'admin' ? '/dashboard/' : '/'));
                await expect(page.locator('h1')).toHaveText('B');
                await page.getByLabel('Draft').fill('Keep this unfinished input');
                assert(
                    !(
                        await page.evaluate(() =>
                            performance.getEntriesByType('resource').map(resource => resource.name),
                        )
                    ).some(url => url.includes('lazy-bbbbbbbb')),
                );
                bPages.push(page);
            }
        };
        if (entry === 'manual') {
            for (const item of active) activation.switchStorefront(item.candidate, item.pointer);
            await visitB();
            for (const item of active) activation.switchStorefront(item.old, item.pointer);
        } else {
            const verify = async () => {
                await visitB();
                throw new Error('Synthetic acceptance failed');
            };
            await assert.rejects(
                entry === 'frontends'
                    ? activation.activateFrontends(releases, verify)
                    : activation.activateStorefront({ ...releases[0], verify }),
                /Synthetic acceptance/,
            );
        }
        sync();
        for (let index = 0; index < active.length; index++) {
            const item = active[index];
            const page = bPages[index];
            assert.equal(fs.realpathSync(item.pointer), item.old);
            await expect(page.locator('h1')).toHaveText('B');
            await expect(page.getByLabel('Draft')).toHaveValue('Keep this unfinished input');
            const responses = [];
            page.on('response', response => {
                if (response.url().includes('lazy-bbbbbbbb'))
                    responses.push({
                        url: new URL(response.url()).pathname,
                        status: response.status(),
                        type: response.headers()['content-type'],
                    });
            });
            const pageErrors = [];
            page.on('pageerror', error => pageErrors.push(String(error)));
            await page.locator('#load').click();
            if (baseline) {
                await expect.poll(() => responses.some(response => response.status === 404)).toBe(true);
                await expect(page.locator('#result')).toHaveText('unloaded');
            } else {
                await expect(page.locator('#result')).toHaveText('B');
                await expect(page.locator('#result')).toHaveCSS('color', 'rgb(0, 128, 0)');
                assert.equal(responses.length, 2);
                assert(
                    responses.every(
                        response => response.status === 200 && /javascript|css/.test(response.type),
                    ),
                );
                await expect(page.getByLabel('Draft')).toHaveValue('Keep this unfinished input');
                await oldPages[index].locator('#load').click();
                await expect(oldPages[index].locator('#result')).toHaveText('A');
                await page.screenshot({ path: path.join(output, `${entry}-${item.component}-rollback.png`) });
            }
            results.push({
                entry,
                component: item.component,
                baseline,
                responses,
                status: baseline ? 'REPRODUCED_404' : 'PASS',
            });
        }
        await context.close();
    }
    fs.writeFileSync(
        path.join(output, baseline ? 'rollback-browser-before.json' : 'rollback-browser-after.json'),
        JSON.stringify(
            {
                image,
                environment:
                    'Local Docker Nginx native Linux filesystem + Chromium, production asset location blocks; ' +
                    'synthetic activation results copied byte-for-byte and pointers synchronized',
                results,
            },
            null,
            2,
        ),
    );
    process.stdout.write(JSON.stringify(results) + '\n');
} finally {
    await browser?.close();
    if (id) {
        const logs = spawnSync('docker', ['logs', id], { encoding: 'utf8' });
        fs.writeFileSync(
            path.join(output, baseline ? 'nginx-before.log' : 'nginx-after.log'),
            (logs.stdout ?? '') + (logs.stderr ?? ''),
        );
        docker('stop', '--time', '1', id);
    }
}
