import { chromium, expect } from '@playwright/test';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storefront = fileURLToPath(new URL('../..', import.meta.url));
const output = process.env.INTERACTION_OUTPUT;
if (!output || !path.resolve(output).startsWith(path.resolve(storefront, '../..') + path.sep))
    throw new Error('Use a new absolute output directory inside this project');
await mkdir(output);
const vite = await createServer({
    root: storefront,
    configFile: false,
    plugins: [tailwindcss(), react()],
    cacheDir: path.join(storefront, '.runtime/interaction-standard-fix-20261101/vite-cache'),
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { host: '127.0.0.1', port: 0, hmr: false },
});
const results = [];
let browser;
try {
    await vite.listen();
    const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({ headless: true });
    for (const [width, language, reducedMotion] of [
        [390, 'zh', 'no-preference'],
        [390, 'en', 'reduce'],
        [1440, 'zh', 'reduce'],
        [1440, 'en', 'no-preference'],
    ]) {
        const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 1000 },
            reducedMotion,
        });
        const page = await context.newPage();
        const errors = [];
        const external = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === origin) return route.continue();
            external.push(url.origin + url.pathname);
            return route.abort();
        });
        try {
            await page.goto(`${origin}/e2e/plugin-recovery/index.html?language=${language}&mode=interaction`);
            await page.getByRole('button', { name: 'Open studio', exact: true }).click();
            await expect(page.locator('.is-balance')).toContainText('25');
            await page.locator('textarea').first().fill('Synthetic retained draft');
            const generate = page.locator('.ai-studio-generate-button');
            await expect(generate).toBeEnabled();
            await generate.click();
            await expect(generate).toBeDisabled();
            await page.getByRole('button', { name: 'Same account update', exact: true }).click();
            await expect(generate).toBeDisabled();
            await page.getByRole('button', { name: 'Fixture home', exact: true }).click();
            await page.getByRole('button', { name: 'Open studio', exact: true }).click();
            await expect(page.locator('textarea').first()).toHaveValue('Synthetic retained draft');
            await expect(generate).toBeDisabled();
            expect(await page.evaluate(() => window.pluginRecovery.writes)).toEqual([
                'createImageGeneration',
            ]);
            await page.evaluate(() => window.pluginRecovery.finishGeneration());
            await page
                .getByRole('tab', { name: language === 'zh' ? '生成记录' : 'Generations', exact: true })
                .click();
            await expect(page.locator('.ai-studio-history')).toBeVisible();
            await expect(page.getByText('Synthetic generation 1', { exact: true })).toBeVisible();
            const newPrompt = await page.evaluate(() => window.pluginRecovery.addHistory());
            const before = await page.evaluate(
                () => window.pluginRecovery.calls.filter(name => name === 'history').length,
            );
            await page.evaluate(() => window.pluginRecovery.hold('history'));
            const refresh = page.getByRole('button', {
                name: language === 'zh' ? '刷新' : 'Refresh',
                exact: true,
            });
            await refresh.evaluate(button => {
                button.click();
                button.click();
            });
            await expect(refresh).toBeDisabled();
            expect(
                await page.evaluate(
                    () => window.pluginRecovery.calls.filter(name => name === 'history').length,
                ),
            ).toBe(before + 1);
            await page.evaluate(() => window.pluginRecovery.release('history'));
            await expect(refresh).toBeEnabled();
            await expect(page.getByText(newPrompt, { exact: true })).toBeVisible();
            await page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            const hidden = await page.evaluate(
                () => window.pluginRecovery.calls.filter(name => name === 'job').length,
            );
            await page.waitForTimeout(2400);
            expect(
                await page.evaluate(() => window.pluginRecovery.calls.filter(name => name === 'job').length),
            ).toBe(hidden);
            await page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            await expect
                .poll(() =>
                    page.evaluate(() => window.pluginRecovery.calls.filter(name => name === 'job').length),
                )
                .toBeGreaterThan(hidden);
            await context.setOffline(true);
            const offline = await page.evaluate(
                () => window.pluginRecovery.calls.filter(name => name === 'job').length,
            );
            await page.waitForTimeout(2400);
            expect(
                await page.evaluate(() => window.pluginRecovery.calls.filter(name => name === 'job').length),
            ).toBe(offline);
            await context.setOffline(false);
            await expect
                .poll(() =>
                    page.evaluate(() => window.pluginRecovery.calls.filter(name => name === 'job').length),
                )
                .toBeGreaterThan(offline);
            await page.screenshot({
                path: path.join(output, `studio-${width}-${language}.png`),
                fullPage: true,
            });
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
            expect(overflow).toBe(false);
            expect(await page.evaluate(() => window.pluginRecovery.writes)).toEqual([
                'createImageGeneration',
            ]);
            expect(errors).toEqual([]);
            expect(external).toEqual([]);
            results.push({
                width,
                language,
                reducedMotion,
                scenario:
                    'pending A-B-A write ownership, deduplicated scoped refresh, history update, hidden/offline polling, retained draft',
                passed: true,
                errors,
                external,
            });

            const lang = language === 'zh' ? 'zh' : 'en';
            await page.goto(
                `${origin}/e2e/design-experience/index.html?lang=${lang}&skin=${width === 390 ? 'classic' : 'neo-minimalist'}`,
            );
            await expect(
                page.getByText(language === 'zh' ? '可用页面内容' : 'Available page content', {
                    exact: true,
                }),
            ).toBeVisible();
            await page
                .getByRole('button', {
                    name: language === 'zh' ? '模拟页面加载' : 'Simulate page loading',
                    exact: true,
                })
                .click();
            await page
                .getByRole('button', {
                    name: language === 'zh' ? '完成模拟读取' : 'Complete simulated read',
                    exact: true,
                })
                .click();
            await expect(
                page.getByText(language === 'zh' ? '可用页面内容' : 'Available page content', {
                    exact: true,
                }),
            ).toBeVisible();
            await expect(page.locator('[data-page-pending]')).toHaveCount(0);
            expect(
                await page.evaluate(() =>
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--experience-reveal-distance')
                        .trim(),
                ),
            ).toBe('8px');
            await expect
                .poll(() =>
                    page.evaluate(
                        () =>
                            document.getAnimations().filter(animation => animation.playState === 'running')
                                .length,
                    ),
                )
                .toBe(0);
            await page.screenshot({
                path: path.join(output, `shared-loading-${width}-${language}.png`),
                fullPage: false,
            });
            expect(errors).toEqual([]);
            expect(external).toEqual([]);
            results.push({
                width,
                language,
                reducedMotion,
                scenario: 'actual shared shell and readiness recovery; all entrance effects terminate',
                passed: true,
            });
            process.stdout.write(`Passed ${width}px ${language} ${reducedMotion}\n`);
        } catch (error) {
            await page
                .screenshot({ path: path.join(output, `failed-${width}-${language}.png`), fullPage: true })
                .catch(() => undefined);
            results.push({ width, language, passed: false, error: String(error), errors, external });
            throw error;
        } finally {
            await context.close();
        }
    }
} finally {
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    await browser?.close();
    await vite.close();
}
