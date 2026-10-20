import { chromium, expect } from '@playwright/test';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storefront = fileURLToPath(new URL('../..', import.meta.url));
const project = path.resolve(storefront, '../..');
const output =
    process.env.PLUGIN_RECOVERY_OUTPUT ||
    path.join(project, 'docs/local-validation/site-interaction-unification-20261019/plugins/browser');
if (!path.resolve(output).startsWith(project + path.sep))
    throw new Error('Output must belong to this project');
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // Never overwrite evidence from an earlier attempt.
const vaultOrigin = 'https://local-vault-fixture.example.test';
const vite = await createServer({
    root: storefront,
    configFile: false,
    cacheDir: path.join(project, 'node_modules/.cache/plugin-recovery-vite'),
    plugins: [tailwindcss(), react()],
    define: { 'import.meta.env.VITE_TWO_FACTOR_ORIGIN': JSON.stringify(vaultOrigin) },
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
});
const results = [];
const sourcePaths = [
    'src/pages/ai-image-studio-page.tsx',
    'src/pages/ai-image-studio-cache.ts',
    'src/client-plugins/two-factor/isolated-entry.tsx',
    'e2e/plugin-recovery/fixture.tsx',
    'e2e/plugin-recovery/verify.mjs',
];
const sourceHashes = Object.fromEntries(
    await Promise.all(
        sourcePaths.map(async relative => [
            relative,
            createHash('sha256')
                .update(await readFile(path.join(storefront, relative)))
                .digest('hex'),
        ]),
    ),
);
let browser;
try {
    await vite.listen();
    const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({ headless: true });
    for (const width of [390, 1440]) {
        const language = width === 390 ? 'zh' : 'en';
        const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 1000 },
            reducedMotion: width === 390 ? 'reduce' : 'no-preference',
        });
        const externalRequests = [];
        const exceptions = [];
        const consoleErrors = [];
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin) return route.continue();
            if (url.origin === vaultOrigin && url.pathname === '/index.html') {
                return route.fulfill({
                    contentType: 'text/html',
                    body:
                        '<!doctype html><meta name="viewport" content="width=device-width"><title>Synthetic isolated vault</title>' +
                        '<p>Isolated fixture awaiting handshake</p><script>window.initializations=[];' +
                        "addEventListener('message',event=>{if(event.data?.type==='vendure-vault-init')" +
                        'window.initializations.push(event.data)})</script>',
                });
            }
            externalRequests.push(url.origin + url.pathname);
            return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.on('pageerror', error => exceptions.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        try {
            await page.goto(`${origin}/e2e/plugin-recovery/index.html?language=${language}`);
            await page.getByRole('button', { name: 'Open studio', exact: true }).click();
            await expect(page.locator('.is-balance')).toHaveText(language === 'zh' ? '¥25' : 'CN¥25');
            const draft = 'Synthetic retained customer draft';
            await page.locator('textarea').first().fill(draft);
            await expect
                .poll(() => page.evaluate(() => window.pluginRecovery.snapshot()?.draft.prompt))
                .toBe(draft);
            const before = await page.evaluate(() => window.pluginRecovery.snapshot());
            expect(before.lastFetchedAt).toBeGreaterThan(0);
            await page.evaluate(() => window.pluginRecovery.fail(['wallet', 'promptQuota']));
            await page
                .getByRole('tab', { name: language === 'zh' ? '生成记录' : 'Generations', exact: true })
                .click();
            await page
                .getByRole('button', { name: language === 'zh' ? '刷新' : 'Refresh', exact: true })
                .click();
            const warning = page.getByRole('status').filter({
                hasText: language === 'zh' ? '部分数据刷新失败' : 'Some data could not be refreshed',
            });
            await expect(warning).toBeVisible();
            const partial = await page.evaluate(() => window.pluginRecovery.snapshot());
            expect(partial.balance).toBe(before.balance);
            expect(partial.promptQuota).toEqual(before.promptQuota);
            expect(partial.modelQuotas).toEqual(before.modelQuotas);
            expect(partial.lastFetchedAt).toBe(before.lastFetchedAt);
            await page.getByRole('tab', { name: language === 'zh' ? '创作' : 'Create', exact: true }).click();
            await expect(page.locator('textarea').first()).toHaveValue(draft);
            await expect(page.locator('.is-balance')).toHaveText(language === 'zh' ? '¥25' : 'CN¥25');
            await expect(
                page.getByRole('button', {
                    name: language === 'zh' ? '费用待更新' : 'Pricing unavailable',
                    exact: true,
                }),
            ).toBeDisabled();
            await page.screenshot({ path: path.join(output, `studio-partial-${width}.png`), fullPage: true });
            await page.getByRole('button', { name: 'Fixture home', exact: true }).click();
            await page.getByRole('button', { name: 'Open studio', exact: true }).click();
            await expect(warning).toBeVisible();
            await expect(page.locator('.is-balance')).toHaveText(language === 'zh' ? '¥25' : 'CN¥25');
            await expect(page.locator('textarea').first()).toHaveValue(draft);
            expect((await page.evaluate(() => window.pluginRecovery.snapshot())).lastFetchedAt).toBe(
                before.lastFetchedAt,
            );
            results.push({
                width,
                language,
                scenario:
                    'partial refresh and remount retain valid data, draft, original freshness and paid-action guards',
                passed: true,
            });

            await page.getByRole('button', { name: 'Fixture home', exact: true }).click();
            await page.evaluate(() => {
                window.pluginRecovery.clear();
                window.pluginRecovery.fail(['wallet']);
            });
            await page.getByRole('button', { name: 'Open studio', exact: true }).click();
            await expect(page.locator('.is-balance')).toHaveText(
                language === 'zh' ? '待更新' : 'Unavailable',
            );
            await page.locator('textarea').first().fill(draft);
            await expect(
                page.getByRole('button', {
                    name: language === 'zh' ? '费用待更新' : 'Pricing unavailable',
                    exact: true,
                }),
            ).toBeDisabled();
            const unknown = await page.evaluate(() => window.pluginRecovery.snapshot());
            expect(unknown.balance).toBeNull();
            expect(unknown.lastFetchedAt).toBe(0);
            await page.locator('.is-balance').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `studio-unknown-${width}.png`) });
            await page.evaluate(() => window.pluginRecovery.fail([]));
            await page
                .getByRole('tab', { name: language === 'zh' ? '生成记录' : 'Generations', exact: true })
                .click();
            await page
                .getByRole('button', { name: language === 'zh' ? '刷新' : 'Refresh', exact: true })
                .click();
            await expect
                .poll(() => page.evaluate(() => window.pluginRecovery.snapshot()?.lastFetchedAt))
                .toBeGreaterThan(0);
            await page.getByRole('tab', { name: language === 'zh' ? '创作' : 'Create', exact: true }).click();
            await expect(page.locator('.is-balance')).toHaveText(language === 'zh' ? '¥25' : 'CN¥25');
            await expect(page.locator('textarea').first()).toHaveValue(draft);
            results.push({
                width,
                language,
                scenario: 'unknown wallet is not zero; local read retry recovers without a write',
                passed: true,
            });

            const generate = page.getByRole('button', {
                name: language === 'zh' ? '开始生成' : 'Generate',
                exact: true,
            });
            await expect(generate).toBeEnabled();
            const quotaBefore = await page.evaluate(() => window.pluginRecovery.snapshot());
            await page.evaluate(() => window.pluginRecovery.fail(['modelQuotas']));
            await page
                .getByRole('tab', { name: language === 'zh' ? '生成记录' : 'Generations', exact: true })
                .click();
            await page
                .getByRole('button', { name: language === 'zh' ? '刷新' : 'Refresh', exact: true })
                .click();
            await expect(warning).toBeVisible();
            await page.getByRole('tab', { name: language === 'zh' ? '创作' : 'Create', exact: true }).click();
            await expect(generate).toBeDisabled();
            const quotaFailed = await page.evaluate(() => window.pluginRecovery.snapshot());
            expect(quotaFailed.modelQuotas).toEqual(quotaBefore.modelQuotas);
            expect(quotaFailed.lastFetchedAt).toBe(quotaBefore.lastFetchedAt);
            await expect(page.locator('textarea').first()).toHaveValue(draft);
            await page.screenshot({
                path: path.join(output, `studio-quota-guard-${width}.png`),
                fullPage: true,
            });
            await page.evaluate(() => window.pluginRecovery.fail([]));
            await page
                .getByRole('tab', { name: language === 'zh' ? '生成记录' : 'Generations', exact: true })
                .click();
            await page
                .getByRole('button', { name: language === 'zh' ? '刷新' : 'Refresh', exact: true })
                .click();
            await page.getByRole('tab', { name: language === 'zh' ? '创作' : 'Create', exact: true }).click();
            await expect(generate).toBeEnabled();
            results.push({
                width,
                language,
                scenario:
                    'failed model quota retains display and freshness but disables submission until successful local read',
                passed: true,
            });

            await page.getByRole('button', { name: 'Open vault', exact: true }).click();
            const frameLocator = page.locator('iframe');
            await expect(frameLocator).toBeVisible();
            const secureStatus = page.getByRole('status').filter({ hasText: /2FA/ });
            await expect(secureStatus).toBeVisible();
            if (process.env.PLUGIN_RECOVERY_SKIP_TIMEOUT !== '1') {
                const started = Date.now();
                await page.evaluate(() => {
                    window.oldVaultSource = document.querySelector('iframe').contentWindow;
                });
                const alert = page.getByRole('alert');
                await expect(alert).toContainText(language === 'zh' ? '连接超时' : 'too long to connect', {
                    timeout: 11_500,
                });
                const timeoutMs = Date.now() - started;
                expect(timeoutMs).toBeGreaterThan(9000);
                expect(timeoutMs).toBeLessThan(11500);
                await page.screenshot({ path: path.join(output, `vault-timeout-${width}.png`) });
                const retry = page.getByRole('button', {
                    name: language === 'zh' ? '重试' : 'Retry',
                    exact: true,
                });
                await retry.focus();
                await page.keyboard.press('Enter');
                await expect(alert).toHaveCount(0);
                await expect(secureStatus).toBeVisible();
                expect(
                    await page.evaluate(
                        () => document.querySelector('iframe').contentWindow !== window.oldVaultSource,
                    ),
                ).toBe(true);
                await page.evaluate(messageOrigin => {
                    dispatchEvent(
                        new MessageEvent('message', {
                            source: window.oldVaultSource,
                            origin: messageOrigin,
                            data: { type: 'vendure-vault-initialized' },
                        }),
                    );
                    dispatchEvent(
                        new MessageEvent('message', {
                            source: document.querySelector('iframe').contentWindow,
                            origin: 'https://wrong-origin.example.test',
                            data: { type: 'vendure-vault-initialized' },
                        }),
                    );
                    dispatchEvent(
                        new MessageEvent('message', {
                            source: window,
                            origin: messageOrigin,
                            data: { type: 'vendure-vault-back' },
                        }),
                    );
                }, vaultOrigin);
                await expect(secureStatus).toBeVisible();
                await expect(alert).toContainText(language === 'zh' ? '连接超时' : 'too long to connect', {
                    timeout: 11_500,
                });
                const frame = page.frames().find(item => item.url() === `${vaultOrigin}/index.html`);
                expect(frame).toBeTruthy();
                await frame.evaluate(
                    parentOrigin => parent.postMessage({ type: 'vendure-vault-initialized' }, parentOrigin),
                    origin,
                );
                await expect(alert).toHaveCount(0);
                await expect(secureStatus).toHaveCount(0);
                await page.screenshot({ path: path.join(output, `vault-recovered-${width}.png`) });
                results.push({
                    width,
                    language,
                    scenario:
                        '10-second local timeout, keyboard retry, rejected stale/wrong-source/origin messages and late trusted recovery',
                    timeoutMs,
                    passed: true,
                });
            }

            await page.evaluate(() => {
                window.oldVaultSource = document.querySelector('iframe').contentWindow;
            });
            await page.getByRole('button', { name: 'Change owner', exact: true }).click();
            await expect(secureStatus).toBeVisible();
            await page.evaluate(
                messageOrigin =>
                    dispatchEvent(
                        new MessageEvent('message', {
                            source: window.oldVaultSource,
                            origin: messageOrigin,
                            data: { type: 'vendure-vault-initialized' },
                        }),
                    ),
                vaultOrigin,
            );
            await expect(secureStatus).toBeVisible();
            const nextFrame = await (await frameLocator.elementHandle()).contentFrame();
            await nextFrame.waitForURL(`${vaultOrigin}/index.html`);
            await expect
                .poll(() => nextFrame.evaluate(() => window.initializations?.at(-1)?.ownerId))
                .toBe('synthetic-second-owner');
            await nextFrame.evaluate(
                parentOrigin => parent.postMessage({ type: 'vendure-vault-initialized' }, parentOrigin),
                origin,
            );
            await expect(secureStatus).toHaveCount(0);
            expect(await page.evaluate(() => innerWidth)).toBe(width);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
                true,
            );
            expect(await page.evaluate(() => window.pluginRecovery.writes)).toEqual([]);
            expect(externalRequests).toEqual([]);
            expect(exceptions).toEqual([]);
            expect(consoleErrors).toEqual([]);
            results.push({
                width,
                language,
                scenario: 'owner change replaces iframe and rejects previous owner completion',
                passed: true,
            });
        } catch (error) {
            results.push({
                width,
                language,
                passed: false,
                error: error.stack,
                exceptions,
                consoleErrors,
                externalRequests,
            });
            await page
                .screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true })
                .catch(() => {
                    // Preserve the original scenario failure if its diagnostic screenshot is unavailable.
                });
            await writeFile(
                path.join(output, `failure-${width}.txt`),
                await page
                    .locator('body')
                    .innerText()
                    .catch(() => ''),
            );
        } finally {
            await context.close();
            await writeFile(
                path.join(output, 'receipt.json'),
                JSON.stringify(
                    {
                        mode: 'Chromium actual plugin components; synthetic read-only API; locally fulfilled isolated handshake frame',
                        sourceHashes,
                        results,
                        limitations: [
                            'No real login, wallet, vault keys, paid generation or backend requests',
                            'China/Malaysia real network and production validation NOT_MEASURED',
                        ],
                    },
                    null,
                    2,
                ) + '\n',
            );
        }
    }
    if (results.some(item => !item.passed))
        throw new Error('Plugin recovery browser checks failed; see preserved receipt');
    process.stdout.write(JSON.stringify({ passed: results.length, output }) + '\n');
} finally {
    await browser?.close();
    await vite.close();
}
