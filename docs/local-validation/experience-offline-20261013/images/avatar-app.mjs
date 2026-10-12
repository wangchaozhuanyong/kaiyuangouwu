import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fixtureData } from '../../../../packages/storefront/e2e/visual-presets/fixtures.mjs';
const out = fileURLToPath(new URL('.', import.meta.url));
const browser = await chromium.launch({ headless: true });
const report = {
    environment:
        'Actual storefront app, synthetic GraphQL fixtures, no production operations. Client route transitions driven by browser history notifications.',
    cases: [],
    errors: [],
};
try {
    for (const width of [390, 1440])
        for (const preset of ['classic', 'neo-minimalist']) {
            const context = await browser.newContext({
                viewport: { width, height: 900 },
                deviceScaleFactor: 1,
                reducedMotion: 'reduce',
            });
            const page = await context.newPage();
            page.on('pageerror', error => report.errors.push(error.message));
            const requests = [];
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.pathname === '/shop-api') {
                    const data = fixtureData(preset, true, 'aftercare');
                    data.activeCustomer = {
                        ...data.activeCustomer,
                        avatar: { id: 'local-avatar-v1', preview: '/assets/preview/local-avatar.png?v=one' },
                    };
                    data.myCustomerAvatar = {
                        id: 'local-avatar-v1',
                        preview: '/assets/preview/local-avatar.png?v=one',
                    };
                    data.myCustomerAvatarHistory = [];
                    const operation = route.request().postDataJSON();
                    requests.push(
                        operation?.operationName ??
                            operation?.query?.match(/(?:query|mutation)\s+(\w+)/)?.[1],
                    );
                    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
                }
                if (url.pathname.startsWith('/_storefront/') || url.pathname.includes('/storefront-realtime'))
                    return route.fulfill({ status: 404, body: '' });
                if (url.pathname.includes('/assets/preview/local-avatar.png')) {
                    const size = url.searchParams.get('preset')?.includes('-64') ? 64 : 96;
                    return route.fulfill({
                        contentType: 'image/svg+xml',
                        headers: { 'cache-control': 'public,max-age=3600' },
                        body:
                            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
                            `<rect width="${size}" height="${size}" fill="#e53b40"/>` +
                            `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 3}" fill="#253d38"/></svg>`,
                    });
                }
                return route.continue();
            });
            await page.goto('http://127.0.0.1:5296/account');
            await expect(page.locator('html')).toHaveAttribute('data-storefront-preset', preset, {
                timeout: 30000,
            });
            await page.locator('.customer-avatar img').first().waitFor({ timeout: 30000 });
            await expect(page.locator('.customer-avatar [data-safe-image="ready"]').first()).toBeVisible();
            const result = { width, preset, routes: [], requests };
            await page.evaluate(() => {
                window.__avatarFrames = [];
                const measure = () => {
                    for (const el of document.querySelectorAll('.customer-avatar')) {
                        const rect = el.getBoundingClientRect();
                        if (rect.width && rect.height) {
                            const img = el.querySelector('img');
                            window.__avatarFrames.push({
                                path: location.pathname,
                                width: rect.width,
                                height: rect.height,
                                src: img?.currentSrc,
                                complete: img?.complete,
                                loaded: el
                                    .querySelector('[data-safe-image]')
                                    ?.getAttribute('data-safe-image'),
                                fallback: el.querySelector('.safe-image-fallback')?.style.backgroundImage,
                                opacity: img ? getComputedStyle(img).opacity : null,
                            });
                        }
                    }
                    window.__avatarFrame = requestAnimationFrame(measure);
                };
                measure();
            });
            for (const route of ['/orders', '/referral', '/account-security', '/', '/account']) {
                await page.evaluate(pathValue => {
                    const href = pathValue === '/' ? '/' : pathValue;
                    const anchor = [...document.querySelectorAll('a[href]')].find(
                        a => new URL(a.href).pathname === href,
                    );
                    if (anchor) anchor.click();
                    else {
                        history.pushState(history.state, '', href);
                        dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
                    }
                }, route);
                await page.waitForFunction(pathValue => location.pathname === pathValue, route);
                await page.waitForTimeout(350);
                result.routes.push({
                    path: route,
                    avatars: await page.locator('.customer-avatar').count(),
                    body: (await page.locator('body').innerText()).slice(0, 100),
                });
            }
            await expect(page.locator('.customer-avatar [data-safe-image="ready"]').first()).toBeVisible();
            result.frames = await page.evaluate(() => {
                cancelAnimationFrame(window.__avatarFrame);
                return window.__avatarFrames;
            });
            result.badFrames = result.frames.filter(
                frame => frame.loaded === 'loading' && frame.opacity === '0' && !frame.fallback,
            );
            expect(result.badFrames).toEqual([]);
            result.accountGeometry = result.frames
                .filter(frame => frame.path === '/account')
                .map(frame => ({ width: frame.width, height: frame.height }));
            expect(new Set(result.accountGeometry.map(value => JSON.stringify(value))).size).toBe(
                width < 1024 ? 1 : 2,
            );
            await page.screenshot({ path: `${out}avatar-${width}-${preset}.png`, fullPage: true });
            report.cases.push(result);
            await context.close();
        }
} catch (error) {
    report.errors.push(error.stack ?? String(error));
} finally {
    await browser.close();
    await writeFile(`${out}avatar-app.json`, JSON.stringify(report, null, 2));
    process.stdout.write(
        JSON.stringify({ cases: report.cases.length, errors: report.errors }, null, 2) + '\n',
    );
}
if (report.errors.length) process.exitCode = 1;
