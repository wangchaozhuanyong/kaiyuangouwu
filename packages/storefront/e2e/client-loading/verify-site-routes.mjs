import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicLocalizedHref } from '../../../storefront-content-plugin/src/shared/public-page-data.ts';

import { createPreviewServer } from './preview-server.mjs';
import { installSiteFixture } from './site-interaction-fixture.mjs';

const project = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const option = (name, fallback) =>
    process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const output = path.resolve(
    project,
    option('output', 'docs/local-validation/site-interaction-unification-20261019/routes'),
    option('run', new Date().toISOString().replaceAll(':', '-')),
);
assert.ok(output.startsWith(project + path.sep));
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output);
const dist = path.join(project, 'packages/storefront/dist');
const artifactFiles = [
    'index.html',
    ...(await readdir(path.join(dist, 'assets')))
        .filter(file => /\.(?:js|css)$/u.test(file))
        .map(file => `assets/${file}`),
];
await writeFile(
    path.join(output, 'artifact-inputs.json'),
    JSON.stringify(
        {
            dist,
            scriptSha256: createHash('sha256')
                .update(await readFile(fileURLToPath(import.meta.url)))
                .digest('hex'),
            files: await Promise.all(
                artifactFiles.sort().map(async file => ({
                    file,
                    sha256: createHash('sha256')
                        .update(await readFile(path.join(dist, file)))
                        .digest('hex'),
                })),
            ),
        },
        null,
        2,
    ),
);
const selected = new Set(option('routes', '').split(',').filter(Boolean));
const routeDirectory = path.join(project, 'packages/storefront/src/routes');
const routes = [];
for (const file of (await readdir(routeDirectory)).sort()) {
    const code = await readFile(path.join(routeDirectory, file), 'utf8');
    const route = code.match(/createFileRoute\('([^']+)'\)/u)?.[1];
    if (route && (!selected.size || selected.has(route.slice(1)) || (route === '/' && selected.has('index'))))
        routes.push(route);
}
const parameters = {
    '/category': '?collectionId=collection-daily',
    '/search': '?term=日常',
    '/product': '?id=product-1',
    '/order-detail': '?id=order-1',
    '/legal': '?id=privacy',
};
const results = [];
const defaults = { qaSsi: 'cold', qaPreset: 'neo-minimalist' };
const server = createPreviewServer({ dist, defaults });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
    for (const width of option('widths', '390,1440').split(',').map(Number)) {
        const language = width === 390 ? 'zh' : 'en';
        const preset = width === 390 ? 'classic' : 'neo-minimalist';
        defaults.qaPreset = preset;
        for (const route of routes) {
            const guest = /\/(?:login|register|forgot-password|reset-password|verify-account)$/u.test(route);
            const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 900 },
                locale: language === 'zh' ? 'zh-CN' : 'en-US',
                reducedMotion: width === 390 ? 'reduce' : 'no-preference',
                serviceWorkers: 'block',
            });
            const network = await installSiteFixture(context, origin, { customer: !guest });
            const page = await context.newPage();
            page.setDefaultTimeout(12_000);
            const exceptions = [];
            const consoleErrors = [];
            page.on('pageerror', error => exceptions.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') consoleErrors.push(message.text());
            });
            const routePath = `${route.replace('$slug', 'qa-unavailable-guide')}${parameters[route] ?? ''}${parameters[route] ? '&' : '?'}qaPreset=${preset}`;
            const href = origin + publicLocalizedHref(routePath, language === 'zh' ? 'zh_Hans' : 'en');
            const label = `${width}-${route.replaceAll('/', '_').replace('$', '') || 'index'}`;
            const record = {
                route,
                width,
                language,
                preset,
                identity: guest ? 'anonymous' : 'synthetic-customer',
                checks: [],
                issues: [],
            };
            const inspect = async phase => {
                await expect(page.locator('#root')).toBeVisible();
                await expect(page.locator('[data-page-readiness]')).toHaveAttribute(
                    'data-page-readiness',
                    'ready',
                );
                await expect(
                    page.locator('.page-readiness-initial:visible,.page-skeleton:visible'),
                ).toHaveCount(0);
                await expect(page.locator('.not-found-page')).toHaveCount(route === '/not-found' ? 1 : 0);
                await expect(page.locator('html')).toHaveAttribute('data-storefront-preset', preset);
                const state = await page.evaluate(() => ({
                    width: innerWidth,
                    documentLanguage: document.documentElement.lang,
                    preset: document.documentElement.dataset.storefrontPreset,
                    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
                    overflow: document.documentElement.scrollWidth > innerWidth + 1,
                    text:
                        document.getElementById('storefront-content')?.innerText ??
                        document.getElementById('root')?.innerText ??
                        '',
                    hidden:
                        document.getElementById('root')?.hidden || !!document.querySelector('#root[inert]'),
                }));
                assert.equal(state.width, width);
                assert.ok(
                    state.text.trim().length > 10,
                    'Route must contain usable content or an explicit terminal state',
                );
                assert.ok(!state.hidden, 'The current document must stay usable');
                assert.ok(!state.overflow, 'No horizontal page overflow');
                assert.deepEqual(exceptions, []);
                assert.deepEqual(consoleErrors, []);
                assert.deepEqual(network.rejectedWrites, []);
                assert.deepEqual(network.fixtureErrors, []);
                record.checks.push({
                    phase,
                    outcome: 'PASS',
                    path: new URL(page.url()).pathname,
                    width: state.width,
                    documentLanguage: state.documentLanguage,
                    preset: state.preset,
                    reducedMotion: state.reducedMotion,
                });
            };
            try {
                await page.goto(href, { waitUntil: 'domcontentloaded' });
                await inspect('direct');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await inspect('refresh');
                const original = page.url();
                const departure = route === '/category' ? 'services' : 'category';
                await page.goto(
                    `${origin}/${language}/${departure}?collectionId=collection-daily&qaPreset=${preset}`,
                    { waitUntil: 'domcontentloaded' },
                );
                await expect(page.locator('[data-page-readiness]')).toHaveAttribute(
                    'data-page-readiness',
                    'ready',
                );
                await page.goBack({ waitUntil: 'domcontentloaded' });
                await expect(page).toHaveURL(original);
                await inspect('history-return');
                record.status = 'PASS';
            } catch (error) {
                record.status = 'FAIL';
                record.issues.push(error.message);
                await page.screenshot({ path: path.join(output, `${label}-failure.png`) }).catch(() => {
                    // Preserve the original scenario failure if its diagnostic screenshot is unavailable.
                });
                record.text = (
                    await page
                        .locator('body')
                        .innerText()
                        .catch(() => '')
                ).slice(0, 2500);
            } finally {
                // Assertions are complete. Aborted background reads must not hold teardown open.
                await context.unrouteAll({ behavior: 'ignoreErrors' });
                record.network = network;
                record.exceptions = exceptions;
                record.consoleErrors = consoleErrors;
                results.push(record);
                process.stdout.write(`${width} ${route}: ${record.status}\n`);
                await writeFile(path.join(output, 'progress.json'), JSON.stringify(results, null, 2));
                await context.close();
            }
        }
    }
} finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await writeFile(
        path.join(output, 'summary.json'),
        JSON.stringify(
            {
                artifact: createHash('sha256')
                    .update(await readFile(path.join(dist, 'index.html')))
                    .digest('hex'),
                scope:
                    'Actual built client, synthetic read-only API; direct/refresh/browser-history smoke. ' +
                    'Invalid-token/unknown-content routes exercise explicit terminal states, not successful transactions.',
                regions: { CN: 'NOT_MEASURED', MY: 'NOT_MEASURED' },
                results,
            },
            null,
            2,
        ),
    );
}
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
