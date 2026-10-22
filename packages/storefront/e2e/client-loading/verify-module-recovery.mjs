import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPreviewServer } from './preview-server.mjs';
import { installSiteFixture } from './site-interaction-fixture.mjs';

const project = fileURLToPath(new URL('../../../../', import.meta.url));
const option = (key, fallback) =>
    process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const output = path.resolve(
    project,
    option('output', 'docs/local-validation/navigation-responsive-20261022'),
    option('run', 'module-recovery'),
);
assert.ok(output.startsWith(project));
await mkdir(output, { recursive: true });
const server = createPreviewServer({
    dist: path.join(project, 'packages/storefront/dist'),
    defaults: { qaSsi: 'cold', qaPreset: 'classic' },
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
let recover = false;
const network = await installSiteFixture(context, origin, {
    customer: false,
    intercept: async ({ route, url }) => {
        if (!recover && /\/home-page-[^/]+\.js$/u.test(url.pathname)) {
            await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Synthetic module failure' });
            return true;
        }
        return false;
    },
});
const page = await context.newPage();
const navigation = page.locator('nav[aria-label="Main navigation"]:visible');
try {
    await page.goto(origin + '/en/category?collectionId=collection-daily&childId=collection-cups');
    await expect(page.locator('.category-page .product-card').first()).toBeVisible();
    await navigation.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Page resources unavailable');
    await expect(navigation).toBeVisible();
    await expect(page.locator('.page-readiness-navigation')).not.toBeVisible();
    await navigation.locator('a[href*="/category"]').click();
    await expect(page.locator('.category-page .product-card').first()).toBeVisible();
    await navigation.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Page resources unavailable');
    recover = true;
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.locator('.home-page')).toBeVisible();
    await expect(page.locator('[data-page-readiness]')).toHaveAttribute('data-page-readiness', 'ready');
    await expect(navigation).toBeVisible();
    assert.deepEqual(network.rejectedWrites, []);
    assert.deepEqual(network.externalRequests, []);
    assert.deepEqual(network.fixtureErrors, []);
    const result = {
        status: 'PASS',
        checks: [
            'A real 503 for a route module keeps the navigation shell',
            'Module errors stop waiting and expose a reload action',
            'A cached route remains navigable after failure',
            'Restoring the module and reloading recovers the actual target',
        ],
        rejectedWrites: network.rejectedWrites,
    };
    await page.screenshot({ path: path.join(output, 'recovered.png') });
    await writeFile(path.join(output, 'summary.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => undefined);
    await writeFile(
        path.join(output, 'failure.json'),
        JSON.stringify(
            {
                error: String(error),
                url: page.url(),
                body: (await page.locator('body').innerText()).slice(0, 2000),
            },
            null,
            2,
        ),
    );
    throw error;
} finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
