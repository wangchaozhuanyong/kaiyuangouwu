// Run only after the authorized local browser surface and fixture server are available.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.AUTH_OVERLAY_PREVIEW_URL;
if (!baseUrl) throw new Error('Set AUTH_OVERLAY_PREVIEW_URL to the authorized local fixture URL.');
const parsedUrl = new URL(baseUrl);
if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname))
    throw new Error('Only a local preview is permitted.');
if (parsedUrl.port === '5296')
    throw new Error('The older carousel preview is outside this verification scope.');
const project = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.resolve(project, 'tmp/auth-overlay-20261009/browser');
await mkdir(output, { recursive: true });
const report = [];
const interactions = [];
const browser = await chromium.launch({ headless: true });
try {
    for (const skin of ['classic', 'neo-minimalist'])
        for (const lang of ['zh', 'en'])
            for (const width of [390, 1440]) {
                const page = await browser.newPage({
                    viewport: { width, height: width === 390 ? 844 : 1000 },
                    reducedMotion: 'reduce',
                });
                const errors = [];
                page.on('pageerror', error => errors.push(String(error)));
                await page.route('**/*', route => {
                    const requestUrl = new URL(route.request().url());
                    if (
                        requestUrl.origin !== parsedUrl.origin ||
                        /^\/(?:shop-api|storefront-realtime|_storefront\/page-data)(?:\/|$)/.test(
                            requestUrl.pathname,
                        )
                    )
                        return route.abort();
                    return route.continue();
                });
                const url = new URL(baseUrl);
                url.searchParams.set('skin', skin);
                url.searchParams.set('lang', lang);
                await page.goto(url.href);
                const background = page.getByTestId('auth-preview-background');
                await expect(background).toBeVisible();
                await page.getByTestId('open-login').click();
                const dialog = page.locator('.auth-dialog');
                await expect(dialog).toBeVisible();
                for (const mode of ['login', 'register', 'forgot-password']) {
                    if (mode === 'register') await dialog.locator('.auth-switch button').click();
                    if (mode === 'forgot-password') {
                        await dialog.locator('.auth-switch button').click();
                        await dialog.locator('.auth-login-options button').click();
                    }
                    await expect(dialog.locator('h1')).toBeVisible();
                    const geometry = await dialog.evaluate(element => {
                        const body = element.querySelector('.auth-dialog-body');
                        const heading = element.querySelector('h1');
                        const description = heading?.parentElement?.querySelector('p');
                        const bounds = element.getBoundingClientRect();
                        const middle = node => {
                            const rect = node.getBoundingClientRect();
                            return rect.x + rect.width / 2;
                        };
                        const internalScrollers = [...element.querySelectorAll('*')].filter(node => {
                            const style = getComputedStyle(node);
                            return (
                                /(auto|scroll)/.test(style.overflowY) &&
                                node.scrollHeight > node.clientHeight + 1
                            );
                        });
                        return {
                            width: bounds.width,
                            bottom: bounds.bottom,
                            height: bounds.height,
                            viewportHeight: innerHeight,
                            headingDelta: heading ? Math.abs(middle(heading) - middle(element)) : null,
                            descriptionDelta: description
                                ? Math.abs(middle(description) - middle(element))
                                : null,
                            headingAlign: heading ? getComputedStyle(heading).textAlign : null,
                            descriptionAlign: description ? getComputedStyle(description).textAlign : null,
                            backgroundImage: getComputedStyle(element).backgroundImage,
                            inputBackground: element.querySelector('.auth-input-shell')
                                ? getComputedStyle(element.querySelector('.auth-input-shell')).backgroundColor
                                : null,
                            horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
                            logoCount: element.querySelectorAll(
                                '.auth-form-logo,.auth-form-brand,.auth-hero,img',
                            ).length,
                            onlyBodyScrolls: internalScrollers.every(node => node === body),
                            bodyLocked:
                                getComputedStyle(document.body).overflow === 'hidden' ||
                                document.body.style.position === 'fixed',
                        };
                    });
                    expect(geometry.logoCount).toBe(0);
                    expect(geometry.headingAlign).toBe('center');
                    expect(geometry.descriptionAlign).toBe('center');
                    expect(geometry.headingDelta).toBeLessThanOrEqual(2);
                    expect(geometry.descriptionDelta).toBeLessThanOrEqual(2);
                    expect(geometry.backgroundImage).toContain('gradient');
                    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
                    expect(geometry.onlyBodyScrolls).toBe(true);
                    expect(geometry.bodyLocked).toBe(true);
                    if (width === 390)
                        expect(Math.abs(geometry.bottom - geometry.viewportHeight)).toBeLessThanOrEqual(2);
                    else expect(geometry.width).toBe(480);
                    await page.screenshot({
                        path: path.join(output, `${skin}-${lang}-${width}-${mode}.png`),
                    });
                    report.push({ skin, lang, width, mode, ...geometry });
                }
                await page.keyboard.press('Escape');
                await expect(dialog).toHaveCount(0);
                const restoredFocus = await page
                    .getByTestId('open-login')
                    .evaluate(element => element === document.activeElement);
                interactions.push({ skin, lang, width, restoredFocus });
                await page.getByTestId('open-login').click();
                await dialog.locator('input[name="emailAddress"]').fill('preview@example.invalid');
                await dialog.locator('select').selectOption(lang === 'zh' ? 'en' : 'zh');
                await expect(dialog.locator('input[name="emailAddress"]')).toHaveValue(
                    'preview@example.invalid',
                );
                await expect(dialog).toBeVisible();
                await page.keyboard.press('Escape');
                url.searchParams.set('fail', '1');
                url.searchParams.set('mode', 'login');
                await page.goto(url.href);
                await dialog.locator('input[name="emailAddress"]').fill('preview@example.invalid');
                await dialog.locator('input[name="password"]').fill('Synthetic-test-input');
                await dialog.locator('button[type="submit"]').click();
                await expect(dialog.locator('[role="alert"]')).toBeVisible();
                await page.screenshot({
                    path: path.join(output, `${skin}-${lang}-${width}-login-error.png`),
                });
                await dialog.locator('.auth-login-options button').click();
                await dialog.locator('input[name="emailAddress"]').fill('preview@example.invalid');
                await dialog.locator('button[type="submit"]').click();
                await expect(dialog.locator('[role="alert"]')).toBeVisible();
                await page.screenshot({
                    path: path.join(output, `${skin}-${lang}-${width}-forgot-password-error.png`),
                });
                url.searchParams.set('mode', 'register');
                await page.goto(url.href);
                await dialog.locator('input[name="fullName"]').fill('Local Example');
                await dialog.locator('input[name="emailAddress"]').fill('preview@example.invalid');
                await dialog.locator('input[name="password"]').fill('Synthetic-test-input');
                await dialog.locator('input[name="confirmPassword"]').fill('Synthetic-test-input');
                await dialog.locator('button[type="submit"]').click();
                await expect(dialog.locator('[role="alert"]')).toBeVisible();
                await page.screenshot({
                    path: path.join(output, `${skin}-${lang}-${width}-register-consent-error.png`),
                });
                interactions.at(-1).errorStates = ['login', 'forgot-password', 'registration-consent'];
                expect(errors).toEqual([]);
                await page.close();
            }
    await writeFile(
        path.join(output, 'report.json'),
        JSON.stringify(
            {
                source: 'Production authentication overlay; synthetic local data only',
                cases: report,
                interactions,
            },
            null,
            2,
        ),
    );
    expect(
        interactions.filter(item => !item.restoredFocus),
        'Escape restores the original trigger focus',
    ).toEqual([]);
    process.stdout.write(`Verified ${report.length} visual states; artifacts: ${output}\n`);
} finally {
    await browser.close();
}
